import { inject } from '@adonisjs/core'
import axios from 'axios'
import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'

export type SynthesizeResult =
  | { success: true; audio: Buffer; contentType: string }
  | { success: false; message: string }

const DEFAULT_VOICE = 'en_US-lessac-medium'

// TTS (Piper) is installed as a normal Supply Depot app (see ServiceSeeder /
// SERVICE_NAMES.TTS), but same rationale as VoiceGatewayClientService — it has no
// browser-facing web UI, so the container name + port are hardcoded here rather than
// resolved via DockerService.getServiceURL.
const TTS_CONTAINER_NAME = 'nomad_tts'
const TTS_PORT = '8610'

/**
 * Thin proxy to the Piper-based `nomad_tts` container. Used for the chat
 * message speaker button and daily recap narration.
 */
@inject()
export class TtsService {
  private async getUrl(): Promise<string> {
    const host = process.env.NODE_ENV === 'production' ? TTS_CONTAINER_NAME : 'localhost'
    return `http://${host}:${TTS_PORT}`
  }

  async checkHealth(): Promise<{ online: boolean; message?: string }> {
    const url = await this.getUrl()
    try {
      await axios.get(`${url}/health`, { timeout: 3000 })
      return { online: true }
    } catch {
      return {
        online: false,
        message: 'Text-to-Speech service is not running. Install it from the Supply Depot.',
      }
    }
  }

  async listVoices(): Promise<{ voices: string[]; downloaded: string[]; default: string } | null> {
    const url = await this.getUrl()
    if (!url) return null
    try {
      const res = await axios.get(`${url}/voices`, { timeout: 10_000 })
      return res.data
    } catch (err) {
      logger.warn(
        `[TtsService] Failed to list voices: ${err instanceof Error ? err.message : String(err)}`
      )
      return null
    }
  }

  async downloadVoice(voice: string): Promise<{ success: boolean; message: string }> {
    const url = await this.getUrl()
    if (!url) return { success: false, message: 'Text-to-Speech service is not installed.' }
    try {
      const res = await axios.post(`${url}/voices/download`, { voice }, { timeout: 120_000 })
      return res.data
    } catch (err: any) {
      const message = err?.response?.data?.detail || err?.message || 'Download failed.'
      logger.error(`[TtsService] Download voice failed: ${message}`)
      return { success: false, message }
    }
  }

  async deleteVoice(voice: string): Promise<{ success: boolean; message: string }> {
    const url = await this.getUrl()
    if (!url) return { success: false, message: 'Text-to-Speech service is not installed.' }
    try {
      const res = await axios.delete(`${url}/voices/${encodeURIComponent(voice)}`, {
        timeout: 10_000,
      })
      return res.data
    } catch (err: any) {
      const message = err?.response?.data?.detail || err?.message || 'Delete failed.'
      logger.error(`[TtsService] Delete voice failed: ${message}`)
      return { success: false, message }
    }
  }

  async synthesize(text: string, voiceOverride?: string): Promise<SynthesizeResult> {
    const url = await this.getUrl()
    if (!url) {
      return { success: false, message: 'Text-to-Speech service is not installed.' }
    }

    const voice = voiceOverride || (await KVStore.getValue('tts.voice')) || DEFAULT_VOICE
    const speedRaw = await KVStore.getValue('tts.speechRate')
    const speed = speedRaw ? Number.parseFloat(speedRaw) : 1.0

    const cleanText = sanitizeTextForSpeech(text)
    if (!cleanText) {
      return { success: false, message: 'Nothing to synthesize after sanitizing.' }
    }

    try {
      const response = await axios.post(
        `${url}/synthesize`,
        { text: cleanText, voice, speed },
        { responseType: 'arraybuffer', timeout: 30_000 }
      )
      return { success: true, audio: Buffer.from(response.data), contentType: 'audio/wav' }
    } catch (err: any) {
      const message =
        err?.response?.data instanceof Buffer
          ? err.response.data.toString('utf-8')
          : err?.message || 'Speech synthesis failed.'
      logger.error(`[TtsService] Synthesis failed: ${message}`)
      return { success: false, message }
    }
  }
}

function sanitizeTextForSpeech(text: string): string {
  let s = text

  s = s.replace(/^#{1,6}\s+/gm, '')
  s = s.replace(/^\|.*\|$/gm, '')
  s = s.replace(/^\s*[-:]+\s*$/gm, '')
  s = s.replace(/```[\s\S]*?```/g, ' code block ')
  s = s.replace(/`([^`]+)`/g, '$1')
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
  s = s.replace(/\*([^*]+)\*/g, '$1')
  s = s.replace(/__([^_]+)__/g, '$1')
  s = s.replace(/_([^_]+)_/g, '$1')
  s = s.replace(/~~([^~]+)~~/g, '$1')
  s = s.replace(/^\s*[-*+]\s+/gm, '')
  s = s.replace(/^\s*\d+\.\s+/gm, '')
  s = s.replace(/^\s*>\s+/gm, '')
  s = s.replace(/\|/g, ' ')
  s = s.replace(/[#*~`]/g, '')
  s = s.replace(/\.{3,}/g, ' ')
  s = s.replace(/\*{2,}/g, ' ')
  s = s.replace(/\n{3,}/g, '\n\n')
  s = s.replace(/\s{2,}/g, ' ')
  return s.trim()
}
