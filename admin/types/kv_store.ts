export const KV_STORE_SCHEMA = {
  'chat.suggestionsEnabled': 'boolean',
  'chat.lastModel': 'string',
  'chat.suggestionsCache': 'string',
  'rag.docsEmbedded': 'boolean',
  'rag.defaultIngestPolicy': 'string',
  'rag.embedPausedUntil': 'string',
  'rag.embedAllPaused': 'boolean',
  'rag.embedPausedJobs': 'string',
  // How long (in minutes) background embedding stays paused after a chat
  // message so inference doesn't compete with the embed job for GPU/Ollama
  // time. Read by OllamaController.chat on each request. Stored as a string
  // (KV schema constraint); parsed to int at read time. Default 15 minutes.
  'rag.embedPauseAfterChatMinutes': 'string',
  // Ingestion performance knobs. All stored as strings (KV schema constraint),
  // parsed to int at read time by loadIngestSettings(). Empty/unset reverts to
  // the hardcoded defaults in app/services/utils/ingest_settings.ts. Exposed in
  // the AI Settings page under "Ingestion Performance".
  // Concurrent embed HTTP requests sent to TEI per flush (each carries
  // embeddingBatchSize chunks). Higher keeps the GPU fed. Default 16.
  'rag.embedConcurrency': 'string',
  // Concurrent flushes in flight during ZIM streaming (memory-bounded
  // backpressure). Default 8.
  'rag.maxConcurrentEmbeds': 'string',
  // Concurrent Qdrant upsert batches. Default 8 (was sequential = 1).
  'rag.qdrantUpsertConcurrency': 'string',
  // Chunks per embed request. Capped by TEI --max-client-batch-size (512).
  // Default 256.
  'rag.embeddingBatchSize': 'string',
  // ZIM HTML-parse worker threads. 0 = auto-detect (min(cores-1, 8)).
  // Default 0.
  'rag.zimWorkerCount': 'string',
  // When set, applied live via Qdrant update_collection (non-destructive) to
  // defer HNSW indexing during bulk ingest. Empty = leave Qdrant default
  // (20000). Set very high (e.g. 1000000) during ingestion, lower back to
  // 20000 afterward to trigger indexing. Default empty.
  'rag.qdrantIndexingThreshold': 'string',
  'system.updateAvailable': 'boolean',
  'system.latestVersion': 'string',
  'system.earlyAccess': 'boolean',
  'system.internetStatusTestUrl': 'string',
  'autoUpdate.enabled': 'boolean',
  'autoUpdate.windowStart': 'string',
  'autoUpdate.windowEnd': 'string',
  'autoUpdate.cooloffHours': 'string',
  'autoUpdate.lastAttemptAt': 'string',
  'autoUpdate.lastError': 'string',
  'autoUpdate.lastResult': 'string',
  'autoUpdate.consecutiveFailures': 'string',
  'autoUpdate.autoDisabledReason': 'string',
  'appAutoUpdate.enabled': 'boolean',
  'appAutoUpdate.lastAttemptAt': 'string',
  'appAutoUpdate.lastResult': 'string',
  'contentAutoUpdate.enabled': 'boolean',
  'contentAutoUpdate.windowStart': 'string',
  'contentAutoUpdate.windowEnd': 'string',
  'contentAutoUpdate.cooloffHours': 'string',
  'contentAutoUpdate.maxBytesPerWindow': 'string',
  'contentAutoUpdate.lastAttemptAt': 'string',
  'contentAutoUpdate.lastResult': 'string',
  'contentAutoUpdate.lastError': 'string',
  'contentAutoUpdate.consecutiveFailures': 'string',
  'contentAutoUpdate.autoDisabledReason': 'string',
  'contentAutoUpdate.windowBytesUsed': 'string',
  'contentAutoUpdate.windowResetAt': 'string',
  'ui.hasVisitedEasySetup': 'boolean',
  'ui.theme': 'string',
  'ui.reverseProxyBaseDomain': 'string',
  'ai.assistantCustomName': 'string',
  'gpu.type': 'string',
  'ai.remoteOllamaUrl': 'string',
  'ai.ollamaFlashAttention': 'boolean',
  'ai.autoThinking': 'boolean',
  'ai.amdGpuAcceleration': 'boolean',
  'ai.amdHsaOverride': 'string',
  'ai.autoFixGpuPassthrough': 'boolean',
  'gpu.autoRemediatedAt': 'string',
  'apps.homebox.apiKeyPepper': 'string',
  'benchmark.rerunBannerDismissed': 'boolean',
  // Drug Reference v1 — export_date of the last successfully completed
  // openFDA drug-label ingest (e.g. "2026-06-06"). Written by
  // IngestDrugDataJob on final-part completion; read by the search page's
  // status panel to show "Last updated: <date>". Null when never ingested.
  'drugReference.lastUpdatedExportDate': 'string',
  // Drug Reference — two-step ingest download-state marker (no migration; status
  // lives in job data + this KV key). Written by DownloadDrugDataJob after the
  // LAST part lands on disk; a JSON string of DownloadStateMarker
  // ({ export_date, totalParts, parts: [{ index, name, path, bytes }],
  // completedAtMs }). Read by IngestDrugDataJob to rebuild the part list for a
  // manual "Ingest into search" run (no manifest, no re-download) and by the
  // service to gate POST /ingest. Parsed defensively (parseDownloadState) with a
  // null fallback — the key simply doesn't exist before the first download.
  // Cleared after a full ingest succeeds (when the on-disk parts are deleted).
  'drugReference.downloadState': 'string',
  // Drug Reference — affirmative-content gate (upstream #1040). Independent of
  // the tier install: installing `medicine-standard` lights up the verbatim FDA
  // label search and condition→OTC matching, but the hand-authored self-care and
  // herbal REMEDY sections stay hidden until this flips true. Defaults off
  // (null → false); flipped on after a clinician content-pass, not user-toggled.
  'drugReference.remediesEnabled': 'boolean',
} as const

type KVTagToType<T extends string> = T extends 'boolean' ? boolean : string

export type KVStoreKey = keyof typeof KV_STORE_SCHEMA
export type KVStoreValue<K extends KVStoreKey> = KVTagToType<(typeof KV_STORE_SCHEMA)[K]>
