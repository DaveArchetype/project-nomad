import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { ChatService } from '#services/chat_service'
import { ChatImageService } from '#services/chat_image_service'
import { createSessionSchema, updateSessionSchema, addMessageSchema } from '#validators/chat'
import KVStore from '#models/kv_store'
import { SystemService } from '#services/system_service'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import logger from '@adonisjs/core/services/logger'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, basename } from 'node:path'

@inject()
export default class ChatsController {
  constructor(
    private chatService: ChatService,
    private systemService: SystemService
  ) {}

  async inertia({ inertia, response }: HttpContext) {
    const aiAssistantInstalled = await this.systemService.checkServiceInstalled(
      SERVICE_NAMES.OLLAMA
    )
    if (!aiAssistantInstalled) {
      return response.status(404).json({ error: 'AI Assistant service not installed' })
    }

    const chatSuggestionsEnabled = await KVStore.getValue('chat.suggestionsEnabled')
    return inertia.render('chat', {
      settings: {
        chatSuggestionsEnabled: chatSuggestionsEnabled ?? false,
      },
    })
  }

  async index({}: HttpContext) {
    return await this.chatService.getAllSessions()
  }

  async show({ params, response }: HttpContext) {
    const sessionId = parseInt(params.id)
    const session = await this.chatService.getSession(sessionId)

    if (!session) {
      return response.status(404).json({ error: 'Session not found' })
    }

    return session
  }

  async store({ request, response }: HttpContext) {
    try {
      const data = await request.validateUsing(createSessionSchema)
      const session = await this.chatService.createSession(data.title, data.model)
      return response.status(201).json(session)
    } catch (error) {
      logger.error({ err: error }, '[ChatsController] Failed to create session')
      return response.status(500).json({
        error: 'Failed to create session',
      })
    }
  }

  async suggestions({ response }: HttpContext) {
    try {
      const suggestions = await this.chatService.getChatSuggestions()
      return response.status(200).json({ suggestions })
    } catch (error) {
      logger.error({ err: error }, '[ChatsController] Failed to get suggestions')
      return response.status(500).json({
        error: 'Failed to get suggestions',
      })
    }
  }

  async update({ params, request, response }: HttpContext) {
    try {
      const sessionId = parseInt(params.id)
      const data = await request.validateUsing(updateSessionSchema)
      const session = await this.chatService.updateSession(sessionId, data)
      return session
    } catch (error) {
      logger.error({ err: error }, '[ChatsController] Failed to update session')
      return response.status(500).json({
        error: 'Failed to update session',
      })
    }
  }

  async destroy({ params, response }: HttpContext) {
    try {
      const sessionId = parseInt(params.id)
      await this.chatService.deleteSession(sessionId)
      return response.status(204)
    } catch (error) {
      logger.error({ err: error }, '[ChatsController] Failed to delete session')
      return response.status(500).json({
        error: 'Failed to delete session',
      })
    }
  }

  async addMessage({ params, request, response }: HttpContext) {
    try {
      const sessionId = parseInt(params.id)
      const data = await request.validateUsing(addMessageSchema)
      const message = await this.chatService.addMessage(
        sessionId,
        data.role,
        data.content,
        data.images
      )
      return response.status(201).json(message)
    } catch (error) {
      logger.error({ err: error }, '[ChatsController] Failed to add message')
      return response.status(500).json({
        error: 'Failed to add message',
      })
    }
  }

  async destroyAll({ response }: HttpContext) {
    try {
      const result = await this.chatService.deleteAllSessions()
      return response.status(200).json(result)
    } catch (error) {
      logger.error({ err: error }, '[ChatsController] Failed to delete all sessions')
      return response.status(500).json({
        error: 'Failed to delete all sessions',
      })
    }
  }

  /**
   * Serve a persisted chat image attachment. The route is parameterized as
   * /api/chat/images/* where the wildcard is the relative path stored in the
   * chat_messages.images JSON array (e.g. chat_images/2026-08-24/...jpg).
   * Path traversal is rejected by ChatImageService.resolveAbsolutePath.
   */
  async serveImage({ request, response }: HttpContext) {
    const relPath = request.param('*').join('/')
    if (!relPath) {
      return response.status(404).json({ error: 'Not found' })
    }

    const chatImageService = new ChatImageService()
    const absPath = chatImageService.resolveAbsolutePath(relPath)
    if (!absPath) {
      return response.status(404).json({ error: 'Not found' })
    }

    try {
      await stat(absPath)
    } catch {
      return response.status(404).json({ error: 'Not found' })
    }

    const ext = extname(absPath).toLowerCase()
    const mimeByExt: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    }
    const mime = mimeByExt[ext] ?? 'application/octet-stream'
    response.header('Content-Type', mime)
    response.header('Cache-Control', 'private, max-age=31536000, immutable')
    response.header('Content-Disposition', `inline; filename="${basename(absPath)}"`)
    return response.stream(createReadStream(absPath))
  }
}
