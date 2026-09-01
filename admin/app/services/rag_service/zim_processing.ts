import logger from '@adonisjs/core/services/logger'
import { ZIMExtractionService } from '../zim_extraction_service.js'
import { loadIngestSettings } from '../../utils/ingest_settings.js'
import {
  ZIM_FLUSH_CHUNK_COUNT,
  ZIM_FLUSH_ARTICLE_INTERVAL,
} from '../../../constants/zim_extraction.js'
import type { ProcessZIMFileResponse } from '../../../types/rag.js'
import type { RagCtx } from './types.js'
import { embedAndStoreChunks } from './embedding.js'

export async function processZIMFile(
  ctx: RagCtx,
  filepath: string,
  deleteAfterEmbedding: boolean,
  options: {
    startOffset?: number
    onProgress?: (percent: number) => Promise<void>
    onFlush?: (
      articlesSeen: number,
      chunksEmbedded: number,
      totalArticles: number
    ) => Promise<boolean | void>
    collection?: string
    chunksEstimated?: number
    baseChunks?: number
    repairPaths?: string[]
  } = {}
): Promise<ProcessZIMFileResponse> {
  const {
    startOffset,
    onProgress,
    onFlush,
    collection,
    chunksEstimated,
    baseChunks = 0,
    repairPaths,
  } = options
  const zimExtractionService = new ZIMExtractionService()

  logger.info(`[RAG] Streaming ZIM content (resume offset=${startOffset || 0})`)

  let totalChunks = 0
  let totalArticles = 0
  let lastFlushedAt = startOffset || 0

  const reportProgress = async (articlesSeen: number) => {
    if (!onProgress) return
    if (chunksEstimated && chunksEstimated > 0) {
      await onProgress(Math.min(99, ((baseChunks + totalChunks) / chunksEstimated) * 100))
    } else if (totalArticles > 0) {
      await onProgress(Math.min(99, (articlesSeen / totalArticles) * 100))
    }
  }

  let pendingTexts: string[] = []
  let pendingMetadatas: Record<string, any>[] = []
  let cancelled = false

  const ingestSettings = await loadIngestSettings()
  const MAX_CONCURRENT_EMBEDS = ingestSettings.maxConcurrentEmbeds
  const inFlight: Promise<void>[] = []

  const flush = async (articlesSeen: number): Promise<boolean> => {
    lastFlushedAt = articlesSeen

    if (pendingTexts.length === 0) {
      await reportProgress(articlesSeen)
      if (onFlush) {
        const shouldContinue = await onFlush(articlesSeen, totalChunks, totalArticles)
        if (shouldContinue === false) {
          cancelled = true
        }
      }
      return !cancelled
    }

    const texts = pendingTexts
    const metadatas = pendingMetadatas
    pendingTexts = []
    pendingMetadatas = []

    if (inFlight.length >= MAX_CONCURRENT_EMBEDS) {
      await inFlight.shift()
    }

    const embedPromise = (async () => {
      const result = await embedAndStoreChunks(ctx, texts, metadatas)
      if (result) {
        totalChunks += result.chunks
      } else {
        logger.warn(`[RAG] Flush at article ${articlesSeen} failed to embed; chunks skipped`)
      }

      await reportProgress(articlesSeen)

      if (onFlush) {
        const shouldContinue = await onFlush(articlesSeen, totalChunks, totalArticles)
        if (shouldContinue === false) {
          cancelled = true
        }
      }
    })()
    const handledPromise = embedPromise.catch(() => {})
    inFlight.push(handledPromise)

    return !cancelled
  }

  const repairPathSet = repairPaths ? new Set(repairPaths) : null

  const streamResult = repairPathSet
    ? await zimExtractionService.streamZIMContentForPaths(
        filepath,
        repairPathSet,
        async (zimChunks, articlesSeen, total) => {
          totalArticles = total

          await reportProgress(articlesSeen)

          for (const zimChunk of zimChunks) {
            pendingTexts.push(zimChunk.text)
            pendingMetadatas.push({
              source: filepath,
              content_type: 'zim_article',
              ...(collection ? { collection } : {}),
              article_title: zimChunk.articleTitle,
              article_path: zimChunk.articlePath,
              section_title: zimChunk.sectionTitle,
              full_title: zimChunk.fullTitle,
              hierarchy: zimChunk.hierarchy,
              section_level: zimChunk.sectionLevel,
              document_id: zimChunk.documentId,
              archive_title: zimChunk.archiveMetadata.title,
              archive_creator: zimChunk.archiveMetadata.creator,
              archive_publisher: zimChunk.archiveMetadata.publisher,
              archive_date: zimChunk.archiveMetadata.date,
              archive_language: zimChunk.archiveMetadata.language,
              archive_description: zimChunk.archiveMetadata.description,
              extraction_strategy: zimChunk.strategy,
            })
          }

          if (
            pendingTexts.length >= ZIM_FLUSH_CHUNK_COUNT ||
            articlesSeen - lastFlushedAt >= ZIM_FLUSH_ARTICLE_INTERVAL
          ) {
            return await flush(articlesSeen)
          }
          return true
        }
      )
    : await zimExtractionService.streamZIMContent(
        filepath,
        { startOffset, useWorkers: true, workerCount: ingestSettings.zimWorkerCount },
        async (zimChunks, articlesSeen, total) => {
          totalArticles = total

          await reportProgress(articlesSeen)

          for (const zimChunk of zimChunks) {
            pendingTexts.push(zimChunk.text)
            pendingMetadatas.push({
              source: filepath,
              content_type: 'zim_article',
              ...(collection ? { collection } : {}),
              article_title: zimChunk.articleTitle,
              article_path: zimChunk.articlePath,
              section_title: zimChunk.sectionTitle,
              full_title: zimChunk.fullTitle,
              hierarchy: zimChunk.hierarchy,
              section_level: zimChunk.sectionLevel,
              document_id: zimChunk.documentId,
              archive_title: zimChunk.archiveMetadata.title,
              archive_creator: zimChunk.archiveMetadata.creator,
              archive_publisher: zimChunk.archiveMetadata.publisher,
              archive_date: zimChunk.archiveMetadata.date,
              archive_language: zimChunk.archiveMetadata.language,
              archive_description: zimChunk.archiveMetadata.description,
              extraction_strategy: zimChunk.strategy,
            })
          }

          if (
            pendingTexts.length >= ZIM_FLUSH_CHUNK_COUNT ||
            articlesSeen - lastFlushedAt >= ZIM_FLUSH_ARTICLE_INTERVAL
          ) {
            return await flush(articlesSeen)
          }
          return true
        }
      )

  if (streamResult.cancelled) {
    await Promise.allSettled(inFlight)
    logger.info(
      `[RAG] ZIM stream cancelled at article offset; ${totalChunks} chunks embedded so far`
    )
    return {
      success: false,
      cancelled: true,
      message: 'ZIM processing cancelled.',
      chunks: totalChunks,
      totalArticles: streamResult.totalArticles,
    }
  }

  await flush(streamResult.articlesProcessed + (startOffset || 0))
  await Promise.all(inFlight)

  if (cancelled) {
    return {
      success: false,
      cancelled: true,
      message: 'ZIM processing cancelled.',
      chunks: totalChunks,
      totalArticles: streamResult.totalArticles,
    }
  }

  logger.info(
    `[RAG] Successfully embedded ${totalChunks} total chunks from ${streamResult.articlesProcessed} articles`
  )

  if (deleteAfterEmbedding) {
    logger.info(
      `[RAG] ZIM processing complete, keeping file on disk (ZIM files are shared across apps): ${filepath}`
    )
  }

  return {
    success: true,
    message: 'ZIM file processed and embedded successfully with enhanced metadata.',
    chunks: totalChunks,
    articlesProcessed: streamResult.articlesProcessed,
    totalArticles: streamResult.totalArticles,
  }
}
