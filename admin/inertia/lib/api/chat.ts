import { AxiosInstance } from 'axios'
import { NomadChatResponse, NomadInstalledModel, NomadOllamaModel, OllamaChatRequest } from '../../../types/ollama'
import { catchInternal } from '../util'

export function getRemoteOllamaStatus(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ configured: boolean; connected: boolean }>(
      '/ollama/remote-status'
    )
    return response.data
  })()
}

export function getImageGenStatus(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ installed: boolean }>('/ollama/image-gen-status')
    return response.data
  })()
}

export function configureRemoteOllama(client: AxiosInstance, remoteUrl: string | null) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean; message: string }>(
      '/ollama/configure-remote',
      { remoteUrl }
    )
    return response.data
  })()
}

export function deleteModel(client: AxiosInstance, model: string) {
  return catchInternal(async () => {
    const response = await client.delete('/ollama/models', { data: { model } })
    return response.data
  })()
}

export function downloadModel(client: AxiosInstance, model: string) {
  return catchInternal(async () => {
    const response = await client.post('/ollama/models', { model })
    return response.data
  })()
}

export function getInstalledModels(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<NomadInstalledModel[]>('/ollama/installed-models')
    return response.data
  })()
}

export function unloadChatModels(client: AxiosInstance, targetModel: string | null, vramAware?: boolean) {
  return catchInternal(async () => {
    const response = await client.post<{ unloaded: string[] }>('/ollama/unload-chat-models', {
      targetModel,
      vramAware,
    })
    return response.data
  })()
}

export function ensureTeiStarted(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<{ started: boolean; alreadyRunning: boolean }>(
      '/ollama/tei/ensure-started'
    )
    return response.data
  })()
}

export function getAvailableModels(
  client: AxiosInstance,
  params: {
    query?: string
    recommendedOnly?: boolean
    limit?: number
    force?: boolean
    sort?: 'pulls' | 'name' | 'recent'
  }
) {
  return catchInternal(async () => {
    const response = await client.get<{
      models: NomadOllamaModel[]
      hasMore: boolean
    }>('/ollama/models', {
      params: { sort: 'pulls', ...params },
    })
    return response.data
  })()
}

export function sendChatMessage(client: AxiosInstance, chatRequest: OllamaChatRequest) {
  return catchInternal(async () => {
    const response = await client.post<NomadChatResponse>('/ollama/chat', chatRequest)
    return response.data
  })()
}

export async function streamChatMessage(
  chatRequest: OllamaChatRequest,
  onChunk: (content: string, thinking: string, done: boolean) => void,
  signal?: AbortSignal,
  onSources?: (
    sources: Array<{
      source: string
      title: string
      contentType?: string
      score?: number
      snippet: string
      kiwixPath?: string
      url?: string
    }>
  ) => void,
  onToolStep?: (step: {
    tool: string
    step: 'start' | 'end' | 'error'
    input?: Record<string, any>
    output?: string
    error?: string
  }) => void,
  onImages?: (images: string[]) => void
): Promise<void> {
  const response = await fetch('/api/ollama/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...chatRequest, stream: true }),
    signal,
  })

  if (!response.ok || !response.body) {
    throw new Error(`HTTP error: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        let data: any
        try {
          data = JSON.parse(line.slice(6))
        } catch {
          continue /* skip malformed chunks */
        }

        if (data.error)
          throw new Error(data.message || 'The model encountered an error. Please try again.')

        if (data.toolStep && onToolStep) {
          onToolStep(data.toolStep)
          continue
        }

        if (Array.isArray(data.sources)) {
          if (onSources) onSources(data.sources)
          continue
        }

        if (Array.isArray(data.images)) {
          if (onImages) onImages(data.images)
          continue
        }

        onChunk(data.message?.content ?? '', data.message?.thinking ?? '', data.done ?? false)
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError' || signal?.aborted) return
    throw err
  } finally {
    try {
      reader.releaseLock()
    } catch {}
  }
}

export function getChatSuggestions(client: AxiosInstance, signal?: AbortSignal) {
  return catchInternal(async () => {
    const response = await client.get<{ suggestions: string[] }>('/chat/suggestions', {
      signal,
    })
    return response.data.suggestions
  })()
}

export function getChatSessions(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<
      Array<{
        id: string
        title: string
        model: string | null
        timestamp: string
        lastMessage: string | null
      }>
    >('/chat/sessions')
    return response.data
  })()
}

export function getChatSession(client: AxiosInstance, sessionId: string) {
  return catchInternal(async () => {
    const response = await client.get<{
      id: string
      title: string
      model: string | null
      timestamp: string
      messages: Array<{
        id: string
        role: 'system' | 'user' | 'assistant'
        content: string
        images?: string[]
        sources?: Array<{
          source: string
          title: string
          contentType?: string
          score?: number
          snippet: string
          kiwixPath?: string
          url?: string
        }>
        toolSteps?: Array<{
          tool: string
          step: 'start' | 'end' | 'error'
          input?: Record<string, any>
          output?: string
          error?: string
        }>
        timestamp: string
      }>
    }>(`/chat/sessions/${sessionId}`)
    return response.data
  })()
}

export function createChatSession(client: AxiosInstance, title: string, model?: string) {
  return catchInternal(async () => {
    const response = await client.post<{
      id: string
      title: string
      model: string | null
      timestamp: string
    }>('/chat/sessions', { title, model })
    return response.data
  })()
}

export function updateChatSession(
  client: AxiosInstance,
  sessionId: string,
  data: { title?: string; model?: string }
) {
  return catchInternal(async () => {
    const response = await client.put<{
      id: string
      title: string
      model: string | null
      timestamp: string
    }>(`/chat/sessions/${sessionId}`, data)
    return response.data
  })()
}

export function deleteChatSession(client: AxiosInstance, sessionId: string) {
  return catchInternal(async () => {
    await client.delete(`/chat/sessions/${sessionId}`)
  })()
}

export function deleteAllChatSessions(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.delete<{ success: boolean; message: string }>(
      '/chat/sessions/all'
    )
    return response.data
  })()
}

export function addChatMessage(
  client: AxiosInstance,
  sessionId: string,
  role: 'system' | 'user' | 'assistant',
  content: string
) {
  return catchInternal(async () => {
    const response = await client.post<{
      id: string
      role: 'system' | 'user' | 'assistant'
      content: string
      timestamp: string
    }>(`/chat/sessions/${sessionId}/messages`, { role, content })
    return response.data
  })()
}

export function getNomadMd(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ content: string }>('/ai/nomad-md')
    return response.data
  })()
}

export function saveNomadMd(client: AxiosInstance, content: string) {
  return catchInternal(async () => {
    const response = await client.put<{ success: boolean; message: string }>('/ai/nomad-md', {
      content,
    })
    return response.data
  })()
}
