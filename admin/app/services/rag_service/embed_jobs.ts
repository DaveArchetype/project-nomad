import logger from '@adonisjs/core/services/logger'
import KbIngestState from '#models/kb_ingest_state'
import { determineFileType, getFileStatsIfExists } from '../../utils/fs.js'
import { estimateChunkCount } from '../../utils/kb_ratio_lookup.js'
import KbRatioRegistry from '#models/kb_ratio_registry'
import { CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION, FACET_SOURCE_LIMIT } from './constants.js'
import type { EmbedSingleFileResult, RagCtx } from './types.js'
import { deletePointsBySource } from './artifacts.js'
import { discoverKbFiles, dispatchEmbedJobsFor } from './discovery.js'

export async function embedSingleFile(
  ctx: RagCtx,
  source: string,
  force: boolean = false
): Promise<EmbedSingleFileResult> {
  const stateRow = await KbIngestState.query().where('file_path', source).first()
  if (!stateRow) {
    const knownFiles = await discoverKbFiles()
    if (!knownFiles.includes(source)) {
      return {
        success: false,
        code: 'not_found',
        message: 'File is not a tracked knowledge-base source.',
      }
    }
  }

  const { EmbedFileJob } = await import('#jobs/embed_file_job')
  const { QueueService } = await import('#services/queue_service')
  const queue = QueueService.getInstance().getQueue(EmbedFileJob.queue)
  const inflight = await queue.getJobs(['waiting', 'active', 'delayed', 'paused'])
  if (inflight.some((j) => j.data?.filePath === source)) {
    return {
      success: false,
      code: 'inflight',
      message:
        'A job for this file is already in progress. Wait for it to finish before re-queuing.',
    }
  }

  if (force) {
    try {
      await deletePointsBySource(ctx, source)
    } catch (err) {
      logger.error(`[RAG] Failed to delete prior points for ${source}; aborting re-embed:`, err)
      return {
        success: false,
        code: 'delete_failed',
        message: 'Failed to clear prior embeddings before re-embed.',
      }
    }
  }

  const result = await dispatchEmbedJobsFor([source], { force })
  if (result.failedPaths.length > 0) {
    return {
      success: false,
      code: 'dispatch_failed',
      message: 'Failed to dispatch embed job for this file.',
    }
  }
  return {
    success: true,
    message: force ? 'Re-embed queued for this file.' : 'Indexing queued for this file.',
  }
}

export async function verifyFileEmbeddings(
  ctx: RagCtx,
  source: string
): Promise<{
  ok: boolean
  state: string | null
  chunksInQdrant: number
  chunksEmbeddedRecorded: number
  isZim: boolean
  totalArticles: number | null
  resumeOffset: number | null
  message: string
}> {
  try {
    await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)

    const stateRow = await KbIngestState.findBy('file_path', source)
    const state = stateRow?.state ?? null
    const chunksEmbeddedRecorded = stateRow?.chunks_embedded ?? 0

    const facetResult = await ctx.getQdrant().facet(CONTENT_COLLECTION_NAME, {
      key: 'source',
      limit: FACET_SOURCE_LIMIT,
      exact: true,
    })
    let chunksInQdrant = 0
    for (const hit of facetResult.hits) {
      if (hit.value === source) {
        chunksInQdrant = hit.count
        break
      }
    }

    const isZim = determineFileType(source) === 'zim'
    let totalArticles: number | null = null
    let resumeOffset: number | null = null

    if (isZim) {
      try {
        const { Archive } = await import('@openzim/libzim')
        const archive = new Archive(source)
        totalArticles = Number(archive.articleCount)
      } catch {
        logger.warn(`[RAG] Could not open ZIM to read article count: ${source}`)
      }

      const { EmbedFileJob } = await import('#jobs/embed_file_job')
      const { QueueService } = await import('#services/queue_service')
      const queue = QueueService.getInstance().getQueue(EmbedFileJob.queue)
      const jobId = EmbedFileJob.getJobId(source)
      const job = await queue.getJob(jobId)
      if (job?.data) {
        resumeOffset = (job.data as any).resumeOffset ?? null
      }
    }

    const chunkMismatch =
      chunksInQdrant === 0 && chunksEmbeddedRecorded > 0
        ? true
        : Math.abs(chunksInQdrant - chunksEmbeddedRecorded) >
          Math.max(100, chunksEmbeddedRecorded * 0.05)

    const articleMismatch =
      isZim &&
      totalArticles !== null &&
      resumeOffset !== null &&
      resumeOffset < totalArticles * 0.95

    if (chunkMismatch || articleMismatch) {
      return {
        ok: false,
        state,
        chunksInQdrant,
        chunksEmbeddedRecorded,
        isZim,
        totalArticles,
        resumeOffset,
        message: articleMismatch
          ? `Verification failed: ZIM has ${totalArticles?.toLocaleString()} articles but ingestion only reached article ${resumeOffset?.toLocaleString()}. ${chunksInQdrant.toLocaleString()} chunks in Qdrant.`
          : `Verification failed: ${chunksInQdrant.toLocaleString()} chunks in Qdrant vs ${chunksEmbeddedRecorded.toLocaleString()} recorded. The file may have been partially indexed.`,
      }
    }

    return {
      ok: true,
      state,
      chunksInQdrant,
      chunksEmbeddedRecorded,
      isZim,
      totalArticles,
      resumeOffset,
      message: `Verification passed: ${chunksInQdrant.toLocaleString()} chunks in Qdrant.`,
    }
  } catch (error) {
    logger.error('[RAG] Error verifying file embeddings:', error)
    return {
      ok: false,
      state: null,
      chunksInQdrant: 0,
      chunksEmbeddedRecorded: 0,
      isZim: determineFileType(source) === 'zim',
      totalArticles: null,
      resumeOffset: null,
      message: `Verification error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

export async function resumeFileIngestion(
  _ctx: RagCtx,
  source: string
): Promise<EmbedSingleFileResult> {
  const isZim = determineFileType(source) === 'zim'
  if (!isZim) {
    return {
      success: false,
      code: 'not_found',
      message: 'Resume is only available for ZIM files.',
    }
  }

  const stateRow = await KbIngestState.query().where('file_path', source).first()
  if (!stateRow) {
    return {
      success: false,
      code: 'not_found',
      message: 'File is not a tracked knowledge-base source.',
    }
  }

  const { EmbedFileJob } = await import('#jobs/embed_file_job')
  const { QueueService } = await import('#services/queue_service')
  const queue = QueueService.getInstance().getQueue(EmbedFileJob.queue)

  const inflight = await queue.getJobs(['waiting', 'active', 'delayed', 'paused'])
  if (inflight.some((j) => j.data?.filePath === source)) {
    return {
      success: false,
      code: 'inflight',
      message: 'A job for this file is already in progress. Wait for it to finish before resuming.',
    }
  }

  const jobId = EmbedFileJob.getJobId(source)
  const priorJob = await queue.getJob(jobId)
  const priorData = priorJob?.data as any
  const resumeOffset = priorData?.resumeOffset ?? 0
  const chunksSoFar = priorData?.chunksSoFar ?? stateRow.chunks_embedded ?? 0
  const totalArticles = priorData?.totalArticles

  if (resumeOffset === 0) {
    return {
      success: false,
      code: 'not_found',
      message: 'No resume offset found for this file. Use Re-embed to start from scratch instead.',
    }
  }

  const fileName = source.split(/[/\\]/).pop() || source
  const collection = stateRow.collection ?? undefined

  try {
    await priorJob?.remove().catch(() => {})
  } catch {
    // If the old job can't be removed (already gone), that's fine —
    // dispatch with force to bypass the jobId dedupe.
  }

  const result = await EmbedFileJob.dispatch(
    {
      filePath: source,
      fileName,
      resumeOffset,
      chunksSoFar,
      totalArticles,
      isFinalBatch: true,
      ...(collection ? { collection } : {}),
    },
    { force: true }
  )

  if (!result.created) {
    return {
      success: false,
      code: 'inflight',
      message: 'A job for this file already exists. Wait for it to finish.',
    }
  }

  return {
    success: true,
    message: `Resuming ingestion from article ${resumeOffset.toLocaleString()} (${chunksSoFar.toLocaleString()} chunks already embedded).`,
  }
}

async function scanAndDispatchRepair(
  ctx: RagCtx,
  source: string,
  fileName: string,
  collection: string | undefined,
  jobId: string
): Promise<void> {
  await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)

  logger.info(`[RAG] Repair: scanning Qdrant for existing article paths in ${source}`)

  const qdrant = ctx.getQdrant()
  const embeddedPaths = new Set<string>()
  let totalQdrantPoints = 0
  let scrollOffset: string | number | undefined
  const scrollBatchSize = 1000

  while (true) {
    const scrollResult = await qdrant.scroll(CONTENT_COLLECTION_NAME, {
      filter: { must: [{ key: 'source', match: { value: source } }] },
      limit: scrollBatchSize,
      offset: scrollOffset,
      with_payload: { include: ['article_path'] },
      with_vector: false,
    })

    const points = scrollResult.points || []
    totalQdrantPoints += points.length
    for (const point of points) {
      const payload = point.payload as any
      if (payload?.article_path) {
        embeddedPaths.add(payload.article_path)
      }
    }

    if (!scrollResult.next_page_offset) break
    scrollOffset = scrollResult.next_page_offset as string | number | undefined
  }

  logger.info(
    `[RAG] Repair: found ${embeddedPaths.size} unique article paths (${totalQdrantPoints} total points) already in Qdrant for ${source}`
  )

  const { Archive } = await import('@openzim/libzim')
  const archive = new Archive(source)
  const allArticlePaths = new Set<string>()
  for (const entry of archive.iterByPath()) {
    try {
      if (entry.isRedirect) continue
      const item = entry.item
      const mimeType = item.mimetype
      if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
        allArticlePaths.add(entry.path)
      }
    } catch {
      continue
    }
  }

  const missingPaths = [...allArticlePaths].filter((p) => !embeddedPaths.has(p))

  logger.info(
    `[RAG] Repair: ${allArticlePaths.size} total articles in ZIM, ${embeddedPaths.size} embedded, ${missingPaths.length} missing`
  )

  if (missingPaths.length === 0) {
    logger.info(`[RAG] Repair: no missing articles found for ${source}`)
    const stateRow = await KbIngestState.query().where('file_path', source).first()
    const recordedChunks = stateRow?.chunks_embedded ?? 0
    if (stateRow && totalQdrantPoints !== recordedChunks) {
      logger.info(
        `[RAG] Repair: syncing DB chunk count from ${recordedChunks} to ${totalQdrantPoints} for ${source}`
      )
      stateRow.chunks_embedded = totalQdrantPoints
      await stateRow.save()
    }
    return
  }

  const { EmbedFileJob } = await import('#jobs/embed_file_job')
  const { QueueService } = await import('#services/queue_service')
  const queue = QueueService.getInstance().getQueue(EmbedFileJob.queue)

  try {
    const existing = await queue.getJob(jobId)
    await existing?.remove().catch(() => {})
  } catch {
    // If the old repair job can't be removed, force-dispatch
  }

  const result = await EmbedFileJob.dispatch(
    {
      filePath: source,
      fileName,
      repairPaths: missingPaths,
      isFinalBatch: true,
      ...(collection ? { collection } : {}),
    },
    { jobId, force: true }
  )

  if (!result.created) {
    logger.warn(`[RAG] Repair: could not dispatch repair job for ${source} (already exists)`)
    return
  }

  logger.info(
    `[RAG] Repair: dispatched repair job for ${source} with ${missingPaths.length.toLocaleString()} missing articles`
  )
}

export async function repairAllFiles(ctx: RagCtx): Promise<{
  synced: string[]
  scanning: string[]
  skipped: string[]
  errors: Array<{ source: string; error: string }>
}> {
  const allStates = await KbIngestState.query()
  const zimStates = allStates.filter((s) => determineFileType(s.file_path) === 'zim')

  const synced: string[] = []
  const scanning: string[] = []
  const skipped: string[] = []
  const errors: Array<{ source: string; error: string }> = []

  await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)

  const facetResult = await ctx.getQdrant().facet(CONTENT_COLLECTION_NAME, {
    key: 'source',
    limit: FACET_SOURCE_LIMIT,
    exact: true,
  })
  const qdrantCounts = new Map<string, number>()
  for (const hit of facetResult.hits) {
    if (typeof hit.value === 'string') qdrantCounts.set(hit.value, hit.count)
  }

  const ratioRows = await KbRatioRegistry.all().catch(() => [])

  for (const stateRow of zimStates) {
    const source = stateRow.file_path
    try {
      const chunksInQdrant = qdrantCounts.get(source) ?? 0
      const recordedChunks = stateRow.chunks_embedded ?? 0

      let chunksEstimated: number | null = null
      try {
        const fileStats = await getFileStatsIfExists(source)
        const sizeBytes = Number(fileStats?.size ?? 0)
        if (sizeBytes > 0) {
          const fileName = source.split(/[/\\]/).pop() || source
          chunksEstimated = estimateChunkCount(fileName, sizeBytes, ratioRows)
        }
      } catch {
        // Non-fatal
      }

      const belowEstimate =
        chunksEstimated !== null && chunksEstimated > 0 && chunksInQdrant < chunksEstimated * 0.5

      if (chunksInQdrant >= recordedChunks && !belowEstimate) {
        if (chunksInQdrant !== recordedChunks) {
          stateRow.chunks_embedded = chunksInQdrant
          await stateRow.save()
          synced.push(source)
          logger.info(
            `[RAG] Repair-all: synced ${source} count ${recordedChunks} → ${chunksInQdrant}`
          )
        } else {
          skipped.push(source)
        }
        continue
      }

      const fileName = source.split(/[/\\]/).pop() || source
      const collection = stateRow.collection ?? undefined
      const { EmbedFileJob } = await import('#jobs/embed_file_job')
      const jobId = `repair-${EmbedFileJob.getJobId(source)}`

      setImmediate(() => {
        scanAndDispatchRepair(ctx, source, fileName, collection, jobId).catch((err) => {
          logger.error(`[RAG] Repair-all scan failed for ${source}: %s`, err)
        })
      })
      scanning.push(source)
    } catch (err) {
      errors.push({
        source,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  logger.info(
    `[RAG] Repair-all: ${synced.length} synced, ${scanning.length} scanning, ${skipped.length} ok, ${errors.length} errors`
  )

  return { synced, scanning, skipped, errors }
}

export async function repairFileIngestion(
  ctx: RagCtx,
  source: string
): Promise<EmbedSingleFileResult> {
  const isZim = determineFileType(source) === 'zim'
  if (!isZim) {
    return {
      success: false,
      code: 'not_found',
      message: 'Repair is only available for ZIM files.',
    }
  }

  const stateRow = await KbIngestState.query().where('file_path', source).first()
  if (!stateRow) {
    return {
      success: false,
      code: 'not_found',
      message: 'File is not a tracked knowledge-base source.',
    }
  }

  const { EmbedFileJob } = await import('#jobs/embed_file_job')
  const { QueueService } = await import('#services/queue_service')
  const queue = QueueService.getInstance().getQueue(EmbedFileJob.queue)

  const inflight = await queue.getJobs(['waiting', 'active', 'delayed', 'paused'])
  if (inflight.some((j) => j.data?.filePath === source)) {
    return {
      success: false,
      code: 'inflight',
      message:
        'A job for this file is already in progress. Wait for it to finish before repairing.',
    }
  }

  const fileName = source.split(/[/\\]/).pop() || source
  const collection = stateRow.collection ?? undefined
  const jobId = `repair-${EmbedFileJob.getJobId(source)}`
  const recordedChunks = stateRow.chunks_embedded ?? 0

  await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)

  const facetResult = await ctx.getQdrant().facet(CONTENT_COLLECTION_NAME, {
    key: 'source',
    limit: FACET_SOURCE_LIMIT,
    exact: true,
  })
  let chunksInQdrant = 0
  for (const hit of facetResult.hits) {
    if (hit.value === source) {
      chunksInQdrant = hit.count
      break
    }
  }

  let chunksEstimated: number | null = null
  try {
    const fileStats = await getFileStatsIfExists(source)
    const sizeBytes = Number(fileStats?.size ?? 0)
    if (sizeBytes > 0) {
      const ratioRows = await KbRatioRegistry.all().catch(() => [])
      chunksEstimated = estimateChunkCount(fileName, sizeBytes, ratioRows)
    }
  } catch {
    // Non-fatal — falls back to count-only comparison
  }

  const belowEstimate =
    chunksEstimated !== null && chunksEstimated > 0 && chunksInQdrant < chunksEstimated * 0.5

  if (chunksInQdrant >= recordedChunks && !belowEstimate) {
    logger.info(
      `[RAG] Repair: Qdrant has ${chunksInQdrant} points, DB has ${recordedChunks} — syncing DB count`
    )
    if (chunksInQdrant !== recordedChunks) {
      stateRow.chunks_embedded = chunksInQdrant
      await stateRow.save()
    }
    return {
      success: true,
      message: `Synced chunk count: ${recordedChunks.toLocaleString()} → ${chunksInQdrant.toLocaleString()}. No missing articles to repair.`,
    }
  }

  const reason = belowEstimate
    ? `Qdrant has ${chunksInQdrant.toLocaleString()} chunks but estimate is ${chunksEstimated!.toLocaleString()}`
    : `Qdrant has ${chunksInQdrant.toLocaleString()} chunks vs ${recordedChunks.toLocaleString()} recorded`

  setImmediate(() => {
    scanAndDispatchRepair(ctx, source, fileName, collection, jobId).catch((err) => {
      logger.error(`[RAG] Repair scan failed for ${source}: %s`, err)
    })
  })

  return {
    success: true,
    message: `Repair scan started: ${reason}. Missing articles will be queued for re-embedding shortly.`,
  }
}
