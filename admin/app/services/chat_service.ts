import ChatSession from '#models/chat_session'
import ChatMessage from '#models/chat_message'
import KVStore from '#models/kv_store'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import { OllamaService } from './ollama_service.js'
import { SYSTEM_PROMPTS } from '../../constants/ollama.js'

const SUGGESTIONS_CACHE_TTL_MS = 30 * 60 * 1000
const SUGGESTIONS_TO_RETURN = 4
const SUGGESTIONS_TO_GENERATE = 8

const FALLBACK_SUGGESTIONS = [
  "What's the trick to getting a perfect sear on a steak?",
  'Why does the sky turn red at sunset but blue at noon?',
  "Explain quantum entanglement like I'm five years old",
  'What if the Romans had developed steam power?',
  'How do submarines find their way underwater without GPS?',
  'What makes a sourdough starter different from regular yeast?',
  'Why do we dream, and do scientists actually know?',
  'How did ancient civilizations map the stars so accurately?',
  "What's the most counterintuitive fact in biology?",
  'How do honeybees communicate the location of flowers?',
  'What would happen if you fell into a black hole?',
  'Why do some languages have genders for inanimate objects?',
  'How does encryption actually keep my data safe?',
  "What's the history behind the QWERTY keyboard layout?",
  'Why do onions make us cry, and is there a way to stop it?',
  'How do trees survive freezing winters without dying?',
  "What's the difference between a virus and a bacteria?",
  'How did the concept of zero change mathematics?',
  'Why do we experience jet lag, and how do you beat it?',
  "What makes a musical chord sound 'happy' or 'sad'?",
]

type SuggestionsCache = { suggestions: string[]; generatedAt: number; v?: number }

const SUGGESTIONS_CACHE_VERSION = 2

@inject()
export class ChatService {
  constructor(private ollamaService: OllamaService) {}

  async getAllSessions() {
    try {
      const sessions = await ChatSession.query().orderBy('updated_at', 'desc')
      return sessions.map((session) => ({
        id: session.id.toString(),
        title: session.title,
        model: session.model,
        timestamp: session.updated_at.toJSDate(),
        lastMessage: null, // Will be populated from messages if needed
      }))
    } catch (error) {
      logger.error(
        `[ChatService] Failed to get sessions: ${error instanceof Error ? error.message : error}`
      )
      return []
    }
  }

  async getChatSuggestions() {
    try {
      let pool = await this._readSuggestionsCache()
      if (!pool || pool.length === 0) {
        pool = await this._generateSuggestions()
        if (pool.length > 0) {
          await this._writeSuggestionsCache(pool)
        }
      }

      if (pool.length === 0) {
        pool = this._getFallbackSuggestions()
      }

      return this._pickRandom(pool, SUGGESTIONS_TO_RETURN)
    } catch (error) {
      logger.error(
        `[ChatService] Failed to get chat suggestions: ${
          error instanceof Error ? error.message : error
        }`
      )
      return this._pickRandom(this._getFallbackSuggestions(), SUGGESTIONS_TO_RETURN)
    }
  }

  private async _generateSuggestions(): Promise<string[]> {
    const models = await this.ollamaService.getModels()
    if (!models || models.length === 0) {
      return []
    }

    // Always use the smallest installed model for suggestions. They are trivial
    // prompts that don't benefit from a flagship model, and loading a large
    // model (e.g. llama3.1:405b) just to generate 3 questions wastes VRAM and
    // time — if it exceeds available VRAM, Ollama spends minutes trying to load
    // it and the request 500s.
    const chosen = models.reduce((prev, current) => (prev.size < current.size ? prev : current))
    if (!chosen) return []

    const response = await this.ollamaService.chat({
      model: chosen.name,
      messages: [
        {
          role: 'user',
          content: SYSTEM_PROMPTS.chat_suggestions,
        },
      ],
      stream: false,
    })

    let suggestions: string[] = []
    if (response && response.message && response.message.content) {
      const content = response.message.content.trim()

      // Handle both comma-separated and newline-separated formats
      if (content.includes(',')) {
        suggestions = content.split(',').map((s) => s.trim())
      } else {
        suggestions = content
          .split(/\r?\n/)
          .map((s) => s.trim())
          .map((s) => s.replace(/^\d+\.\s*/, '').replace(/^[-*•]\s*/, ''))
          .map((s) => s.replace(/^["']|["']$/g, ''))
      }

      suggestions = suggestions.filter((s) => s.length > 0).slice(0, SUGGESTIONS_TO_GENERATE)

      // Discard the entire batch if any suggestion looks like run-together
      // words (e.g. "Didyouknow", "Whatistheoriginofthewordglitch"). Small
      // models sometimes ignore spacing instructions; returning [] and
      // skipping the cache write lets the next request regenerate cleanly
      // instead of persisting garbage for the cache TTL.
      if (suggestions.some((s) => !this._isValidSuggestion(s))) {
        logger.warn(
          `[ChatService] Discarding malformed suggestions batch (run-together words): ${JSON.stringify(suggestions)}`
        )
        return []
      }
    }

    return suggestions
  }

  private _getFallbackSuggestions(): string[] {
    return [...FALLBACK_SUGGESTIONS]
  }

  private _pickRandom<T>(items: T[], count: number): T[] {
    const shuffled = [...items].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, Math.min(count, shuffled.length))
  }

  private async _readSuggestionsCache(): Promise<string[] | null> {
    try {
      const raw = await KVStore.getValue('chat.suggestionsCache')
      if (!raw) return null
      const parsed = JSON.parse(raw) as SuggestionsCache
      if (!parsed || !Array.isArray(parsed.suggestions) || typeof parsed.generatedAt !== 'number') {
        return null
      }
      if (Date.now() - parsed.generatedAt > SUGGESTIONS_CACHE_TTL_MS) {
        return null
      }
      // Invalidate caches from the old format (v1: 3 title-cased items).
      if (parsed.v !== SUGGESTIONS_CACHE_VERSION) {
        await KVStore.clearValue('chat.suggestionsCache')
        return null
      }
      // Purge cached entries that contain run-together words (e.g. legacy
      // "Didyouknow" rows written before validation existed). Clearing the KV
      // row and returning null forces regeneration on this same request.
      if (parsed.suggestions.some((s) => !this._isValidSuggestion(s))) {
        logger.warn(
          `[ChatService] Purging malformed suggestions cache (run-together words): ${JSON.stringify(parsed.suggestions)}`
        )
        await KVStore.clearValue('chat.suggestionsCache')
        return null
      }
      return parsed.suggestions
    } catch {
      return null
    }
  }

  /**
   * Reject suggestions that look like run-together words. Small models
   * sometimes ignore spacing instructions and emit tokens like "Didyouknow"
   * or "Whatistheoriginofthewordglitch".
   *
   * A suggestion is valid when:
   *  - it contains at least one space (multi-word question), OR
   *  - it is a single short token (<= 12 chars, e.g. "Hello?").
   * It is invalid when it is a long single token with no spaces, or when it
   * contains internal capitals after the first character with no spaces
   * (camelCase run-together like "DidYouKnow").
   */
  private _isValidSuggestion(s: string): boolean {
    if (!s || typeof s !== 'string') return false
    const trimmed = s.trim()
    if (trimmed.length === 0) return false
    const hasSpace = /\s/.test(trimmed)
    if (hasSpace) return true
    // Single-token suggestion: only allow if it's short (a real one-word
    // question like "Hello?" or "Why?"). Long single tokens are almost
    // always run-together words.
    if (trimmed.length > 12) return false
    // Reject camelCase / PascalCase run-together (capital after the first
    // char with no spaces, e.g. "DidYouKnow").
    if (/[A-Z]/.test(trimmed.slice(1))) return false
    return true
  }

  private async _writeSuggestionsCache(suggestions: string[]): Promise<void> {
    try {
      const payload: SuggestionsCache = {
        suggestions,
        generatedAt: Date.now(),
        v: SUGGESTIONS_CACHE_VERSION,
      }
      await KVStore.setValue('chat.suggestionsCache', JSON.stringify(payload))
    } catch (err) {
      logger.warn(
        `[ChatService] Failed to persist suggestions cache: ${
          err instanceof Error ? err.message : err
        }`
      )
    }
  }

  async getSession(sessionId: number) {
    try {
      const session = await ChatSession.query().where('id', sessionId).preload('messages').first()

      if (!session) {
        return null
      }

      return {
        id: session.id.toString(),
        title: session.title,
        model: session.model,
        timestamp: session.updated_at.toJSDate(),
        messages: session.messages.map((msg) => ({
          id: msg.id.toString(),
          role: msg.role,
          content: msg.content,
          images: msg.images ?? undefined,
          sources: msg.sources ?? undefined,
          toolSteps: msg.tool_steps ?? undefined,
          timestamp: msg.created_at.toJSDate(),
        })),
      }
    } catch (error) {
      logger.error(
        `[ChatService] Failed to get session ${sessionId}: ${
          error instanceof Error ? error.message : error
        }`
      )
      return null
    }
  }

  async createSession(title: string, model?: string) {
    try {
      const session = await ChatSession.create({
        title,
        model: model || null,
      })

      return {
        id: session.id.toString(),
        title: session.title,
        model: session.model,
        timestamp: session.created_at.toJSDate(),
      }
    } catch (error) {
      logger.error(
        `[ChatService] Failed to create session: ${error instanceof Error ? error.message : error}`
      )
      throw new Error('Failed to create chat session')
    }
  }

  async updateSession(sessionId: number, data: { title?: string; model?: string }) {
    try {
      const session = await ChatSession.findOrFail(sessionId)

      if (data.title) {
        session.title = data.title
      }
      if (data.model !== undefined) {
        session.model = data.model
      }

      await session.save()

      return {
        id: session.id.toString(),
        title: session.title,
        model: session.model,
        timestamp: session.updated_at.toJSDate(),
      }
    } catch (error) {
      logger.error(
        `[ChatService] Failed to update session ${sessionId}: ${
          error instanceof Error ? error.message : error
        }`
      )
      throw new Error('Failed to update chat session')
    }
  }

  async addMessage(
    sessionId: number,
    role: 'system' | 'user' | 'assistant',
    content: string,
    images?: string[] | null,
    sources?: Record<string, any>[] | null,
    toolSteps?: Record<string, any>[] | null
  ) {
    try {
      const message = await ChatMessage.create({
        session_id: sessionId,
        role,
        content,
        images: images && images.length > 0 ? images : null,
        sources: sources && sources.length > 0 ? sources : null,
        tool_steps: toolSteps && toolSteps.length > 0 ? toolSteps : null,
      })

      // Update session's updated_at timestamp
      const session = await ChatSession.findOrFail(sessionId)
      session.updated_at = DateTime.now()
      await session.save()

      return {
        id: message.id.toString(),
        role: message.role,
        content: message.content,
        images: message.images ?? undefined,
        sources: message.sources ?? undefined,
        toolSteps: message.tool_steps ?? undefined,
        timestamp: message.created_at.toJSDate(),
      }
    } catch (error) {
      logger.error(
        `[ChatService] Failed to add message to session ${sessionId}: ${
          error instanceof Error ? error.message : error
        }`
      )
      throw new Error('Failed to add message')
    }
  }

  async deleteSession(sessionId: number) {
    try {
      const session = await ChatSession.findOrFail(sessionId)
      await session.delete()
      return { success: true }
    } catch (error) {
      logger.error(
        `[ChatService] Failed to delete session ${sessionId}: ${
          error instanceof Error ? error.message : error
        }`
      )
      throw new Error('Failed to delete chat session')
    }
  }

  async getMessageCount(sessionId: number): Promise<number> {
    try {
      const count = await ChatMessage.query().where('session_id', sessionId).count('* as total')
      return Number(count[0].$extras.total)
    } catch (error) {
      logger.error(
        `[ChatService] Failed to get message count for session ${sessionId}: ${error instanceof Error ? error.message : error}`
      )
      return 0
    }
  }

  async generateTitle(
    sessionId: number,
    userMessage: string,
    assistantMessage: string,
    model: string
  ) {
    try {
      let title: string

      const response = await this.ollamaService.chat({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.title_generation },
          { role: 'user', content: userMessage },
          { role: 'assistant', content: assistantMessage },
        ],
      })

      title = response?.message?.content?.trim()
      if (!title) {
        title = userMessage.slice(0, 57) + (userMessage.length > 57 ? '...' : '')
      }

      await this.updateSession(sessionId, { title })
      logger.info(`[ChatService] Generated title for session ${sessionId}: "${title}"`)
    } catch (error) {
      logger.error(
        `[ChatService] Failed to generate title for session ${sessionId}: ${error instanceof Error ? error.message : error}`
      )
      // Fall back to truncated user message
      try {
        const fallbackTitle = userMessage.slice(0, 57) + (userMessage.length > 57 ? '...' : '')
        await this.updateSession(sessionId, { title: fallbackTitle })
      } catch {
        // Silently fail - session keeps "New Chat" title
      }
    }
  }

  async deleteAllSessions() {
    try {
      await ChatSession.query().delete()
      return { success: true, message: 'All chat sessions deleted' }
    } catch (error) {
      logger.error(
        `[ChatService] Failed to delete all sessions: ${
          error instanceof Error ? error.message : error
        }`
      )
      throw new Error('Failed to delete all chat sessions')
    }
  }
}
