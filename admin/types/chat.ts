export interface ChatMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  content: string
  timestamp: Date
  isStreaming?: boolean
  thinking?: string
  isThinking?: boolean
  thinkingDuration?: number
  sources?: ChatRagSource[]
  // Image attachments on user messages. For the optimistic local message these are base64
  // data URLs (instant preview); after a session reload they are relative paths served by
  // /api/chat/images/*. ChatMessageBubble detects which via startsWith('data:').
  images?: string[]
  // Agent tool-call steps (tool name, step type, input/output) for assistant messages
  // produced by the agent loop. Populated live during streaming and restored from DB on reload.
  toolSteps?: ChatToolStep[]
}

export interface ChatRagSource {
  source: string
  title: string
  contentType?: string
  score?: number
  snippet: string
  kiwixPath?: string
  // Full URL for web sources (live internet results from the agent's web_search/web_fetch
  // tools). Present only for contentType: 'web' sources.
  url?: string
}

export interface ChatToolStep {
  tool: string
  step: 'start' | 'end' | 'error'
  input?: Record<string, any>
  output?: string
  error?: string
}

export interface ChatSession {
  id: string
  title: string
  lastMessage?: string
  timestamp: Date
}
