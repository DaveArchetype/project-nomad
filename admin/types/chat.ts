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
}

export interface ChatRagSource {
  source: string
  title: string
  contentType?: string
  score?: number
  snippet: string
  kiwixPath?: string
}

export interface ChatSession {
  id: string
  title: string
  lastMessage?: string
  timestamp: Date
}
