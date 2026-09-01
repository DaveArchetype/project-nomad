import logger from '@adonisjs/core/services/logger'
import { randomUUID } from 'node:crypto'
import KVStore from '#models/kv_store'
import { loadIngestSettings } from '../../utils/ingest_settings.js'
import { EMBEDDING_MODEL_NAME } from '../../../constants/ollama.js'
import { ZIM_QDRANT_UPSERT_BATCH } from '../../../constants/zim_extraction.js'
import {
  CONTENT_COLLECTION_NAME,
  EMBEDDING_DIMENSION,
  MAX_SAFE_TOKENS,
  SEARCH_DOCUMENT_PREFIX,
} from './constants.js'
import type { RagCtx } from './types.js'
import { estimateTokenCount, extractKeywords, sanitizeText, truncateToTokenLimit } from './utils.js'

export async function waitForEmbedPause(): Promise<void> {
  try {
    let logged = false
    while (true) {
      const pausedUntilStr = await KVStore.getValue('rag.embedPausedUntil')
      if (!pausedUntilStr) return
      const pausedUntil = Number.parseInt(pausedUntilStr, 10)
      if (Number.isNaN(pausedUntil)) return
      const remaining = pausedUntil - Date.now()
      if (remaining <= 0) return
      if (!logged) {
        logger.info(
          `[RAG] Embedding paused for chat. Waiting ~${Math.round(remaining / 1000)}s before next batch...`
        )
        logged = true
      }
      await new Promise((r) => setTimeout(r, Math.min(remaining, 5000)))
    }
  } catch (err) {
    logger.warn(
      `[RAG] Failed to check embed pause: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export async function embedAndStoreText(
  ctx: RagCtx,
  text: string,
  metadata: Record<string, any> = {},
  onProgress?: (percent: number) => Promise<void>
): Promise<{ chunks: number } | null> {
  return embedAndStoreChunks(ctx, [text], [metadata], onProgress)
}

export async function embedAndStoreChunks(
  ctx: RagCtx,
  texts: string[],
  metadatas: Record<string, any>[],
  onProgress?: (percent: number) => Promise<void>
): Promise<{ chunks: number } | null> {
  try {
    await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)

    if (!(await ctx.ensureEmbeddingModel())) {
      return null
    }

    const chunker = await ctx.getTokenChunker()

    const prefixedChunks: string[] = []
    const chunkOwners: Array<{
      text: string
      metadata: Record<string, any>
      chunkIndex: number
      totalChunks: number
    }> = []

    const chunkResultsAll = await Promise.all(texts.map((text) => chunker.chunk(text)))

    for (const [t, chunkResults] of chunkResultsAll.entries()) {
      if (!chunkResults || chunkResults.length === 0) {
        continue
      }

      for (let i = 0; i < chunkResults.length; i++) {
        let chunkText = sanitizeText(chunkResults[i].text)

        const prefixText = SEARCH_DOCUMENT_PREFIX
        const estimatedTokens = estimateTokenCount(prefixText + chunkText)

        if (estimatedTokens > MAX_SAFE_TOKENS) {
          const prefixTokens = estimateTokenCount(prefixText)
          const maxTokensForText = MAX_SAFE_TOKENS - prefixTokens
          logger.warn(
            `[RAG] Chunk ${i} of text ${t} estimated at ${estimatedTokens} tokens (${chunkText.length} chars), truncating to ${maxTokensForText} tokens`
          )
          chunkText = truncateToTokenLimit(chunkText, maxTokensForText)
        }

        prefixedChunks.push(SEARCH_DOCUMENT_PREFIX + chunkText)
        chunkOwners.push({
          text: chunkText,
          metadata: metadatas[t] ?? {},
          chunkIndex: i,
          totalChunks: chunkResults.length,
        })
      }
    }

    if (prefixedChunks.length === 0) {
      throw new Error('No text chunks generated for embedding.')
    }

    const embeddings: number[][] = new Array(prefixedChunks.length)
    const ingestSettings = await loadIngestSettings()
    const batchSize = ingestSettings.embeddingBatchSize
    const totalBatches = Math.ceil(prefixedChunks.length / batchSize)
    const EMBED_CONCURRENCY = ingestSettings.embedConcurrency

    const batches: { idx: number; start: number; chunks: string[] }[] = []
    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const batchStart = batchIdx * batchSize
      batches.push({
        idx: batchIdx,
        start: batchStart,
        chunks: prefixedChunks.slice(batchStart, batchStart + batchSize),
      })
    }

    let completedChunks = 0
    for (let i = 0; i < batches.length; i += EMBED_CONCURRENCY) {
      await waitForEmbedPause()

      const wave = batches.slice(i, i + EMBED_CONCURRENCY)
      const results = await Promise.all(
        wave.map(async (b) => {
          logger.debug(
            `[RAG] Embedding batch ${b.idx + 1}/${totalBatches} (${b.chunks.length} chunks)`
          )
          const response = await ctx.ollamaService.embed(
            ctx.getResolvedEmbeddingModel() ?? EMBEDDING_MODEL_NAME,
            b.chunks
          )
          return { start: b.start, embeddings: response.embeddings }
        })
      )

      for (const r of results) {
        for (let j = 0; j < r.embeddings.length; j++) {
          embeddings[r.start + j] = r.embeddings[j]
        }
        completedChunks += r.embeddings.length
      }

      if (onProgress) {
        const progress = (completedChunks / prefixedChunks.length) * 100
        await onProgress(progress)
      }
    }

    const timestamp = Date.now()
    const points = chunkOwners.map((owner, index) => {
      const metadata = owner.metadata

      const sanitizedText = sanitizeText(owner.text)

      const contentKeywords = extractKeywords(sanitizedText)

      let structuralKeywords: string[] = []
      if (metadata.full_title) {
        structuralKeywords = extractKeywords(metadata.full_title as string)
      } else if (metadata.article_title) {
        structuralKeywords = extractKeywords(metadata.article_title as string)
      }

      const allKeywords = [...new Set([...structuralKeywords, ...contentKeywords])]

      const sanitizedSource =
        typeof metadata.source === 'string' ? sanitizeText(metadata.source) : 'unknown'

      return {
        id: randomUUID(),
        vector: embeddings[index],
        payload: {
          ...metadata,
          text: sanitizedText,
          chunk_index: owner.chunkIndex,
          total_chunks: owner.totalChunks,
          keywords: allKeywords.join(' '),
          char_count: sanitizedText.length,
          created_at: timestamp,
          source: sanitizedSource,
        },
      }
    })

    const upsertConcurrency = ingestSettings.qdrantUpsertConcurrency
    const upsertBatches: (typeof points)[] = []
    for (let i = 0; i < points.length; i += ZIM_QDRANT_UPSERT_BATCH) {
      upsertBatches.push(points.slice(i, i + ZIM_QDRANT_UPSERT_BATCH))
    }

    const upsertWithRetry = async (batch: typeof points, maxRetries = 3): Promise<void> => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          await ctx.getQdrant().upsert(CONTENT_COLLECTION_NAME, { points: batch })
          return
        } catch (err) {
          if (attempt < maxRetries) {
            const waitMs = 2000 * (attempt + 1)
            logger.warn(
              `[RAG] Qdrant upsert failed (attempt %d/%d), retrying in %dms: %s`,
              attempt + 1,
              maxRetries + 1,
              waitMs,
              err instanceof Error ? err.message : String(err)
            )
            await new Promise((r) => setTimeout(r, waitMs))
            ctx.resetQdrantClientState()
            await ctx.ensureDependencies()
            await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)
          } else {
            throw err
          }
        }
      }
    }

    let upsertInFlight: Promise<void>[] = []
    for (const batch of upsertBatches) {
      if (upsertInFlight.length >= upsertConcurrency) {
        await upsertInFlight.shift()
      }
      upsertInFlight.push(upsertWithRetry(batch))
    }
    await Promise.all(upsertInFlight)
    upsertInFlight = []

    logger.debug(`[RAG] Successfully embedded and stored ${points.length} chunks`)

    return { chunks: points.length }
  } catch (error) {
    console.error(error)
    logger.error('[RAG] Error embedding text:', error)
    return null
  }
}
