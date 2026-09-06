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
  // backpressure). Default 4.
  'rag.maxConcurrentEmbeds': 'string',
  // Concurrent Qdrant upsert batches. Default 8 (was sequential = 1).
  'rag.qdrantUpsertConcurrency': 'string',
  // Chunks per embed request. Capped by TEI --max-client-batch-size (512).
  // Default 8.
  'rag.embeddingBatchSize': 'string',
  // ZIM HTML-parse worker threads. 0 = auto-detect (min(cores-1, 8)).
  // Default 0.
  'rag.zimWorkerCount': 'string',
  // When set, applied live via Qdrant update_collection (non-destructive) to
  // defer HNSW indexing during bulk ingest. Empty = leave Qdrant default
  // (20000). Set very high (e.g. 1000000) during ingestion, lower back to
  // 20000 afterward to trigger indexing. Default empty.
  'rag.qdrantIndexingThreshold': 'string',
  'rag.teiIdleStopMinutes': 'string',
  'rag.lastTeiActivityAt': 'string',
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
  'ui.accentColor': 'string',
  'ui.density': 'string',
  'ui.reverseProxyBaseDomain': 'string',
  'ai.assistantCustomName': 'string',
  'gpu.type': 'string',
  'ai.remoteOllamaUrl': 'string',
  'ai.ollamaFlashAttention': 'boolean',
  // KV cache quantization type passed to Ollama as OLLAMA_KV_CACHE_TYPE at
  // container creation. FP16 (default) is the most accurate but uses the most
  // VRAM; q8_0 halves it with negligible quality loss, q4_0 quarters it with
  // modest loss. Requires Flash Attention to take effect (Ollama silently
  // falls back to f16 otherwise). Empty/unset = Ollama default (f16).
  // Takes effect after reinstalling the AI Assistant (env var baked in at
  // container creation, same as ai.ollamaFlashAttention).
  'ai.ollamaKvCacheType': 'string',
  // Per-request context window (num_ctx) sent to Ollama on every chat/RAG
  // request. Stored as a string (KV schema constraint); parsed to int at read
  // time by OllamaController.chat. Empty/unset reverts to the hardcoded default
  // (DEFAULT_OLLAMA_NUM_CTX in the controller). Larger values let long
  // conversations and large RAG context fit, but allocate a bigger KV cache
  // (more VRAM); lower it for large models that would otherwise OOM.
  'ai.ollamaNumCtx': 'string',
  'ai.autoThinking': 'boolean',
  'ai.amdGpuAcceleration': 'boolean',
  'ai.amdHsaOverride': 'string',
  'ai.autoFixGpuPassthrough': 'boolean',
  'gpu.autoRemediatedAt': 'string',
  'apps.homebox.apiKeyPepper': 'string',
  'registry.giteaUsername': 'string',
  'registry.giteaPassword': 'string',
  'vpn.openvpnUser': 'string',
  'vpn.openvpnPassword': 'string',
  'vpn.countries': 'string',
  'stremio.vpnEnabled': 'boolean',
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
  // ── Voice Assistant (ambient STT / wake word / TTS) ──────────────────────
  // Master switch surfaced in AI Settings > Voice. The navbar mic icon is the
  // moment-to-moment on/off control; this gates whether the feature (and its
  // navbar control) is available at all.
  'voice.enabled': 'boolean',
  // 'browser' | 'host' | 'both' — where ambient audio is captured from.
  'voice.audioSource': 'string',
  // Preset id (e.g. "hey_jarvis", "alexa") or "custom" when a trained model
  // has been uploaded via POST /api/voice/wakeword-model.
  'voice.wakeWordPreset': 'string',
  // Set once a custom .onnx/.tflite model has been uploaded; relative path
  // under storage. Empty when using a bundled preset.
  'voice.customWakeWordModelPath': 'string',
  // 0-1 detection threshold passed to openWakeWord. Default 0.5.
  'voice.wakeWordSensitivity': 'string',
  // faster-whisper model size: tiny | base | small | medium.
  'stt.modelSize': 'string',
  // BCP-47/whisper language code, or "auto".
  'stt.language': 'string',
  // 0-3, webrtcvad aggressiveness (higher = more aggressive speech filtering).
  'stt.vadSensitivity': 'string',
  // Days of ambient transcript retention before pruning. 0 = keep forever.
  'voice.retentionDays': 'string',
  'tts.enabled': 'boolean',
  // Piper voice id (e.g. "en_US-lessac-medium").
  'tts.voice': 'string',
  'tts.autoReadReplies': 'boolean',
  // 0.5-2.0 playback/synthesis rate multiplier.
  'tts.speechRate': 'string',
  'recap.enabled': 'boolean',
  // 24h HH:MM, local server time, when the nightly recap job should run.
  'recap.scheduleTime': 'string',
  'recap.timezone': 'string',
  // Ollama model name used to summarize the day's transcripts. Empty = reuse
  // the chat default (chat.lastModel) at run time.
  'recap.model': 'string',
  // ── Container OOM watchdog ───────────────────────────────────────────────
  // Master switch for the in-admin watchdog provider that stops managed child
  // containers under sustained memory pressure. The hard cgroup memory limit
  // (oom.<service>.memoryLimitMB / oom.defaultMemoryLimitMB) protects the host
  // even when this is off. Default on.
  'watchdog.enabled': 'boolean',
  // Watchdog tick interval in ms. Default 30000.
  'watchdog.tickIntervalMs': 'string',
  // Fraction of a container's memory limit at which it counts as "pressured"
  // (0-1). Default 0.95.
  'watchdog.memPressureThreshold': 'string',
  // Consecutive pressured ticks required before the watchdog stops a container.
  // At the default 30s tick this is ~2 min. Default 4.
  'watchdog.sustainedTicks': 'string',
  // Fallback: when a managed container has NO per-container memory limit set,
  // stop it if its RAM usage as a % of host RAM exceeds this. Default 90.
  'watchdog.hostMemKillPercent': 'string',
  // Per-service memory limit in MB (0 = disabled for that service). Overrides
  // the hardcoded default in DEFAULT_MEMORY_LIMITS_MB. e.g.
  // oom.nomad_comfyui.memoryLimitMB = "16384".
  'oom.nomad_comfyui.memoryLimitMB': 'string',
  // Global default memory limit in MB applied to any managed container that
  // doesn't have a per-service default or override. 0 = no global cap (only
  // the host-mem fallback watchdog applies). Default 0.
  'oom.defaultMemoryLimitMB': 'string',
  'automation.n8nEncryptionKey': 'string',
  'automation.n8nApiKey': 'string',
  'automation.n8nBaseUrl': 'string',
  'automation.defaultModel': 'string',
  'automation.enabled': 'boolean',
} as const

type KVTagToType<T extends string> = T extends 'boolean' ? boolean : string

export type KVStoreKey = keyof typeof KV_STORE_SCHEMA
export type KVStoreValue<K extends KVStoreKey> = KVTagToType<(typeof KV_STORE_SCHEMA)[K]>
