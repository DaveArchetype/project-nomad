import KVStore from '#models/kv_store'

export interface IngestSettings {
  embedConcurrency: number
  maxConcurrentEmbeds: number
  qdrantUpsertConcurrency: number
  embeddingBatchSize: number
  zimWorkerCount: number
  qdrantIndexingThreshold: number | null
}

export const INGEST_SETTINGS_DEFAULTS: IngestSettings = {
  embedConcurrency: 16,
  maxConcurrentEmbeds: 4,
  qdrantUpsertConcurrency: 8,
  embeddingBatchSize: 256,
  zimWorkerCount: 0,
  qdrantIndexingThreshold: null,
}

function parseIntWithDefault(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === null || raw === '') return fallback
  const num = Number.parseInt(raw, 10)
  if (!Number.isFinite(num)) return fallback
  return Math.min(Math.max(num, min), max)
}

export async function loadIngestSettings(): Promise<IngestSettings> {
  const [
    embedConcurrencyRaw,
    maxConcurrentEmbedsRaw,
    qdrantUpsertConcurrencyRaw,
    embeddingBatchSizeRaw,
    zimWorkerCountRaw,
    qdrantIndexingThresholdRaw,
  ] = await Promise.all([
    KVStore.getValue('rag.embedConcurrency'),
    KVStore.getValue('rag.maxConcurrentEmbeds'),
    KVStore.getValue('rag.qdrantUpsertConcurrency'),
    KVStore.getValue('rag.embeddingBatchSize'),
    KVStore.getValue('rag.zimWorkerCount'),
    KVStore.getValue('rag.qdrantIndexingThreshold'),
  ])

  const qdrantIndexingThreshold =
    qdrantIndexingThresholdRaw === null || qdrantIndexingThresholdRaw === ''
      ? null
      : Math.max(0, Number.parseInt(qdrantIndexingThresholdRaw, 10))

  return {
    embedConcurrency: parseIntWithDefault(
      embedConcurrencyRaw,
      INGEST_SETTINGS_DEFAULTS.embedConcurrency,
      1,
      64
    ),
    maxConcurrentEmbeds: parseIntWithDefault(
      maxConcurrentEmbedsRaw,
      INGEST_SETTINGS_DEFAULTS.maxConcurrentEmbeds,
      1,
      32
    ),
    qdrantUpsertConcurrency: parseIntWithDefault(
      qdrantUpsertConcurrencyRaw,
      INGEST_SETTINGS_DEFAULTS.qdrantUpsertConcurrency,
      1,
      32
    ),
    embeddingBatchSize: parseIntWithDefault(
      embeddingBatchSizeRaw,
      INGEST_SETTINGS_DEFAULTS.embeddingBatchSize,
      4,
      512
    ),
    zimWorkerCount: parseIntWithDefault(
      zimWorkerCountRaw,
      INGEST_SETTINGS_DEFAULTS.zimWorkerCount,
      0,
      32
    ),
    qdrantIndexingThreshold:
      qdrantIndexingThreshold !== null && Number.isFinite(qdrantIndexingThreshold)
        ? qdrantIndexingThreshold
        : null,
  }
}
