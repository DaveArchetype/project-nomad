import { Job, UnrecoverableError } from 'bullmq'
import { QueueService } from '#services/queue_service'
import { EmbedJobWithProgress } from '../../types/rag.js'
import { RagService } from '#services/rag_service'
import { DockerService } from '#services/docker_service'
import { OllamaService } from '#services/ollama_service'
import KbIngestState from '#models/kb_ingest_state'
import KVStore from '#models/kv_store'
import { createHash } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import fs from 'node:fs/promises'
import { determineFileType, getFileStatsIfExists } from '../utils/fs.js'
import KbRatioRegistry from '#models/kb_ratio_registry'
import { estimateChunkCount } from '../utils/kb_ratio_lookup.js'
import { loadIngestSettings } from '../utils/ingest_settings.js'

export interface EmbedFileJobParams {
  filePath: string
  fileName: string
  fileSize?: number
  // ZIM resume support: article offset persisted at each flush so a BullMQ
  // retry continues where the last attempt left off instead of restarting.
  resumeOffset?: number
  batchOffset?: number
  totalArticles?: number
  isFinalBatch?: boolean
  chunksSoFar?: number
  collection?: string
  prevChunksSoFar?: number
  prevBatchAt?: number
  prevResumeOffset?: number
  // Repair mode: when set, only articles whose paths are in this set are
  // re-extracted and re-embedded. Used by repairFileIngestion to fill gaps
  // left by failed embed batches during the original ingestion.
  repairPaths?: string[]
}

export class EmbedFileJob {
  static get queue() {
    return 'file-embeddings'
  }

  static get key() {
    return 'embed-file'
  }

  // Single-job ZIM ingestions can run for days; each flush re-anchors the BullMQ
  // lock for this long so a long CPU stretch between flushes can't stall the job.
  static readonly ZIM_LOCK_DURATION_MS = 1_800_000

  static getJobId(filePath: string): string {
    return createHash('sha256').update(filePath).digest('hex').slice(0, 16)
  }

  /** Calls job.updateProgress but silently ignores "Missing key" errors (code -1),
   *  which occur when the job has been removed from Redis (e.g. cancelled externally)
   *  between the time the await was issued and the Redis write completed. */
  private async safeUpdateProgress(job: Job, progress: number): Promise<void> {
    try {
      await job.updateProgress(progress)
    } catch (err: any) {
      if (err?.code !== -1) throw err
    }
  }

  private async safeExtendLock(job: Job): Promise<void> {
    try {
      if (job.token) {
        await job.extendLock(job.token, EmbedFileJob.ZIM_LOCK_DURATION_MS)
      }
    } catch (err) {
      logger.warn(
        `[EmbedFileJob] Failed to extend job lock: %s`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  /** Checks whether a specific job is individually paused via the
   *  `rag.embedPausedJobs` KV key (a JSON array of job IDs). */
  static async isJobPaused(jobId: string): Promise<boolean> {
    const raw = await KVStore.getValue('rag.embedPausedJobs')
    if (!raw) return false
    try {
      const ids: string[] = JSON.parse(raw)
      return Array.isArray(ids) && ids.includes(jobId)
    } catch {
      return false
    }
  }

  /** Checks whether the global pause-all flag is set. */
  static async isAllPaused(): Promise<boolean> {
    return (await KVStore.getValue('rag.embedAllPaused')) === true
  }

  /** Returns true if either the global pause or this job's individual pause
   *  flag is set. Used by the onFlush callback to decide whether to wait. */
  static async isPaused(jobId: string): Promise<boolean> {
    const [allPaused, jobPaused] = await Promise.all([
      EmbedFileJob.isAllPaused(),
      EmbedFileJob.isJobPaused(jobId),
    ])
    return allPaused || jobPaused
  }

  /** Blocks until neither the global pause nor this job's individual pause
   *  flag is set. Re-anchors the BullMQ lock every 30s while waiting so the
   *  job isn't reaped mid-pause. Returns false if the job was cancelled
   *  (queue obliterated) while waiting. */
  private async waitForResume(job: Job): Promise<boolean> {
    const jobId = job.id ?? ''
    let logged = false
    while (true) {
      const paused = await EmbedFileJob.isPaused(jobId)
      if (!paused) {
        if (logged) {
          logger.info(`[EmbedFileJob] Resuming job ${jobId} after pause`)
        }
        return true
      }

      if (!logged) {
        logger.info(`[EmbedFileJob] Job ${jobId} paused, waiting for resume...`)
        logged = true
        await job.updateData({ ...job.data, status: 'paused', pausedAt: Date.now() })
      }

      await this.safeExtendLock(job)

      const stillQueued = await QueueService.getInstance()
        .getQueue(EmbedFileJob.queue)
        .getJob(jobId)
      if (!stillQueued) {
        return false
      }

      await new Promise((resolve) => setTimeout(resolve, 5_000))
    }
  }

  async handle(job: Job) {
    const { filePath, fileName, totalArticles, collection, repairPaths } =
      job.data as EmbedFileJobParams

    const isRepair = repairPaths && repairPaths.length > 0

    // Only the direct KB-upload controller passes `collection` on dispatch; the other
    // six dispatch sites (download auto-index, scan/sync, re-embed, local ZIM upload,
    // replaced-file reconcile, and this job's own ZIM batch continuation) do not. Fall
    // back to whatever the file is already assigned to, so an assignment made *before*
    // the file was indexed still reaches the vectors. Resolving it here rather than at
    // each dispatch site keeps one source of truth and covers batch continuations too.
    const ingestState = await KbIngestState.findBy('file_path', filePath)
    const effectiveCollection = collection ?? ingestState?.collection ?? undefined

    const isZim = determineFileType(filePath) === 'zim'
    const resumeOffset = job.data.resumeOffset ?? job.data.batchOffset
    const resumeInfo = isRepair
      ? ` (repairing ${repairPaths!.length} missing articles)`
      : resumeOffset
        ? ` (resuming at article ${resumeOffset})`
        : ''
    logger.info(`[EmbedFileJob] Starting embedding process for: ${fileName}${resumeInfo}`)

    const chunksSoFar = isZim ? job.data.chunksSoFar || 0 : 0
    let chunksEstimated: number | null = null
    if (isZim) {
      try {
        const fileStats = await getFileStatsIfExists(filePath)
        const sizeBytes = job.data.fileSize ?? Number(fileStats?.size ?? 0)
        if (sizeBytes > 0) {
          const ratioRows = await KbRatioRegistry.all().catch(() => [])
          chunksEstimated = estimateChunkCount(fileName, sizeBytes, ratioRows)
        }
      } catch {
        // Non-fatal — falls back to article-based progress
      }
    }

    const dockerService = new DockerService()
    const ollamaService = new OllamaService()
    const ragService = new RagService(dockerService, ollamaService)

    try {
      // Check if Ollama and Qdrant services are installed and ready
      // Use UnrecoverableError for "not installed" so BullMQ won't retry —
      // retrying 30x when the service doesn't exist just wastes Redis connections
      const ollamaUrl = await dockerService.getServiceURL('nomad_ollama')
      if (!ollamaUrl) {
        logger.warn('[EmbedFileJob] Ollama is not installed. Skipping embedding for: %s', fileName)
        throw new UnrecoverableError(
          'Ollama service is not installed. Install AI Assistant to enable file embeddings.'
        )
      }

      const existingModels = await ollamaService.getModels()
      if (!existingModels) {
        logger.warn('[EmbedFileJob] Ollama service not ready yet. Will retry...')
        throw new Error('Ollama service not ready yet')
      }

      const qdrantUrl = await dockerService.getServiceURL('nomad_qdrant')
      if (!qdrantUrl) {
        logger.warn('[EmbedFileJob] Qdrant is not installed. Skipping embedding for: %s', fileName)
        throw new UnrecoverableError(
          'Qdrant service is not installed. Install AI Assistant to enable file embeddings.'
        )
      }

      logger.info(`[EmbedFileJob] Services ready. Processing file: ${fileName}`)

      // Anchor initial progress to the resume point so a retried ZIM job
      // doesn't flash the gauge back to ~0 before the first flush reports in.
      // For ZIMs, prefer chunks-based progress (chunksSoFar / chunksEstimated)
      // so a resume of a massive ZIM shows meaningful progress instead of
      // rounding to 0% on article-based math (e.g. 69k/18.9M articles = 0.37%
      // but 760k/31.9M chunks = 2.38%). Falls back to article-based, then 0.
      const initialPercent = isZim
        ? chunksEstimated && chunksEstimated > 0 && chunksSoFar > 0
          ? Math.min(99, Math.round((chunksSoFar / chunksEstimated) * 100))
          : totalArticles && totalArticles > 0 && resumeOffset
            ? Math.min(99, Math.round((resumeOffset / totalArticles) * 100))
            : 0
        : 5
      await this.safeUpdateProgress(job, initialPercent)
      await job.updateData({
        ...job.data,
        status: 'processing',
        startedAt: job.data.startedAt || Date.now(),
      })

      logger.info(`[EmbedFileJob] Processing file: ${filePath}`)

      // ZIM progress arrives already in the overall-file frame (articlesSeen /
      // totalArticles reported at each flush). Other file types report 0-100
      // through their own pipeline, mapped to the 5-95% job range as before.
      const onProgress = async (percent: number) => {
        if (isZim) {
          await this.safeUpdateProgress(job, Math.min(99, Math.round(percent)))
        } else {
          await this.safeUpdateProgress(job, Math.min(95, Math.round(5 + percent * 0.9)))
        }
      }

      // Chunks embedded by prior attempts of this same job (ZIM resume). Each
      // flush re-persists the running total so a crash mid-file keeps count.
      const baseChunks = chunksSoFar

      // Called by RagService after every ZIM flush. Persists the resume offset
      // (BullMQ retries pick it up via job data), re-anchors the job lock, and
      // detects external cancellation: cancelAllJobs() obliterates the queue
      // (including this active job), so if our own job key is gone, the cancel
      // happened — return false to unwind the stream cleanly.
      const onFlush = async (
        articlesSeen: number,
        chunksEmbedded: number,
        totalArticlesCount: number
      ) => {
        try {
          const newChunks = baseChunks + chunksEmbedded
          const now = Date.now()
          await job.updateData({
            ...job.data,
            prevChunksSoFar: job.data.chunksSoFar ?? 0,
            prevBatchAt: job.data.lastBatchAt ?? now,
            prevResumeOffset: job.data.resumeOffset ?? 0,
            resumeOffset: articlesSeen,
            chunksSoFar: newChunks,
            totalArticles: totalArticlesCount,
            lastBatchAt: now,
          })
        } catch {
          // The job was obliterated underneath us (cancelAllJobs) — treat as
          // cancellation and unwind the stream instead of erroring out.
          return false
        }
        await this.safeExtendLock(job)

        const stillQueued = await QueueService.getInstance()
          .getQueue(EmbedFileJob.queue)
          .getJob(job.id!)
        if (!stillQueued) return false

        // Between batches: if the operator paused this job (or all jobs),
        // block here until resumed. The lock is re-anchored inside
        // waitForResume so BullMQ doesn't reap the job mid-pause.
        const canContinue = await this.waitForResume(job)
        if (!canContinue) return false

        // Restore processing status in case we were paused
        if (job.data.status === 'paused') {
          await job.updateData({ ...job.data, status: 'processing' }).catch(() => {})
        }

        return true
      }

      // Process and embed the file
      // Only allow deletion if explicitly marked as final batch
      const allowDeletion = job.data.isFinalBatch === true
      const result = await ragService.processAndEmbedFile(filePath, allowDeletion, {
        startOffset: isZim ? resumeOffset : undefined,
        onProgress,
        onFlush: isZim ? onFlush : undefined,
        collection: effectiveCollection,
        chunksEstimated: isZim ? (chunksEstimated ?? undefined) : undefined,
        baseChunks: isZim ? baseChunks : undefined,
        repairPaths: isRepair ? repairPaths : undefined,
      })

      if (result.cancelled) {
        logger.info(`[EmbedFileJob] Job ${fileName} was cancelled mid-stream; not retrying`)
        return { success: false, cancelled: true, fileName, filePath }
      }

      if (!result.success) {
        logger.error(`[EmbedFileJob] Failed to process file ${fileName}: ${result.message}`)
        throw new Error(result.message)
      }

      const totalChunks = baseChunks + (result.chunks || 0)

      if (
        !isRepair &&
        isZim &&
        result.totalArticles &&
        result.totalArticles > 0 &&
        result.articlesProcessed !== undefined &&
        result.articlesProcessed < result.totalArticles * 0.95
      ) {
        logger.error(
          `[EmbedFileJob] ZIM ${fileName} completed but only processed ${result.articlesProcessed}/${result.totalArticles} articles (${totalChunks} chunks) — marking as stalled, not indexed`
        )
        await job.updateData({
          ...job.data,
          status: 'failed',
          failedAt: Date.now(),
          error: `Partial ingestion: only ${result.articlesProcessed}/${result.totalArticles} articles were processed`,
          chunks: totalChunks,
        })
        try {
          await KbIngestState.markStalled(filePath)
        } catch (stateErr) {
          logger.warn(
            `[EmbedFileJob] Failed to persist stalled state for ${fileName}: %s`,
            stateErr instanceof Error ? stateErr.message : String(stateErr)
          )
        }
        throw new Error(
          `ZIM ingestion incomplete: only ${result.articlesProcessed}/${result.totalArticles} articles processed. The file has been marked as stalled — use Verify then Resume to continue from where it left off.`
        )
      }

      await this.safeUpdateProgress(job, 100)
      await job.updateData({
        ...job.data,
        status: 'completed',
        completedAt: Date.now(),
        chunks: totalChunks,
      })

      try {
        if (isRepair) {
          const existingState = await KbIngestState.findBy('file_path', filePath)
          const existingChunks = existingState?.chunks_embedded ?? 0
          const updatedChunks = existingChunks + (result.chunks || 0)
          await KbIngestState.markIndexed(filePath, updatedChunks, effectiveCollection)
          logger.info(
            `[EmbedFileJob] Repair complete: added ${result.chunks} chunks to existing ${existingChunks} (now ${updatedChunks})`
          )
        } else {
          await KbIngestState.markIndexed(filePath, totalChunks, effectiveCollection)
        }
      } catch (stateErr) {
        logger.warn(
          `[EmbedFileJob] Failed to persist ingest state for ${fileName}: %s`,
          stateErr instanceof Error ? stateErr.message : String(stateErr)
        )
      }

      const zimMsg = isZim ? ` (total chunks: ${totalChunks})` : ''
      logger.info(
        `[EmbedFileJob] Successfully embedded ${result.chunks} chunks from file: ${fileName}${zimMsg}`
      )

      // After the last job completes, reset the Qdrant indexing threshold back
      // to the default so the HNSW index gets built. This only fires when no
      // other embed jobs are active/delayed/waiting — concurrent jobs keep the
      // high threshold for faster bulk writes.
      try {
        const queueService = QueueService.getInstance()
        const queue = queueService.getQueue(EmbedFileJob.queue)
        const remaining = await queue.getJobs(['waiting', 'active', 'delayed'])
        const others = remaining.filter((j) => j.id !== job.id)
        if (others.length === 0) {
          const ingestSettings = await loadIngestSettings()
          if (ingestSettings.qdrantIndexingThreshold != null) {
            logger.info(
              `[EmbedFileJob] All embedding jobs complete — resetting Qdrant indexing threshold to default`
            )
            const resetRagService = new RagService(dockerService, ollamaService)
            await resetRagService.resetIndexingThreshold()
          }
        }
      } catch (resetErr) {
        logger.warn(
          `[EmbedFileJob] Failed to check/reset Qdrant indexing threshold: %s`,
          resetErr instanceof Error ? resetErr.message : String(resetErr)
        )
      }

      return {
        success: true,
        fileName,
        filePath,
        chunks: result.chunks,
        message: `Successfully embedded ${result.chunks} chunks`,
      }
    } catch (error) {
      // A chunk that still exceeds the model's context after OllamaService's truncate-and-retry is
      // permanently oversized for this install (e.g. a model whose context is smaller than our safe
      // cap). Re-embedding the whole file 30x re-processes everything and can never succeed — that is
      // the "endless queue loop" / "api/embed for weeks" (#881/#944/#959). Mark it unrecoverable so
      // BullMQ stops after one pass instead of storming.
      let normalizedError = error
      if (!(error instanceof UnrecoverableError) && OllamaService.isContextLengthError(error)) {
        logger.warn(
          `[EmbedFileJob] Context-length overflow persisted for ${fileName} after truncation; not retrying.`
        )
        normalizedError = new UnrecoverableError(
          error instanceof Error
            ? error.message
            : 'Embedding input exceeds the model context length'
        )
      }

      logger.error(`[EmbedFileJob] Error embedding file ${fileName}:`, normalizedError)

      await job.updateData({
        ...job.data,
        status: 'failed',
        failedAt: Date.now(),
        error: normalizedError instanceof Error ? normalizedError.message : 'Unknown error',
      })

      // Only persist `failed` for unrecoverable errors. Retryable errors get
      // automatic BullMQ retries (30 attempts); marking state failed on every
      // transient blip would suppress the retry-driven recovery path.
      if (normalizedError instanceof UnrecoverableError) {
        try {
          await KbIngestState.markFailed(
            filePath,
            normalizedError instanceof Error ? normalizedError.message : 'Unknown error'
          )
        } catch (stateErr) {
          logger.warn(
            `[EmbedFileJob] Failed to persist failed state for ${fileName}: %s`,
            stateErr instanceof Error ? stateErr.message : String(stateErr)
          )
        }
      }

      throw normalizedError
    }
  }

  static async listActiveJobs(): Promise<EmbedJobWithProgress[]> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed'])

    const ratioRows = await KbRatioRegistry.all().catch((err) => {
      logger.warn('[EmbedFileJob] Could not load chunk ratio registry for estimates:', err)
      return []
    })

    const [allPaused, pausedJobsRaw, chatPausedUntilRaw] = await Promise.all([
      EmbedFileJob.isAllPaused(),
      KVStore.getValue('rag.embedPausedJobs'),
      KVStore.getValue('rag.embedPausedUntil'),
    ])
    let pausedJobIds: Set<string> = new Set()
    if (pausedJobsRaw) {
      try {
        const ids: string[] = JSON.parse(pausedJobsRaw)
        if (Array.isArray(ids)) pausedJobIds = new Set(ids)
      } catch {
        // ignore malformed JSON
      }
    }

    // Chat-induced pause is a global flag (same value for every job). Parse
    // once and stamp it onto each job so the KB UI can show time remaining
    // and a Resume All button that clears it early. Only surface when still
    // in the future; an expired timestamp is treated as no pause.
    const chatPausedUntil = chatPausedUntilRaw ? Number.parseInt(chatPausedUntilRaw, 10) : undefined
    const chatPausedUntilMs =
      chatPausedUntil && Number.isFinite(chatPausedUntil) && chatPausedUntil > Date.now()
        ? chatPausedUntil
        : undefined

    return Promise.all(
      jobs.map(async (job) => {
        const data = job.data as EmbedFileJobParams & {
          status?: string
          lastBatchAt?: number
          startedAt?: number
          chunks?: number
        }

        const fileStats = await getFileStatsIfExists(data.filePath)
        const sizeBytes = data.fileSize ?? Number(fileStats?.size ?? 0)
        const chunksEstimated = sizeBytes
          ? estimateChunkCount(data.fileName, sizeBytes, ratioRows)
          : null

        const isPaused = allPaused || pausedJobIds.has(job.id!.toString())
        const jobState = await job.getState().catch(() => 'unknown')
        const isActive = jobState === 'active'

        const currentChunks = data.chunksSoFar ?? data.chunks ?? 0
        const startedAt = data.startedAt
        const now = Date.now()

        let chunksPerMinute: number | null = null
        let articlesPerMinute: number | null = null
        let etaMinutes: number | null = null
        if (!isPaused && currentChunks > 0 && data.lastBatchAt) {
          const prevChunks = data.prevChunksSoFar ?? 0
          const prevBatchAt = data.prevBatchAt ?? startedAt ?? data.lastBatchAt
          const deltaMs = data.lastBatchAt - prevBatchAt
          if (deltaMs > 1000) {
            const chunksDelta = currentChunks - prevChunks
            if (chunksDelta > 0) {
              chunksPerMinute = Math.round((chunksDelta / deltaMs) * 60_000)
            }
            const prevOffset = data.prevResumeOffset ?? 0
            const currentOffset = data.resumeOffset ?? 0
            const articlesDelta = currentOffset - prevOffset
            if (articlesDelta > 0) {
              articlesPerMinute = Math.round((articlesDelta / deltaMs) * 60_000)
            }
          }
          if (chunksPerMinute === null && startedAt) {
            const elapsedMs = now - startedAt
            if (elapsedMs > 5000) {
              chunksPerMinute = Math.round((currentChunks / elapsedMs) * 60_000)
            }
          }
          if (articlesPerMinute !== null && articlesPerMinute > 0 && data.totalArticles) {
            const currentOffset = data.resumeOffset ?? 0
            const remaining = data.totalArticles - currentOffset
            if (remaining > 0) {
              etaMinutes = Math.round(remaining / articlesPerMinute)
            }
          }
        }

        return {
          jobId: job.id!.toString(),
          fileName: data.fileName,
          filePath: data.filePath,
          progress: typeof job.progress === 'number' ? job.progress : 0,
          status: isPaused ? 'paused' : (data.status ?? 'waiting'),
          locked: isActive && !isPaused,
          lastBatchAt: data.lastBatchAt,
          startedAt: data.startedAt,
          chunks: currentChunks,
          chunksEstimated,
          paused: isPaused,
          chatPausedUntil: chatPausedUntilMs,
          chunksPerMinute,
          articlesPerMinute,
          resumeOffset: data.resumeOffset,
          totalArticles: data.totalArticles,
          etaMinutes,
        }
      })
    )
  }

  static async getByFilePath(filePath: string): Promise<Job | undefined> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const jobId = this.getJobId(filePath)
    return await queue.getJob(jobId)
  }

  static async dispatch(params: EmbedFileJobParams, options?: { force?: boolean }) {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)

    // Initial dispatches keep the deterministic per-file jobId so re-triggering
    // an install (UI re-click, sync rescan, etc.) is idempotent. `force` skips
    // it for bulk callers (reembedAll / resetAndRebuild) where historical
    // entries in :completed would otherwise silently swallow the new dispatch.
    const force = !!options?.force
    const initialJobId = this.getJobId(params.filePath)

    const jobOptions: Parameters<typeof queue.add>[2] = {
      attempts: 30,
      backoff: {
        type: 'fixed',
        delay: 60000, // Check every 60 seconds for service readiness
      },
      removeOnComplete: { count: 50 }, // Keep last 50 completed jobs for history
      removeOnFail: { count: 20 }, // Keep last 20 failed jobs for debugging
    }
    if (!force) {
      jobOptions.jobId = initialJobId
    }

    try {
      const job = await queue.add(this.key, params, jobOptions)

      logger.info(
        `[EmbedFileJob] Dispatched embedding job for file: ${params.fileName}${force ? ' (forced re-dispatch)' : ''}`
      )

      return {
        job,
        created: true,
        jobId: job.id ?? initialJobId,
        message: `File queued for embedding: ${params.fileName}`,
      }
    } catch (error) {
      if (!force && error.message && error.message.includes('job already exists')) {
        const existing = await queue.getJob(initialJobId)
        logger.info(`[EmbedFileJob] Job already exists for file: ${params.fileName}`)
        return {
          job: existing,
          created: false,
          jobId: initialJobId,
          message: `Embedding job already exists for: ${params.fileName}`,
        }
      }
      throw error
    }
  }

  static async listFailedJobs(): Promise<EmbedJobWithProgress[]> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    // Jobs that have failed at least once are in 'delayed' (retrying) or terminal 'failed' state.
    // We identify them by job.data.status === 'failed' set in the catch block of handle().
    const jobs = await queue.getJobs(['waiting', 'delayed', 'failed'])

    return jobs
      .filter((job) => (job.data as any).status === 'failed')
      .map((job) => ({
        jobId: job.id!.toString(),
        fileName: (job.data as EmbedFileJobParams).fileName,
        filePath: (job.data as EmbedFileJobParams).filePath,
        progress: 0,
        status: 'failed',
        error: (job.data as any).error,
      }))
  }

  static async cleanupFailedJobs(): Promise<{ cleaned: number; filesDeleted: number }> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const allJobs = await queue.getJobs(['waiting', 'delayed', 'failed'])
    const failedJobs = allJobs.filter((job) => (job.data as any).status === 'failed')

    let cleaned = 0
    let filesDeleted = 0

    for (const job of failedJobs) {
      const filePath = (job.data as EmbedFileJobParams).filePath
      if (filePath && filePath.includes(RagService.UPLOADS_STORAGE_PATH)) {
        try {
          await fs.unlink(filePath)
          filesDeleted++
        } catch {
          // File may already be deleted — that's fine
        }
      }
      await job.remove()
      cleaned++
    }

    logger.info(`[EmbedFileJob] Cleaned up ${cleaned} failed jobs, deleted ${filesDeleted} files`)
    return { cleaned, filesDeleted }
  }

  /** Unconditionally clear every embedding job regardless of state.
   *
   *  cleanupFailedJobs only removes jobs explicitly tagged status === 'failed',
   *  which leaves stuck jobs (waiting / active / delayed / paused that never
   *  reached 'failed') unreachable from the UI — the operator's only recourse was
   *  flushing Redis by hand. This wipes the whole queue, including a locked active
   *  job, via obliterate({ force: true }) (plain obliterate/job.remove throw on a
   *  locked job). It touches only Redis, so it is safe while Qdrant/Ollama are
   *  offline — which is exactly when jobs pile up and wedge. */
  static async cancelAllJobs(): Promise<{ cancelled: number; filesDeleted: number }> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed', 'paused', 'failed'])

    let filesDeleted = 0
    for (const job of jobs) {
      const filePath = (job.data as EmbedFileJobParams).filePath
      // Same guard as cleanupFailedJobs: only delete user uploads, never ZIM
      // library files or Nomad docs that live outside the uploads path.
      if (filePath && filePath.includes(RagService.UPLOADS_STORAGE_PATH)) {
        try {
          await fs.unlink(filePath)
          filesDeleted++
        } catch {
          // File may already be deleted — that's fine
        }
        // The file is gone, so its ingest-state row would only produce a
        // phantom entry in the KB panel.
        await KbIngestState.remove(filePath).catch((err) => {
          logger.warn(`[EmbedFileJob] Failed to remove ingest state for ${filePath}:`, err)
        })
      } else if (filePath) {
        // ZIMs and library files stay on disk. Mark them stalled so the next
        // scanAndSyncStorage skips them (cancel sticks) and the KB panel shows
        // a retryable state instead of stale partial progress. Partial chunks
        // already in Qdrant are kept; the Retry action wipes them via the
        // force path before re-embedding.
        await KbIngestState.markStalled(filePath).catch((err) => {
          logger.warn(`[EmbedFileJob] Failed to mark ${filePath} stalled:`, err)
        })
      }
    }

    const cancelled = jobs.length

    // force: true removes the locked/active job too. An in-flight worker may keep
    // running its current batch in memory; the self-exists guard in handle()
    // prevents it from dispatching a continuation back into the cleared queue.
    await queue.obliterate({ force: true })

    logger.info(`[EmbedFileJob] Cancelled ${cancelled} jobs, deleted ${filesDeleted} files`)
    return { cancelled, filesDeleted }
  }

  static async getStatus(filePath: string): Promise<{
    exists: boolean
    status?: string
    progress?: number
    chunks?: number
    error?: string
  }> {
    const job = await this.getByFilePath(filePath)

    if (!job) {
      return { exists: false }
    }

    const state = await job.getState()
    const data = job.data

    return {
      exists: true,
      status: data.status || state,
      progress: typeof job.progress === 'number' ? job.progress : undefined,
      chunks: data.chunks,
      error: data.error,
    }
  }

  /** Force-resume a single embedding job by ID. Handles both failed/delayed
   *  jobs (simple retry) and orphaned active jobs (moveToFailed then retry).
   *  The job's `resumeOffset` and `chunksSoFar` are already persisted in
   *  job.data via onFlush, so the retried job resumes from the last flush
   *  point instead of restarting from zero. */
  static async retryJob(
    jobId: string
  ): Promise<{ success: boolean; code?: string; message: string }> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(EmbedFileJob.queue)
    const job = await queue.getJob(jobId)

    if (!job) {
      return { success: false, code: 'not_found', message: 'Job not found.' }
    }

    const state = await job.getState()

    try {
      if (state === 'failed' || state === 'delayed') {
        await job.retry()
      } else if (state === 'active') {
        // The job is locked by a worker. moveToFailed requires the worker's
        // lock token, which we don't have (this is a fresh Job instance fetched
        // from the queue, not the worker's copy). Directly delete the Redis
        // lock key to release the job, then retry it.
        const queueConfig = (await import('#config/queue')).default
        const redis = queueConfig.connection
        const lockKey = `bull:${EmbedFileJob.queue}:${jobId}:lock`
        await redis.del(lockKey)
        logger.info(`[EmbedFileJob] Broke lock for job ${jobId} (key: ${lockKey})`)
        // After breaking the lock, re-fetch and check state. The job may have
        // already transitioned (worker died, stall recovery moved it, etc).
        // moveToFailed with a dummy token works now that the lock is gone.
        const refreshedJob = await queue.getJob(jobId)
        if (!refreshedJob) {
          return { success: false, code: 'not_found', message: 'Job disappeared after lock break.' }
        }
        const refreshedState = await refreshedJob.getState()
        if (refreshedState === 'active') {
          await refreshedJob.moveToFailed(new Error('Force-resumed by operator'), '0', true)
        }
        // After moveToFailed, retry() moves it back to waiting. But if the
        // state was already 'failed' or 'delayed' (stall recovery beat us),
        // retry directly. If retry throws because the state changed again
        // (race), treat it as success — the lock is broken and the job will
        // be picked up by a worker either way.
        const postFailState = await refreshedJob.getState()
        if (postFailState === 'failed' || postFailState === 'delayed') {
          try {
            await refreshedJob.retry()
          } catch (retryErr) {
            logger.info(
              `[EmbedFileJob] retry() threw after lock break (state was ${postFailState}), job will be picked up by worker: %s`,
              retryErr instanceof Error ? retryErr.message : String(retryErr)
            )
          }
        }
      } else {
        return {
          success: false,
          code: 'not_stalled',
          message: `Job is in '${state}' state and does not need resuming.`,
        }
      }
    } catch (err) {
      logger.error(`[EmbedFileJob] Failed to resume job ${jobId}:`, err)
      return {
        success: false,
        code: 'resume_failed',
        message: err instanceof Error ? err.message : 'Failed to resume job.',
      }
    }

    logger.info(`[EmbedFileJob] Force-resumed job ${jobId} (was ${state})`)
    return { success: true, message: 'Job resumed.' }
  }

  /** Pause all embedding jobs. Sets a KV flag checked by active jobs between
   *  batches (they block in waitForResume) and calls BullMQ's queue.pause()
   *  so waiting jobs aren't picked up by the worker. */
  static async pauseAllJobs(): Promise<{ paused: number }> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed'])
    await KVStore.setValue('rag.embedAllPaused', true)
    await queue.pause()
    logger.info(`[EmbedFileJob] Paused all embedding jobs (${jobs.length} in queue)`)
    return { paused: jobs.length }
  }

  /** Resume all embedding jobs. Clears the KV flag (active jobs exit
   *  waitForResume) and calls BullMQ's queue.resume() so waiting jobs are
   *  picked up again. Also clears the chat-induced pause (`embedPausedUntil`)
   *  so "Resume All" immediately overrides a chat pause, not just the manual
   *  pause-all flag. */
  static async resumeAllJobs(): Promise<{ resumed: number }> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed'])
    await KVStore.clearValue('rag.embedAllPaused')
    await KVStore.clearValue('rag.embedPausedUntil')
    await queue.resume()
    logger.info(`[EmbedFileJob] Resumed all embedding jobs (${jobs.length} in queue)`)
    return { resumed: jobs.length }
  }

  /** Pause a single embedding job by ID. Adds the job ID to the
   *  `rag.embedPausedJobs` KV array. If the job is active, its onFlush
   *  callback will block in waitForResume on the next batch boundary. */
  static async pauseJob(
    jobId: string
  ): Promise<{ success: boolean; code?: string; message: string }> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const job = await queue.getJob(jobId)

    if (!job) {
      return { success: false, code: 'not_found', message: 'Job not found.' }
    }

    const raw = await KVStore.getValue('rag.embedPausedJobs')
    let ids: string[] = []
    if (raw) {
      try {
        ids = JSON.parse(raw)
        if (!Array.isArray(ids)) ids = []
      } catch {
        ids = []
      }
    }
    if (!ids.includes(jobId)) {
      ids.push(jobId)
      await KVStore.setValue('rag.embedPausedJobs', JSON.stringify(ids))
    }

    logger.info(`[EmbedFileJob] Paused job ${jobId}`)
    return { success: true, message: 'Job paused.' }
  }

  /** Resume a single embedding job by ID. Removes the job ID from the
   *  `rag.embedPausedJobs` KV array so the active job's waitForResume loop
   *  exits on its next poll. */
  static async resumeJobById(
    jobId: string
  ): Promise<{ success: boolean; code?: string; message: string }> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const job = await queue.getJob(jobId)

    if (!job) {
      return { success: false, code: 'not_found', message: 'Job not found.' }
    }

    const raw = await KVStore.getValue('rag.embedPausedJobs')
    if (raw) {
      try {
        const ids: string[] = JSON.parse(raw)
        if (Array.isArray(ids)) {
          const filtered = ids.filter((id) => id !== jobId)
          await KVStore.setValue('rag.embedPausedJobs', JSON.stringify(filtered))
        }
      } catch {
        await KVStore.clearValue('rag.embedPausedJobs')
      }
    }

    logger.info(`[EmbedFileJob] Resumed job ${jobId}`)
    return { success: true, message: 'Job resumed.' }
  }
}
