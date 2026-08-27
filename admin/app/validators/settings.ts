import vine from '@vinejs/vine'
import { SETTINGS_KEYS } from '../../constants/kv_store.js'
import type { KVStoreKey } from '../../types/kv_store.js'

export const getSettingSchema = vine.compile(
  vine.object({
    key: vine.enum(SETTINGS_KEYS),
  })
)

export const updateSettingSchema = vine.compile(
  vine.object({
    key: vine.enum(SETTINGS_KEYS),
    value: vine.any().optional(),
  })
)

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Validate the *value* for keys that have format constraints beyond the generic
 * enum/any check (the generic validator only constrains the key). Returns an
 * error message string when invalid, or null when the value is acceptable.
 */
export function validateSettingValue(key: KVStoreKey, value: unknown): string | null {
  switch (key) {
    case 'autoUpdate.windowStart':
    case 'autoUpdate.windowEnd':
    case 'contentAutoUpdate.windowStart':
    case 'contentAutoUpdate.windowEnd':
      if (typeof value !== 'string' || !HHMM_PATTERN.test(value)) {
        return 'Time window values must be in 24-hour HH:MM format (e.g. "20:00").'
      }
      return null
    case 'autoUpdate.cooloffHours':
    case 'contentAutoUpdate.cooloffHours': {
      const num = Number(value)
      if (!Number.isInteger(num) || num < 0 || num > 8760) {
        return 'Cool-off must be a whole number of hours between 0 and 8760.'
      }
      return null
    }
    case 'system.internetStatusTestUrl': {
      // Empty clears the setting (reverts to env var / built-in defaults).
      if (value === '' || value === undefined || value === null) {
        return null
      }
      if (typeof value !== 'string') {
        return 'Test URL must be a string.'
      }
      try {
        const url = new URL(value)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          return 'Test URL must use http or https.'
        }
      } catch {
        return 'Test URL must be a valid URL (e.g. "https://example.com").'
      }
      return null
    }
    case 'ui.reverseProxyBaseDomain': {
      if (value === '' || value === undefined || value === null) {
        return null
      }
      if (typeof value !== 'string') {
        return 'Reverse proxy base domain must be a string.'
      }
      const trimmed = value.trim()
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) {
        return 'Base domain must be a valid hostname (e.g. "nomad.lan" or "example.com").'
      }
      return null
    }
    case 'contentAutoUpdate.maxBytesPerWindow': {
      // Per-window download budget in bytes. 0 = unlimited.
      const num = Number(value)
      if (!Number.isInteger(num) || num < 0) {
        return 'The per-window data cap must be a whole number of bytes (0 = unlimited).'
      }
      return null
    }
    case 'rag.embedPauseAfterChatMinutes': {
      // 0 = resume immediately (no pause), 1440 = 24h cap.
      // Empty clears the setting (reverts to the 15-minute default).
      if (value === '' || value === undefined || value === null) {
        return null
      }
      const num = Number(value)
      if (!Number.isInteger(num) || num < 0 || num > 1440) {
        return 'Embed pause must be a whole number of minutes between 0 and 1440 (0 = resume immediately).'
      }
      return null
    }
    case 'rag.embedConcurrency': {
      if (value === '' || value === undefined || value === null) return null
      const num = Number(value)
      if (!Number.isInteger(num) || num < 1 || num > 64) {
        return 'Embed concurrency must be a whole number between 1 and 64.'
      }
      return null
    }
    case 'rag.maxConcurrentEmbeds': {
      if (value === '' || value === undefined || value === null) return null
      const num = Number(value)
      if (!Number.isInteger(num) || num < 1 || num > 32) {
        return 'Max concurrent embeds must be a whole number between 1 and 32.'
      }
      return null
    }
    case 'rag.qdrantUpsertConcurrency': {
      if (value === '' || value === undefined || value === null) return null
      const num = Number(value)
      if (!Number.isInteger(num) || num < 1 || num > 32) {
        return 'Qdrant upsert concurrency must be a whole number between 1 and 32.'
      }
      return null
    }
    case 'rag.embeddingBatchSize': {
      if (value === '' || value === undefined || value === null) return null
      const num = Number(value)
      if (!Number.isInteger(num) || num < 4 || num > 512) {
        return 'Embedding batch size must be a whole number between 4 and 512.'
      }
      return null
    }
    case 'rag.zimWorkerCount': {
      if (value === '' || value === undefined || value === null) return null
      const num = Number(value)
      if (!Number.isInteger(num) || num < 0 || num > 32) {
        return 'ZIM worker count must be a whole number between 0 and 32 (0 = auto).'
      }
      return null
    }
    case 'rag.qdrantIndexingThreshold': {
      if (value === '' || value === undefined || value === null) return null
      const num = Number(value)
      if (!Number.isInteger(num) || num < 0 || num > 1_000_000) {
        return 'Qdrant indexing threshold must be a whole number between 0 and 1000000.'
      }
      return null
    }
    case 'rag.teiIdleStopMinutes': {
      if (value === '' || value === undefined || value === null) return null
      const num = Number(value)
      if (!Number.isInteger(num) || num < 0 || num > 1440) {
        return 'TEI idle stop must be a whole number of minutes between 0 and 1440 (0 = TEI always on).'
      }
      return null
    }
    case 'ai.ollamaNumCtx': {
      // Empty clears the setting (reverts to the controller's hardcoded default).
      if (value === '' || value === undefined || value === null) return null
      const num = Number(value)
      if (!Number.isInteger(num) || num < 2048 || num > 1048576) {
        return 'Context window must be a whole number of tokens between 2048 and 1048576.'
      }
      return null
    }
    case 'ai.ollamaKvCacheType': {
      // Empty clears the setting (reverts to Ollama's default, f16).
      if (value === '' || value === undefined || value === null) return null
      const allowed = ['f16', 'q8_0', 'q4_0', 'q4_1', 'q5_0', 'q5_1', 'iq4_nl']
      if (!allowed.includes(String(value))) {
        return 'KV cache type must be one of: f16, q8_0, q4_0, q4_1, q5_0, q5_1, iq4_nl.'
      }
      return null
    }
    case 'voice.audioSource': {
      if (!['browser', 'host', 'both'].includes(String(value))) {
        return 'Audio source must be one of "browser", "host", or "both".'
      }
      return null
    }
    case 'voice.wakeWordSensitivity': {
      const num = Number(value)
      if (Number.isNaN(num) || num < 0 || num > 1) {
        return 'Wake word sensitivity must be a number between 0 and 1.'
      }
      return null
    }
    case 'stt.modelSize': {
      if (!['tiny', 'base', 'small', 'medium'].includes(String(value))) {
        return 'STT model size must be one of "tiny", "base", "small", or "medium".'
      }
      return null
    }
    case 'stt.vadSensitivity': {
      const num = Number(value)
      if (!Number.isInteger(num) || num < 0 || num > 3) {
        return 'VAD sensitivity must be a whole number between 0 (least aggressive) and 3 (most aggressive).'
      }
      return null
    }
    case 'voice.retentionDays': {
      const num = Number(value)
      if (!Number.isInteger(num) || num < 0 || num > 3650) {
        return 'Retention must be a whole number of days between 0 (keep forever) and 3650.'
      }
      return null
    }
    case 'tts.speechRate': {
      const num = Number(value)
      if (Number.isNaN(num) || num < 0.5 || num > 2.0) {
        return 'Speech rate must be a number between 0.5 and 2.0.'
      }
      return null
    }
    case 'recap.scheduleTime': {
      if (typeof value !== 'string' || !HHMM_PATTERN.test(value)) {
        return 'Recap schedule time must be in 24-hour HH:MM format (e.g. "23:55").'
      }
      return null
    }
    default:
      return null
  }
}
