export type NomadOllamaModel = {
  id: string
  name: string
  description: string
  estimated_pulls: string
  model_last_updated: string
  first_seen: string
  tags: NomadOllamaModelTag[]
}

export type NomadOllamaModelTag = {
  name: string
  size: string
  context: string
  input: string
  cloud: boolean
  thinking: boolean
}

export type NomadOllamaModelAPIResponse = {
  success: boolean
  message: string
  models: NomadOllamaModel[]
}

export type OllamaChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
  // Base64 data URLs for image attachments on user messages (vision models only).
  // The controller converts these to OpenAI multimodal content parts before forwarding
  // to OllamaService, and persists them to disk.
  images?: string[]
}

export type OllamaChatRequest = {
  model: string
  messages: OllamaChatMessage[]
  stream?: boolean
  sessionId?: number
  // Effective thinking preference for this request (per-model override or global default).
  think?: boolean
  collection?: string
  // Tools to enable for the agent loop. When present and non-empty, the request is routed
  // through the agent path server-side. The "Internet" UI toggle expands to both
  // 'web_search' and 'web_fetch' before sending.
  tools?: string[]
}

export type OllamaChatResponse = {
  model: string
  created_at: string
  message: {
    role: string
    content: string
  }
  done: boolean
}

export type NomadInstalledModel = {
  name: string
  size: number
  digest?: string
  details?: Record<string, any>
  // Whether the model supports "thinking" (set by the installed-models endpoint enrichment).
  thinking?: boolean
  // Whether the model supports image/vision input (set by the installed-models endpoint enrichment).
  vision?: boolean
  // Whether the model supports tool calling (set by the installed-models endpoint enrichment).
  tools?: boolean
}

export type NomadChatResponse = {
  message: { content: string; thinking?: string }
  done: boolean
  model: string
  sources?: Array<{
    source: string
    title: string
    contentType?: string
    score?: number
    snippet: string
    kiwixPath?: string
  }>
}
