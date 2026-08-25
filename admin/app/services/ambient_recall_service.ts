import { inject } from '@adonisjs/core'
import { QdrantClient } from '@qdrant/js-client-rest'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import { DockerService } from './docker_service.js'
import { OllamaService } from './ollama_service.js'
import { RagService } from './rag_service.js'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import { EMBEDDING_MODEL_NAME } from '../../constants/ollama.js'
import { AMBIENT_RECALL_COLLECTION_NAME } from './voice_ingest_service.js'
import AmbientRecording from '#models/ambient_recording'
import DailyRecap from '#models/daily_recap'

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export type TemporalMatch = { date: string; label: string }

export type AmbientSearchResult = {
  text: string
  score: number
  startedAtMs: number
  isWakeWord: boolean
}

/**
 * Semantic search over the `nomad_ambient_recall` Qdrant collection, plus the
 * date-detection helper `OllamaController.chat` uses to decide whether to
 * pull in ambient/recap context for "what happened yesterday?"-style queries.
 */
@inject()
export class AmbientRecallService {
  private qdrant: QdrantClient | null = null

  constructor(
    private dockerService: DockerService,
    private ollamaService: OllamaService
  ) {}

  private async getQdrant(): Promise<QdrantClient | null> {
    if (this.qdrant) return this.qdrant
    const qdrantUrl = await this.dockerService.getServiceURL(SERVICE_NAMES.QDRANT)
    if (!qdrantUrl) return null
    this.qdrant = new QdrantClient({ url: qdrantUrl })
    return this.qdrant
  }

  /**
   * Best-effort natural-language date detection. Deliberately simple (exact
   * keywords / weekday names / ISO dates) rather than a full NLP date parser —
   * false negatives just mean the temporal context isn't injected, which is a
   * safe failure mode for a RAG augmentation step.
   */
  detectTemporalReference(query: string): TemporalMatch | null {
    const lower = query.toLowerCase()
    const now = DateTime.now()

    if (/\btoday\b|\bthis morning\b|\btonight\b/.test(lower)) {
      return { date: now.toISODate()!, label: 'today' }
    }
    if (/\byesterday\b|\blast night\b/.test(lower)) {
      const d = now.minus({ days: 1 })
      return { date: d.toISODate()!, label: 'yesterday' }
    }

    const isoMatch = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/)
    if (isoMatch) {
      const d = DateTime.fromISO(isoMatch[1])
      if (d.isValid) return { date: d.toISODate()!, label: isoMatch[1] }
    }

    for (const weekday of WEEKDAYS) {
      if (lower.includes(weekday)) {
        const targetIdx = WEEKDAYS.indexOf(weekday) === 0 ? 7 : WEEKDAYS.indexOf(weekday)
        const todayIdx = now.weekday % 7 // luxon: Monday=1..Sunday=7 -> normalize to 0=Sun
        let diff = todayIdx - targetIdx
        if (diff <= 0) diff += 7
        const isLast = lower.includes(`last ${weekday}`)
        const d = now.minus({ days: isLast || diff !== 0 ? diff : 7 })
        return { date: d.toISODate()!, label: weekday }
      }
    }

    if (/\bwhat happened\b|\bmy day\b|\bdaily recap\b|\brecap\b/.test(lower)) {
      return { date: now.toISODate()!, label: 'today' }
    }

    return null
  }

  async getRecapForDate(date: string): Promise<DailyRecap | null> {
    return DailyRecap.query().where('recap_date', date).first()
  }

  async getRecentAmbient(withinMinutes = 30, limit = 10): Promise<AmbientSearchResult[]> {
    const cutoff = DateTime.now().minus({ minutes: withinMinutes })
    const records = await AmbientRecording.query()
      .where('started_at', '>=', cutoff.toSQL()!)
      .orderBy('started_at', 'desc')
      .limit(limit)
    return records.map((r) => ({
      text: r.transcript,
      score: 1,
      startedAtMs: r.started_at.toMillis(),
      isWakeWord: r.is_wake_word,
    }))
  }

  async searchSimilar(
    query: string,
    limit = 5,
    scoreThreshold = 0.3,
    dateFilter?: string
  ): Promise<AmbientSearchResult[]> {
    const qdrant = await this.getQdrant()
    if (!qdrant) return []

    try {
      const collections = await qdrant.getCollections()
      if (!collections.collections.some((c) => c.name === AMBIENT_RECALL_COLLECTION_NAME)) {
        return []
      }

      const { embeddings } = await this.ollamaService.embed(EMBEDDING_MODEL_NAME, [
        RagService.SEARCH_QUERY_PREFIX + query,
      ])

      const results = await qdrant.search(AMBIENT_RECALL_COLLECTION_NAME, {
        vector: embeddings[0],
        limit,
        score_threshold: scoreThreshold,
        filter: dateFilter
          ? { must: [{ key: 'recapDate', match: { value: dateFilter } }] }
          : undefined,
        with_payload: true,
      })

      return results.map((r) => ({
        text: String(r.payload?.text ?? ''),
        score: r.score,
        startedAtMs: Number(r.payload?.startedAtMs ?? 0),
        isWakeWord: Boolean(r.payload?.isWakeWord),
      }))
    } catch (err) {
      logger.warn(
        `[AmbientRecall] Search failed: ${err instanceof Error ? err.message : String(err)}`
      )
      return []
    }
  }
}
