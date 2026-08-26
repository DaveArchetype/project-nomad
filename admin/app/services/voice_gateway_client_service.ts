import { inject } from '@adonisjs/core'
import axios from 'axios'
import logger from '@adonisjs/core/services/logger'

// Voice Gateway is installed as a normal Supply Depot app (see ServiceSeeder /
// SERVICE_NAMES.VOICE_GATEWAY), but it has no browser-facing web UI, so nothing else needs to
// resolve its URL through DockerService.getServiceURL — the container name + port are hardcoded
// here instead, exactly the same pattern OllamaService uses to reach the `nomad_tei` container.
const VOICE_GATEWAY_CONTAINER_NAME = 'nomad_voice_gateway'
const VOICE_GATEWAY_PORT = '8600'

/**
 * Resolves and health-checks the Voice Gateway container (openWakeWord +
 * faster-whisper), and proxies its non-streaming HTTP endpoints. The
 * streaming ingest path itself lives in `VoiceWsBridgeService`, which opens
 * its own `ws` connection using `getWsUrl()` below.
 */
@inject()
export class VoiceGatewayClientService {
  async getHttpUrl(): Promise<string | null> {
    const host = process.env.NODE_ENV === 'production' ? VOICE_GATEWAY_CONTAINER_NAME : 'localhost'
    return `http://${host}:${VOICE_GATEWAY_PORT}`
  }

  async getWsUrl(): Promise<string | null> {
    const httpUrl = await this.getHttpUrl()
    if (!httpUrl) return null
    return httpUrl.replace(/^http/, 'ws') + '/ws/ingest'
  }

  async checkHealth(): Promise<{ online: boolean; message?: string }> {
    const httpUrl = await this.getHttpUrl()
    if (!httpUrl) {
      return { online: false, message: 'Voice Gateway is not configured.' }
    }
    try {
      await axios.get(`${httpUrl}/health`, { timeout: 3000 })
      return { online: true }
    } catch (err) {
      logger.warn(
        '[VoiceGatewayClient] Health check failed: %s',
        err instanceof Error ? err.message : String(err)
      )
      return {
        online: false,
        message: 'Voice Gateway is not running. Install it from the Supply Depot.',
      }
    }
  }

  async getWakeWordPresets(): Promise<{ presets: string[]; hasCustomModel: boolean } | null> {
    const httpUrl = await this.getHttpUrl()
    if (!httpUrl) return null
    try {
      const res = await axios.get(`${httpUrl}/wakeword-presets`, { timeout: 5000 })
      return res.data
    } catch (err) {
      logger.warn(
        '[VoiceGatewayClient] Failed to fetch wake word presets: %s',
        err instanceof Error ? err.message : String(err)
      )
      return null
    }
  }

  async uploadCustomWakeWordModel(
    buffer: Buffer,
    filename: string
  ): Promise<{ success: boolean; message: string }> {
    const httpUrl = await this.getHttpUrl()
    if (!httpUrl) {
      return { success: false, message: 'Voice Gateway is not installed.' }
    }

    // Node's native FormData/Blob (global since Node 18) avoids pulling in the
    // `form-data` package for what's otherwise a one-off multipart upload.
    const form = new FormData()
    form.append('file', new Blob([buffer]), filename)

    try {
      const res = await axios.post(`${httpUrl}/wakeword-model`, form, { timeout: 30_000 })
      return res.data
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.message || 'Upload failed.'
      logger.error(`[VoiceGatewayClient] Wake word model upload failed: ${message}`)
      return { success: false, message }
    }
  }

  async deleteCustomWakeWordModel(): Promise<{ success: boolean; message: string }> {
    const httpUrl = await this.getHttpUrl()
    if (!httpUrl) {
      return { success: false, message: 'Voice Gateway is not installed.' }
    }
    try {
      const res = await axios.delete(`${httpUrl}/wakeword-model`, { timeout: 10_000 })
      return res.data
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.message || 'Failed to remove model.'
      return { success: false, message }
    }
  }
}
