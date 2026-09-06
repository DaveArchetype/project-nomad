import { Job } from 'bullmq'
import { join, extname } from 'node:path'
import { QueueService } from '#services/queue_service'
import { EmbedFileJob } from '#jobs/embed_file_job'
import {
  BOOKS_STORAGE_PATH,
  getFileStatsIfExists,
  listDirectoryContentsRecursive,
} from '../utils/fs.js'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import Service from '#models/service'
import KbIngestState from '#models/kb_ingest_state'
import logger from '@adonisjs/core/services/logger'

const BOOK_EXTENSIONS: ReadonlySet<string> = new Set(['.epub', '.pdf', '.txt', '.md', '.docx'])
const SYNC_INTERVAL_CRON = '*/5 * * * *'

export class CalibreSyncJob {
  static get queue() {
    return 'system'
  }

  static get key() {
    return 'calibre-sync'
  }

  async handle(_job: Job) {
    const installed = await Service.query()
      .where('service_name', SERVICE_NAMES.CALIBREWEB)
      .andWhere('installed', true)
      .first()
    if (!installed) {
      logger.debug('[CalibreSyncJob] Calibre-Web not installed, skipping.')
      return { queued: 0, reason: 'calibre-web-not-installed' }
    }

    const booksDir = join(process.cwd(), BOOKS_STORAGE_PATH)
    let entries: Awaited<ReturnType<typeof listDirectoryContentsRecursive>> = []
    try {
      entries = await listDirectoryContentsRecursive(booksDir)
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        logger.debug('[CalibreSyncJob] Books directory does not exist, skipping.')
        return { queued: 0, reason: 'no-books-dir' }
      }
      throw error
    }

    const bookFiles = entries.filter(
      (e): e is { type: 'file'; key: string; name: string } =>
        e.type === 'file' && BOOK_EXTENSIONS.has(extname(e.key).toLowerCase())
    )

    const stateRows = await KbIngestState.all()
    const stateByPath = new Map(stateRows.map((r) => [r.file_path, r]))

    let queued = 0
    let skipped = 0
    for (const entry of bookFiles) {
      const filePath = entry.key
      const stateRow = stateByPath.get(filePath)
      if (stateRow && stateRow.state === 'indexed') {
        skipped++
        continue
      }
      try {
        const stats = await getFileStatsIfExists(filePath)
        const result = await EmbedFileJob.dispatch(
          {
            filePath,
            fileName: filePath.split(/[/\\]/).pop() || filePath,
            fileSize: stats?.size,
          },
          { force: false }
        )
        if (result.created) queued++
      } catch (error) {
        logger.warn(
          `[CalibreSyncJob] Failed to dispatch embed job for ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    logger.info(`[CalibreSyncJob] Scan complete: ${queued} queued, ${skipped} already indexed.`)
    return { queued, skipped }
  }

  static async schedule() {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    await queue.upsertJobScheduler(
      'calibre-sync-scheduler',
      { pattern: SYNC_INTERVAL_CRON },
      {
        name: this.key,
        opts: {
          removeOnComplete: { count: 12 },
          removeOnFail: { count: 5 },
        },
      }
    )
    logger.info(`[CalibreSyncJob] Scheduled Calibre-Web book sync (${SYNC_INTERVAL_CRON})`)
  }

  static async dispatch() {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const job = await queue.add(
      this.key,
      {},
      {
        attempts: 1,
        removeOnComplete: { count: 12 },
        removeOnFail: { count: 5 },
      }
    )
    logger.info(`[CalibreSyncJob] Dispatched ad-hoc Calibre sync job ${job.id}`)
    return job
  }
}
