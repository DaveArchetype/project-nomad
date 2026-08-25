import { inject } from '@adonisjs/core'
import { QdrantClient } from '@qdrant/js-client-rest'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import { DockerService } from './docker_service.js'
import { OllamaService } from './ollama_service.js'
import { RagService } from './rag_service.js'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import { EMBEDDING_MODEL_NAME } from '../../constants/ollama.js'
import AmbientRecording from '#models/ambient_recording'

export const AMBIENT_RECALL_COLLECTION_NAME = 'nomad_ambient_recall'

export type AmbientSegment = {
  text: string
  startedAtMs: number
  endedAtMs: number
  isWakeWord: boolean
}

/**
 * Persists finalized ambient-listening transcript segments: embeds the text
 * (reusing the same nomic-embed-text pipeline as the knowledge base RAG),
 * upserts it into the dedicated `nomad_ambient_recall` Qdrant collection, and
 * writes the lightweight `ambient_recordings` row. Raw audio never reaches
 * this layer — the gateway discards it once `final` is emitted.
 */
@inject()
export class VoiceIngestService {
  private qdrant: QdrantClient | null = null
  private ensuredCollection = false

  constructor(
    private dockerService: DockerService,
    private ollamaService: OllamaService
  ) {}

  private async getQdrant(): Promise<QdrantClient> {
    if (this.qdrant) return this.qdrant
    const qdrantUrl = await this.dockerService.getServiceURL(SERVICE_NAMES.QDRANT)
    if (!qdrantUrl) {
      throw new Error('Qdrant vector database is offline — cannot store ambient recall data.')
    }
    this.qdrant = new QdrantClient({ url: qdrantUrl })
    return this.qdrant
  }

  private async ensureCollection(): Promise<QdrantClient> {
    const qdrant = await this.getQdrant()
    if (this.ensuredCollection) return qdrant

    const collections = await qdrant.getCollections()
    const exists = collections.collections.some((c) => c.name === AMBIENT_RECALL_COLLECTION_NAME)
    if (!exists) {
      await qdrant.createCollection(AMBIENT_RECALL_COLLECTION_NAME, {
        vectors: { size: RagService.EMBEDDING_DIMENSION, distance: 'Cosine' },
      })
    }
    await qdrant.createPayloadIndex(AMBIENT_RECALL_COLLECTION_NAME, {
      field_name: 'recapDate',
      field_schema: 'keyword',
    })
    this.ensuredCollection = true
    return qdrant
  }

  async ingestSegment(segment: AmbientSegment): Promise<AmbientRecording | null> {
    const text = segment.text.trim()
    if (!text) return null

    const startedAt = DateTime.fromMillis(segment.startedAtMs || Date.now())
    const endedAt = DateTime.fromMillis(segment.endedAtMs || Date.now())
    const recapDate = startedAt.toISODate()!

    let qdrantPointId: string | null = null
    try {
      const qdrant = await this.ensureCollection()
      const { embeddings } = await this.ollamaService.embed(EMBEDDING_MODEL_NAME, [
        RagService.SEARCH_DOCUMENT_PREFIX + text,
      ])
      const vector = embeddings[0]
      qdrantPointId = randomUUID()
      await qdrant.upsert(AMBIENT_RECALL_COLLECTION_NAME, {
        points: [
          {
            id: qdrantPointId,
            vector,
            payload: {
              text,
              startedAtMs: segment.startedAtMs,
              endedAtMs: segment.endedAtMs,
              isWakeWord: segment.isWakeWord,
              recapDate,
            },
          },
        ],
      })
    } catch (err) {
      // Embedding/Qdrant failures shouldn't drop the transcript from MySQL —
      // it's still useful for the daily recap even without semantic search.
      logger.warn(
        `[VoiceIngest] Failed to embed/store ambient segment in Qdrant: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    return AmbientRecording.create({
      transcript: text,
      started_at: startedAt,
      ended_at: endedAt,
      duration_ms: Math.max(0, segment.endedAtMs - segment.startedAtMs),
      is_wake_word: segment.isWakeWord,
      qdrant_point_id: qdrantPointId,
      recap_date: startedAt.startOf('day') as unknown as DateTime,
    })
  }

  /** Deletes ambient recordings (and their Qdrant vectors) older than `days`. 0 = never prune. */
  async pruneOlderThan(days: number): Promise<number> {
    if (!days || days <= 0) return 0

    const cutoff = DateTime.now().minus({ days }).toISODate()!
    const stale = await AmbientRecording.query().where('recap_date', '<', cutoff)
    if (stale.length === 0) return 0

    try {
      const qdrant = await this.getQdrant()
      const pointIds = stale.map((r) => r.qdrant_point_id).filter((id): id is string => !!id)
      if (pointIds.length > 0) {
        await qdrant.delete(AMBIENT_RECALL_COLLECTION_NAME, { points: pointIds })
      }
    } catch (err) {
      logger.warn(
        `[VoiceIngest] Failed to prune stale ambient vectors from Qdrant: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    const ids = stale.map((r) => r.id)
    await AmbientRecording.query().whereIn('id', ids).delete()
    return ids.length
  }
}
