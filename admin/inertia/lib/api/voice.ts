import { AxiosInstance } from 'axios'
import { catchInternal } from '../util'

export function getVoiceStatus(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{
      gateway: { online: boolean; message?: string }
      tts: { online: boolean; message?: string }
      xtts: { online: boolean; message?: string }
    }>('/voice/status')
    return response.data
  })()
}

export function getWakeWordPresets(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ presets: string[]; hasCustomModel: boolean }>(
      '/voice/wakeword-presets'
    )
    return response.data
  })()
}

export function uploadWakeWordModel(client: AxiosInstance, file: File) {
  return catchInternal(async () => {
    const form = new FormData()
    form.append('file', file)
    const response = await client.post<{ success: boolean; message: string }>(
      '/voice/wakeword-model',
      form
    )
    return response.data
  })()
}

export function deleteWakeWordModel(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.delete<{ success: boolean; message: string }>(
      '/voice/wakeword-model'
    )
    return response.data
  })()
}

export function getTtsVoices(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{
      voices: string[]
      downloaded: string[]
      custom: string[]
      default: string
    }>('/voice/tts/voices')
    return response.data
  })()
}

export function downloadTtsVoice(client: AxiosInstance, voice: string) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean; message: string; voice: string }>(
      '/voice/tts/voices/download',
      { voice },
      { timeout: 120_000 }
    )
    return response.data
  })()
}

export function deleteTtsVoice(client: AxiosInstance, voice: string) {
  return catchInternal(async () => {
    const response = await client.delete<{
      success: boolean
      message: string
      voice: string
    }>(`/voice/tts/voices/${encodeURIComponent(voice)}`)
    return response.data
  })()
}

export function uploadTtsVoice(client: AxiosInstance, onnxFile: File, jsonFile: File) {
  return catchInternal(async () => {
    const form = new FormData()
    form.append('onnx', onnxFile)
    form.append('config', jsonFile)
    const response = await client.post<{ success: boolean; message: string; voice: string }>(
      '/voice/tts/voices/upload',
      form,
      {
        timeout: 120_000,
        headers: { 'Content-Type': 'multipart/form-data' },
      }
    )
    return response.data
  })()
}

export function getXttsVoices(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{
      voices: string[]
      default: string | null
    }>('/voice/tts/xtts/voices')
    return response.data
  })()
}

export function cloneXttsVoice(client: AxiosInstance, name: string, file: File) {
  return catchInternal(async () => {
    const form = new FormData()
    form.append('name', name)
    form.append('file', file)
    const response = await client.post<{ success: boolean; message: string; voice: string }>(
      '/voice/tts/xtts/voices/clone',
      form,
      {
        timeout: 120_000,
        headers: { 'Content-Type': 'multipart/form-data' },
      }
    )
    return response.data
  })()
}

export function deleteXttsVoice(client: AxiosInstance, voice: string) {
  return catchInternal(async () => {
    const response = await client.delete<{
      success: boolean
      message: string
      voice: string
    }>(`/voice/tts/xtts/voices/${encodeURIComponent(voice)}`)
    return response.data
  })()
}

export async function synthesizeSpeech(
  client: AxiosInstance,
  text: string,
  voice?: string,
  speed?: number,
  engine?: string,
  language?: string,
  signal?: AbortSignal
): Promise<Blob> {
  try {
    const response = await client.post(
      '/voice/tts/synthesize',
      { text, voice, speed, engine, language },
      { responseType: 'blob', signal }
    )
    return response.data as Blob
  } catch (error) {
    const requestError = error as {
      name?: string
      code?: string
      message?: string
      response?: { data?: unknown }
    }
    if (
      requestError.name === 'CanceledError' ||
      requestError.name === 'AbortError' ||
      requestError.code === 'ERR_CANCELED'
    ) {
      throw error
    }

    const payload = requestError.response?.data
    if (payload instanceof Blob) {
      const body = await payload.text()
      try {
        const parsed = JSON.parse(body) as { error?: string; detail?: string }
        throw new Error(
          parsed.error || parsed.detail || requestError.message || 'Speech synthesis failed.'
        )
      } catch (parseError) {
        if (parseError instanceof SyntaxError) {
          throw new Error(body || requestError.message || 'Speech synthesis failed.')
        }
        throw parseError
      }
    }
    throw error
  }
}

export function listRecaps(client: AxiosInstance, limit = 30) {
  return catchInternal(async () => {
    const response = await client.get<
      Array<{
        id: number
        recap_date: string
        summary: string
        source_recording_count: number
        generated_at: string
      }>
    >('/voice/recaps', { params: { limit } })
    return response.data
  })()
}

export function generateRecap(client: AxiosInstance, date?: string) {
  return catchInternal(async () => {
    const response = await client.post<{ id: number; summary: string }>('/voice/recaps/generate', {
      date,
    })
    return response.data
  })()
}
