import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import { OllamaService } from './ollama_service.js'
import { VoiceIngestService } from './voice_ingest_service.js'
import AmbientRecording from '#models/ambient_recording'
import DailyRecap from '#models/daily_recap'
import KVStore from '#models/kv_store'
import transmit from '@adonisjs/transmit/services/main'
import { BROADCAST_CHANNELS } from '../../constants/broadcast.js'

const DEFAULT_RECAP_MODEL_FALLBACK = 'llama3.2'

/**
 * Summarizes a day's `ambient_recordings` into a `daily_recaps` row using the
 * existing chat LLM (no separate model download needed). Run nightly by
 * `DailyRecapJob`; can also be triggered on-demand (e.g. for testing, or a
 * "generate now" button) via `generateForDate`.
 */
@inject()
export class DailyRecapService {
  constructor(private ollamaService: OllamaService) {}

  async generateForDate(date: string): Promise<DailyRecap | null> {
    const recordings = await AmbientRecording.query()
      .where('recap_date', date)
      .orderBy('started_at', 'asc')

    if (recordings.length === 0) {
      logger.info(`[DailyRecap] No ambient recordings for ${date}, skipping recap.`)
      return null
    }

    const transcriptBlock = recordings
      .map((r) => `[${r.started_at.toFormat('HH:mm')}] ${r.transcript}`)
      .join('\n')

    const model =
      (await KVStore.getValue('recap.model')) ||
      (await KVStore.getValue('chat.lastModel')) ||
      DEFAULT_RECAP_MODEL_FALLBACK

    const prompt = [
      'You are summarizing a day of ambient, timestamped speech transcripts captured by a personal',
      'voice assistant. Write a concise, third-person recap (4-8 sentences) of what the day sounded',
      'like: topics discussed, notable events, tasks or reminders mentioned, and anything that stands',
      'out. Do not fabricate details that are not present in the transcript. If the transcript is too',
      'fragmentary or noisy to summarize meaningfully, say so briefly instead of guessing.',
      '',
      `Transcript for ${date}:`,
      transcriptBlock,
    ].join('\n')

    let summary: string
    try {
      const response = await this.ollamaService.chat({
        model,
        messages: [{ role: 'user', content: prompt }],
      })
      summary = response.message.content.trim()
    } catch (err) {
      logger.error(
        `[DailyRecap] Failed to generate recap for ${date}: ${err instanceof Error ? err.message : String(err)}`
      )
      return null
    }

    if (!summary) return null

    const recapDate = DateTime.fromISO(date)
    const recap = await DailyRecap.updateOrCreate(
      { recap_date: recapDate },
      {
        recap_date: recapDate,
        summary,
        source_recording_count: recordings.length,
        model_used: model,
        generated_at: DateTime.now(),
      }
    )

    transmit.broadcast(BROADCAST_CHANNELS.RECAP_READY, { date, recordingCount: recordings.length })

    // Retention pruning piggybacks on the nightly cycle rather than a
    // separate provider/interval — one fewer moving part, and the ordering
    // (recap generated, then that day's data eventually pruned once past the
    // retention window) is exactly what a user configuring "keep transcripts
    // for N days" expects.
    try {
      const retentionDaysRaw = await KVStore.getValue('voice.retentionDays')
      const retentionDays = retentionDaysRaw ? Number.parseInt(retentionDaysRaw, 10) : 0
      if (Number.isFinite(retentionDays) && retentionDays > 0) {
        const app = (await import('@adonisjs/core/services/app')).default
        const ingestService = await app.container.make(VoiceIngestService)
        const pruned = await ingestService.pruneOlderThan(retentionDays)
        if (pruned > 0) {
          logger.info(
            `[DailyRecap] Pruned ${pruned} ambient recordings older than ${retentionDays} days`
          )
        }
      }
    } catch (err) {
      logger.warn(
        `[DailyRecap] Retention pruning failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    return recap
  }

  async generateForYesterday(): Promise<DailyRecap | null> {
    const yesterday = DateTime.now().minus({ days: 1 }).toISODate()!
    return this.generateForDate(yesterday)
  }
}
