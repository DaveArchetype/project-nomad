import { Job, UnrecoverableError } from 'bullmq'
import { QueueService } from '#services/queue_service'
import { EmbedJobWithProgress } from '../../types/rag.js'
import { RagService } from '#services/rag_service'
import { DockerService } from '#services/docker_service'
import { OllamaService } from '#services/ollama_service'
import KbIngestState from '#models/kb_ingest_state'
import { createHash } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import fs from 'node:fs/promises'
import { determineFileType } from '../utils/fs.js'

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

  async handle(job: Job) {
    const { filePath, fileName, totalArticles, collection } = job.data as EmbedFileJobParams

    // Only the direct KB-upload controller passes `collection` on dispatch; the other
    // six dispatch sites (download auto-index, scan/sync, re-embed, local ZIM upload,
    // replaced-file reconcile, and this job's own ZIM batch continuation) do not. Fall
    // back to whatever the file is already assigned to, so an assignment made *before*
    // the file was indexed still reaches the vectors. Resolving it here rather than at
    // each dispatch site keeps one source of truth and covers batch continuations too.
    const effectiveCollection =
      collection ?? (await KbIngestState.findBy('file_path', filePath))?.collection ?? undefined

    const isZim = determineFileType(filePath) === 'zim'
    const resumeOffset = job.data.resumeOffset ?? job.data.batchOffset
    const resumeInfo = resumeOffset ? ` (resuming at article ${resumeOffset})` : ''
    logger.info(`[EmbedFileJob] Starting embedding process for: ${fileName}${resumeInfo}`)

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
      const initialPercent =
        totalArticles && totalArticles > 0 && resumeOffset
          ? Math.min(99, Math.round((resumeOffset / totalArticles) * 100))
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
      const baseChunks = isZim ? job.data.chunksSoFar || 0 : 0

      // Called by RagService after every ZIM flush. Persists the resume offset
      // (BullMQ retries pick it up via job data), re-anchors the job lock, and
      // detects external cancellation: cancelAllJobs() obliterates the queue
      // (including this active job), so if our own job key is gone, the cancel
      // happened — return false to unwind the stream cleanly.
      const onFlush = async (articlesSeen: number, chunksEmbedded: number) => {
        await job.updateData({
          ...job.data,
          resumeOffset: articlesSeen,
          chunksSoFar: baseChunks + chunksEmbedded,
          lastBatchAt: Date.now(),
        })
        await this.safeExtendLock(job)

        const stillQueued = await QueueService.getInstance()
          .getQueue(EmbedFileJob.queue)
          .getJob(job.id!)
        return !!stillQueued
      }

      // Process and embed the file
      // Only allow deletion if explicitly marked as final batch
      const allowDeletion = job.data.isFinalBatch === true
      const result = await ragService.processAndEmbedFile(filePath, allowDeletion, {
        startOffset: isZim ? resumeOffset : undefined,
        onProgress,
        onFlush: isZim ? onFlush : undefined,
        collection: effectiveCollection,
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
      await this.safeUpdateProgress(job, 100)
      await job.updateData({
        ...job.data,
        status: 'completed',
        completedAt: Date.now(),
        chunks: totalChunks,
      })

      // Persist the post-job state so scanAndSyncStorage knows this file is done.
      // BullMQ's :completed retention (50 jobs) ages out, so the state row is
      // the only durable record of "this file finished embedding".
      try {
        await KbIngestState.markIndexed(filePath, totalChunks, effectiveCollection)
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

    return jobs.map((job) => {
      const data = job.data as EmbedFileJobParams & {
        status?: string
        lastBatchAt?: number
        startedAt?: number
        chunks?: number
      }
      return {
        jobId: job.id!.toString(),
        fileName: data.fileName,
        filePath: data.filePath,
        progress: typeof job.progress === 'number' ? job.progress : 0,
        status: data.status ?? 'waiting',
        lastBatchAt: data.lastBatchAt,
        startedAt: data.startedAt,
        chunks: data.chunks,
      }
    })
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
}
