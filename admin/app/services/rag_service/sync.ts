import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'
import KbIngestState from '#models/kb_ingest_state'
import { determineFileType, getFileStatsIfExists } from '../../../utils/fs.js'
import { decideScanAction, type IngestPolicy } from '../../../utils/kb_ingest_decision.js'
import { CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION, FACET_SOURCE_LIMIT } from './constants.js'
import type { RagCtx } from './types.js'
import { deleteCollection } from './qdrant.js'
import { deletePointsBySource } from './artifacts.js'
import {
  discoverKbFiles,
  discoverNomadDocs,
  dispatchEmbedJobsFor,
  hasInflightEmbedJobs,
} from './discovery.js'

export async function scanAndSyncStorage(ctx: RagCtx): Promise<{
  success: boolean
  message: string
  filesScanned?: number
  filesQueued?: number
}> {
  try {
    logger.info('[RAG] Starting knowledge base sync scan')

    await discoverNomadDocs(true).catch((error) => {
      logger.error('[RAG] Error during Nomad docs discovery in sync process:', error)
    })

    const filesInStorage = await discoverKbFiles()
    logger.info(`[RAG] Found ${filesInStorage.length} embeddable files in storage`)

    await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)

    const sourcesInQdrant = new Set<string>()
    const facetResult = await ctx.getQdrant().facet(CONTENT_COLLECTION_NAME, {
      key: 'source',
      limit: FACET_SOURCE_LIMIT,
      exact: true,
    })
    for (const hit of facetResult.hits) {
      if (typeof hit.value === 'string') sourcesInQdrant.add(hit.value)
    }

    logger.info(`[RAG] Found ${sourcesInQdrant.size} unique sources in Qdrant`)

    const stateRows = await KbIngestState.all()
    const stateByPath = new Map(stateRows.map((row) => [row.file_path, row]))

    const embeddableFiles = filesInStorage.filter(
      (filePath) => determineFileType(filePath) !== 'unknown'
    )

    const policyRaw = await KVStore.getValue('rag.defaultIngestPolicy')
    const policy: IngestPolicy = policyRaw === 'Manual' ? 'Manual' : 'Always'

    const filesToEmbed: string[] = []
    let backfilled = 0
    let createdRows = 0
    let createdPending = 0
    let skipped = 0

    for (const filePath of embeddableFiles) {
      const stateRow = stateByPath.get(filePath) ?? null
      const action = decideScanAction(stateRow, sourcesInQdrant.has(filePath), policy)

      switch (action.kind) {
        case 'skip':
          skipped++
          break
        case 'backfill_indexed':
          await KbIngestState.create({
            file_path: filePath,
            state: 'indexed',
            chunks_embedded: 0,
          })
          backfilled++
          break
        case 'create_pending':
          await KbIngestState.create({
            file_path: filePath,
            state: 'pending_decision',
            chunks_embedded: 0,
          })
          createdPending++
          break
        case 'dispatch':
          if (action.createStateRow) {
            await KbIngestState.create({
              file_path: filePath,
              state: 'pending_decision',
              chunks_embedded: 0,
            })
            createdRows++
          }
          filesToEmbed.push(filePath)
          break
      }
    }

    logger.info(
      `[RAG] Scan results (policy=${policy}): ${filesToEmbed.length} to embed, ${backfilled} backfilled, ${createdRows} new pending, ${createdPending} waiting on user, ${skipped} skipped`
    )

    if (filesToEmbed.length === 0) {
      return {
        success: true,
        message: 'Knowledge base is already in sync',
        filesScanned: filesInStorage.length,
        filesQueued: 0,
      }
    }

    const { queuedCount, dedupedCount } = await dispatchEmbedJobsFor(filesToEmbed)
    const dedupeNote = dedupedCount > 0 ? ` (${dedupedCount} already queued)` : ''
    return {
      success: true,
      message: `Scanned ${filesInStorage.length} files, queued ${queuedCount} for embedding${dedupeNote}`,
      filesScanned: filesInStorage.length,
      filesQueued: queuedCount,
    }
  } catch (error) {
    logger.error('[RAG] Error scanning and syncing knowledge base:', error)
    return { success: false, message: 'Error scanning and syncing knowledge base' }
  }
}

export async function reembedAll(ctx: RagCtx): Promise<{
  success: boolean
  message: string
  filesScanned?: number
  filesQueued?: number
  failedPaths?: string[]
}> {
  try {
    if (await hasInflightEmbedJobs()) {
      return {
        success: false,
        message:
          'Embed jobs are already in progress. Wait for the queue to drain (or clean up failed jobs) before triggering a bulk re-embed.',
      }
    }

    logger.info('[RAG] Starting full re-embed (per-file replace)')

    await discoverNomadDocs(true).catch((error) => {
      logger.error('[RAG] Error re-running Nomad docs discovery during re-embed:', error)
    })

    const filesInStorage = await discoverKbFiles()

    await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)

    const { EmbedFileJob } = await import('#jobs/embed_file_job')
    let queuedCount = 0
    const failedPaths: string[] = []
    for (const filePath of filesInStorage) {
      try {
        await deletePointsBySource(ctx, filePath)
      } catch (err) {
        logger.error(`[RAG] Failed to delete prior points for ${filePath}; skipping dispatch:`, err)
        failedPaths.push(filePath)
        continue
      }
      try {
        const fileName = filePath.split(/[/\\]/).pop() || filePath
        const stats = await getFileStatsIfExists(filePath)
        const result = await EmbedFileJob.dispatch(
          { filePath, fileName, fileSize: stats?.size },
          { force: true }
        )
        if (result.created) queuedCount++
      } catch (fileError) {
        logger.error(
          `[RAG] Re-embed dispatch failed for ${filePath} after delete; file is now unindexed until next sync:`,
          fileError
        )
        failedPaths.push(filePath)
      }
    }

    logger.info(
      `[RAG] Re-embed dispatched ${queuedCount}/${filesInStorage.length} files` +
        (failedPaths.length > 0 ? ` (${failedPaths.length} failed)` : '')
    )

    const failureSuffix =
      failedPaths.length > 0
        ? ` ${failedPaths.length} file${failedPaths.length === 1 ? '' : 's'} failed to dispatch and are temporarily unindexed — run a sync rescan to recover.`
        : ''

    return {
      success: failedPaths.length === 0,
      message:
        `Re-embedding ${queuedCount} file${queuedCount === 1 ? '' : 's'}. Existing points were replaced.` +
        failureSuffix,
      filesScanned: filesInStorage.length,
      filesQueued: queuedCount,
      ...(failedPaths.length > 0 ? { failedPaths } : {}),
    }
  } catch (error) {
    logger.error('[RAG] Error during re-embed:', error)
    return { success: false, message: 'Error during re-embed' }
  }
}

export async function resetAndRebuild(ctx: RagCtx): Promise<{
  success: boolean
  message: string
  filesScanned?: number
  filesQueued?: number
  failedPaths?: string[]
}> {
  try {
    if (await hasInflightEmbedJobs()) {
      return {
        success: false,
        message:
          'Embed jobs are already in progress. Wait for the queue to drain (or clean up failed jobs) before triggering a reset.',
      }
    }

    logger.info('[RAG] Starting destructive reset & rebuild')

    await ctx.initializeQdrantClient()
    try {
      await deleteCollection(ctx, CONTENT_COLLECTION_NAME)
      logger.info(`[RAG] Dropped collection ${CONTENT_COLLECTION_NAME}`)
    } catch (err) {
      logger.warn(`[RAG] deleteCollection failed (may not exist): ${(err as Error).message}`)
    }

    ctx.dropEnsuredCollection(CONTENT_COLLECTION_NAME)

    await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)

    await KVStore.setValue('rag.docsEmbedded', false)
    await discoverNomadDocs(true).catch((error) => {
      logger.error('[RAG] Error re-running Nomad docs discovery after reset:', error)
    })

    const filesInStorage = await discoverKbFiles()
    const { queuedCount, failedPaths } = await dispatchEmbedJobsFor(filesInStorage, {
      force: true,
    })

    logger.info(
      `[RAG] Reset complete — dispatched ${queuedCount}/${filesInStorage.length} files` +
        (failedPaths.length > 0 ? ` (${failedPaths.length} failed)` : '')
    )

    const failureSuffix =
      failedPaths.length > 0
        ? ` ${failedPaths.length} file${failedPaths.length === 1 ? '' : 's'} failed to dispatch and are temporarily unindexed — run a sync rescan to recover.`
        : ''

    return {
      success: failedPaths.length === 0,
      message:
        `Collection wiped. Queued ${queuedCount} file${queuedCount === 1 ? '' : 's'} for a full rebuild.` +
        failureSuffix,
      filesScanned: filesInStorage.length,
      filesQueued: queuedCount,
      ...(failedPaths.length > 0 ? { failedPaths } : {}),
    }
  } catch (error) {
    logger.error('[RAG] Error during reset & rebuild:', error)
    return { success: false, message: 'Error during reset & rebuild' }
  }
}
