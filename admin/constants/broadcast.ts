export const BROADCAST_CHANNELS = {
  BENCHMARK_PROGRESS: 'benchmark-progress',
  BENCHMARK_TELEMETRY: 'benchmark-telemetry',
  OLLAMA_MODEL_DOWNLOAD: 'ollama-model-download',
  SERVICE_INSTALLATION: 'service-installation',
  SERVICE_UPDATES: 'service-updates',
  // Cross-tab notices for the Voice Assistant feature. The primary
  // low-latency wake/transcript signal travels over the browser's own
  // `/ws/voice` connection (see VoiceWsBridgeService) — this channel is
  // only for reflecting state to *other* open tabs (e.g. a wake event
  // detected while the mic is enabled on a different tab).
  VOICE_STATE: 'voice-state',
  RECAP_READY: 'recap-ready',
}
