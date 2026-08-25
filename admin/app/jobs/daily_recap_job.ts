import { Job } from 'bullmq'
import { QueueService } from '#services/queue_service'
import { DailyRecapService } from '#services/daily_recap_service'
import { OllamaService } from '#services/ollama_service'
import KVStore from '#models/kv_store'
import logger from '@adonisjs/core/services/logger'

const DEFAULT_SCHEDULE_TIME = '23:55'

/**
 * Nightly job that summarizes the day's `ambient_recordings` into a
 * `daily_recaps` row. Gated by the `recap.enabled` KV setting (AI Settings >
 * Voice); the schedule time itself is also configurable there
 * (`recap.scheduleTime`, HH:MM local server time) — `schedule()` re-reads it
 * each time it's called, so re-invoking it (done automatically whenever that
 * setting is saved, see SettingsController) takes effect without a worker
 * restart.
 */
export class DailyRecapJob {
  static get queue() {
    return 'system'
  }

  static get key() {
    return 'daily-recap'
  }

  async handle(_job: Job) {
    const enabled = await KVStore.getValue('recap.enabled')
    if (!enabled) {
      logger.info('[DailyRecapJob] Recap generation is disabled, skipping.')
      return { generated: false, reason: 'disabled' }
    }

    const recapService = new DailyRecapService(new OllamaService())
    const recap = await recapService.generateForYesterday()

    return { generated: Boolean(recap), recapId: recap?.id ?? null }
  }

  static async schedule() {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)

    const scheduleTime = (await KVStore.getValue('recap.scheduleTime')) || DEFAULT_SCHEDULE_TIME
    const [hour, minute] = scheduleTime.split(':').map((n) => Number.parseInt(n, 10))
    const cronHour = Number.isFinite(hour) ? hour : 23
    const cronMinute = Number.isFinite(minute) ? minute : 55

    await queue.upsertJobScheduler(
      'nightly-daily-recap',
      { pattern: `${cronMinute} ${cronHour} * * *` },
      {
        name: this.key,
        opts: {
          removeOnComplete: { count: 12 },
          removeOnFail: { count: 5 },
        },
      }
    )

    logger.info(
      `[DailyRecapJob] Daily recap scheduled at ${cronHour}:${String(cronMinute).padStart(2, '0')} (cron: ${cronMinute} ${cronHour} * * *)`
    )
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

    logger.info(`[DailyRecapJob] Dispatched ad-hoc recap generation job ${job.id}`)
    return job
  }
}
