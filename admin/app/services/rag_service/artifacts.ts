import { join, resolve, sep } from 'node:path'
import logger from '@adonisjs/core/services/logger'
import KbIngestState from '#models/kb_ingest_state'
import { deleteFileIfExists } from '../../utils/fs.js'
import { CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION, UPLOADS_STORAGE_PATH } from './constants.js'
import type { RagCtx } from './types.js'

export async function deletePointsBySource(ctx: RagCtx, source: string): Promise<void> {
  await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)
  await ctx.getQdrant().delete(CONTENT_COLLECTION_NAME, {
    filter: { must: [{ key: 'source', match: { value: source } }] },
  })
}

export async function removeKnowledgeArtifacts(ctx: RagCtx, source: string): Promise<void> {
  await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)

  await ctx.getQdrant().delete(CONTENT_COLLECTION_NAME, {
    filter: {
      must: [{ key: 'source', match: { value: source } }],
    },
  })

  logger.info(`[RAG] Deleted all points for source: ${source}`)

  await KbIngestState.remove(source)

  const { EmbedFileJob } = await import('#jobs/embed_file_job')
  const { QueueService } = await import('#services/queue_service')
  const queue = QueueService.getInstance().getQueue(EmbedFileJob.queue)
  const jobEntries = await queue.getJobs(['waiting', 'delayed', 'paused', 'failed', 'completed'])
  for (const jobEntry of jobEntries) {
    if ((jobEntry.data as any)?.filePath !== source) continue
    try {
      await jobEntry.remove()
    } catch (err) {
      logger.warn(
        `[RAG] Could not remove job entry for ${source} (likely still active): %s`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }
}

export async function deleteFileBySource(
  ctx: RagCtx,
  source: string
): Promise<{ success: boolean; message: string }> {
  try {
    await removeKnowledgeArtifacts(ctx, source)

    const uploadsAbsPath = join(process.cwd(), UPLOADS_STORAGE_PATH)
    const resolvedSource = resolve(source)
    if (resolvedSource.startsWith(uploadsAbsPath + sep)) {
      await deleteFileIfExists(resolvedSource)
      logger.info(`[RAG] Deleted uploaded file from disk: ${resolvedSource}`)
    } else {
      logger.warn(
        `[RAG] File was removed from knowledge base but doesn't live in Nomad's uploads directory, so it can't be safely removed. Skipping deletion of physical file...`
      )
    }

    return { success: true, message: 'File removed from knowledge base.' }
  } catch (error) {
    logger.error('[RAG] Error deleting file from knowledge base:', error)
    return { success: false, message: 'Error deleting file from knowledge base.' }
  }
}
