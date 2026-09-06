import { inject } from '@adonisjs/core'
import axios from 'axios'
import FormData from 'form-data'
import logger from '@adonisjs/core/services/logger'
import { SynthesizeResult } from '#services/tts_service'

const XTTS_CONTAINER_NAME = 'nomad_xtts'
const XTTS_PORT = '8611'

/**
 * Thin proxy to the XTTSv2-based `nomad_xtts` container. OPTIONAL GPU-only
 * voice cloning service — installed from Supply Depot ("Voice Cloning TTS").
 * Complements the CPU-only Piper TTS service. Used when `tts.engine` = 'xtts'.
 */
@inject()
export class XttsService {
  private async getUrl(): Promise<string> {
    const host = process.env.NODE_ENV === 'production' ? XTTS_CONTAINER_NAME : 'localhost'
    return `http://${host}:${XTTS_PORT}`
  }

  async checkHealth(): Promise<{ online: boolean; message?: string }> {
    const url = await this.getUrl()
    try {
      await axios.get(`${url}/health`, { timeout: 5000 })
      return { online: true }
    } catch {
      return {
        online: false,
        message:
          'Voice Cloning TTS service is not running. Install it from the Supply Depot (requires GPU).',
      }
    }
  }

  async listVoices(): Promise<{ voices: string[]; default: string | null } | null> {
    const url = await this.getUrl()
    try {
      const res = await axios.get(`${url}/voices`, { timeout: 10_000 })
      return res.data
    } catch (err) {
      logger.warn(
        `[XttsService] Failed to list voices: ${err instanceof Error ? err.message : String(err)}`
      )
      return null
    }
  }

  async cloneVoice(
    name: string,
    audioBuffer: Buffer,
    filename: string
  ): Promise<{ success: boolean; message: string }> {
    const url = await this.getUrl()
    try {
      const form = new FormData()
      form.append('name', name)
      form.append('file', audioBuffer, {
        filename,
        contentType: 'application/octet-stream',
      })
      const res = await axios.post(`${url}/voices/clone`, form, {
        headers: form.getHeaders(),
        timeout: 60_000,
      })
      return res.data
    } catch (err: any) {
      const message = err?.response?.data?.detail || err?.message || 'Clone failed.'
      logger.error(`[XttsService] Clone voice failed: ${message}`)
      return { success: false, message }
    }
  }

  async deleteVoice(voice: string): Promise<{ success: boolean; message: string }> {
    const url = await this.getUrl()
    try {
      const res = await axios.delete(`${url}/voices/${encodeURIComponent(voice)}`, {
        timeout: 10_000,
      })
      return res.data
    } catch (err: any) {
      const message = err?.response?.data?.detail || err?.message || 'Delete failed.'
      logger.error(`[XttsService] Delete voice failed: ${message}`)
      return { success: false, message }
    }
  }

  async synthesize(
    text: string,
    voice: string,
    language?: string,
    speed?: number
  ): Promise<SynthesizeResult> {
    const url = await this.getUrl()
    try {
      const response = await axios.post(
        `${url}/synthesize`,
        { text, voice, language, speed },
        { responseType: 'arraybuffer', timeout: 60_000 }
      )
      return { success: true, audio: Buffer.from(response.data), contentType: 'audio/wav' }
    } catch (err: any) {
      const message =
        err?.response?.data instanceof Buffer
          ? err.response.data.toString('utf-8')
          : err?.response?.data?.detail || err?.message || 'Speech synthesis failed.'
      logger.error(`[XttsService] Synthesis failed: ${message}`)
      return { success: false, message }
    }
  }
}
