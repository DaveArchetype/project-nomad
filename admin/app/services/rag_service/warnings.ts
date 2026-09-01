import { join } from 'node:path'
import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'
import KbIngestState from '#models/kb_ingest_state'
import KbRatioRegistry from '#models/kb_ratio_registry'
import {
  getFileStatsIfExists,
  listDirectoryContentsRecursive,
  ZIM_STORAGE_PATH,
} from '../../utils/fs.js'
import { decideWarnings } from '../../utils/kb_warning_decision.js'
import type { FileWarning, FileWarningsResult } from '../../../types/rag.js'
import {
  CONTENT_COLLECTION_NAME,
  EMBEDDING_DIMENSION,
  FACET_SOURCE_LIMIT,
  UPLOADS_STORAGE_PATH,
} from './constants.js'
import type { RagCtx } from './types.js'

export async function getPolicyPromptState(): Promise<{
  shouldPrompt: boolean
  hasContent: boolean
  totalFiles: number
}> {
  const policy = await KVStore.getValue('rag.defaultIngestPolicy')
  const countRow = await KbIngestState.query().count('* as total').first()
  const totalFiles = Number((countRow as any)?.$extras?.total ?? 0)
  return {
    shouldPrompt: policy === null && totalFiles > 0,
    hasContent: totalFiles > 0,
    totalFiles,
  }
}

export async function computeFileWarnings(ctx: RagCtx): Promise<FileWarningsResult> {
  try {
    await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)

    const { EmbedFileJob } = await import('#jobs/embed_file_job')
    const { QueueService } = await import('#services/queue_service')
    const inflightQueue = QueueService.getInstance().getQueue(EmbedFileJob.queue)
    const inflightJobs = await inflightQueue.getJobs(['waiting', 'active', 'delayed', 'paused'])
    const inflightSources = new Set<string>()
    for (const j of inflightJobs) {
      const fp = (j.data as any)?.filePath as string | undefined
      if (fp) inflightSources.add(fp)
    }

    const qdrant = ctx.getQdrant()
    const chunksBySource = new Map<string, number>()
    const facetResult = await qdrant.facet(CONTENT_COLLECTION_NAME, {
      key: 'source',
      limit: FACET_SOURCE_LIMIT,
      exact: true,
    })
    for (const hit of facetResult.hits) {
      if (typeof hit.value === 'string') chunksBySource.set(hit.value, hit.count)
    }

    const KB_UPLOADS_PATH = join(process.cwd(), UPLOADS_STORAGE_PATH)
    const ZIM_PATH = join(process.cwd(), ZIM_STORAGE_PATH)
    const allSources = new Set<string>(chunksBySource.keys())
    const sizeByPath = new Map<string, number>()

    for (const dir of [KB_UPLOADS_PATH, ZIM_PATH]) {
      try {
        const entries = await listDirectoryContentsRecursive(dir)
        for (const entry of entries) {
          if (entry.type !== 'file') continue
          allSources.add(entry.key)
          const stat = await getFileStatsIfExists(entry.key)
          if (stat) sizeByPath.set(entry.key, Number(stat.size))
        }
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error
      }
    }

    const out: Record<string, FileWarning[]> = {}
    for (const source of allSources) {
      if (inflightSources.has(source)) continue
      const fileSizeBytes = sizeByPath.get(source) ?? 0
      const chunksInQdrant = chunksBySource.get(source) ?? 0
      const fileName = source.split(/[/\\]/).pop() ?? source
      const expectedChunks =
        fileSizeBytes > 0
          ? await KbRatioRegistry.estimateChunks(fileName, fileSizeBytes, {
              ignoreCatchAll: true,
            })
          : null

      const warnings = decideWarnings({ fileSizeBytes, chunksInQdrant, expectedChunks })
      if (warnings.length > 0) out[source] = warnings
    }

    return { ok: true, warnings: out }
  } catch (error) {
    logger.error('[RAG] Error computing file warnings:', error)
    return { ok: false, warnings: {} }
  }
}
