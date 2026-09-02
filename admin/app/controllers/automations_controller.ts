import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'
import { AutomationsService } from '#services/automations_service'
import { AutomationToolRegistry } from '#services/automation_tool_registry'
import { SystemService } from '#services/system_service'
import { ChatService } from '#services/chat_service'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import {
  createAutomationSchema,
  updateAutomationSchema,
  deliverAutomationSchema,
  runToolSchema,
  modelChatSchema,
  saveN8nApiKeySchema,
} from '#validators/automations'

@inject()
export default class AutomationsController {
  constructor(
    private automationsService: AutomationsService,
    private toolRegistry: AutomationToolRegistry,
    private systemService: SystemService,
    private chatService: ChatService
  ) {}

  async inertia({ inertia }: HttpContext) {
    const n8nInstalled = await this.systemService.checkServiceInstalled(SERVICE_NAMES.N8N)
    if (!n8nInstalled) {
      return inertia.render('automations', {
        automations: { n8nInstalled: false, enabled: false, n8nApiKeyConfigured: false },
      })
    }

    const enabled = await this.automationsService.isEnabled()
    const n8nApiKey = await KVStore.getValue('automation.n8nApiKey')
    return inertia.render('automations', {
      automations: {
        n8nInstalled: true,
        enabled,
        n8nApiKeyConfigured: Boolean(
          n8nApiKey && typeof n8nApiKey === 'string' && n8nApiKey.trim() !== ''
        ),
      },
    })
  }

  async index({ response }: HttpContext) {
    if (!(await this.automationsService.isN8nInstalled())) {
      return response.status(200).json({ automations: [] })
    }
    const automations = await this.automationsService.listAutomations()
    return response.status(200).json({ automations })
  }

  async store({ request, response }: HttpContext) {
    try {
      const data = await request.validateUsing(createAutomationSchema)
      const automation = await this.automationsService.createAutomation({
        name: data.name,
        prompt: data.prompt,
        scheduleCron: data.scheduleCron ?? null,
        model: data.model,
        tools: data.tools,
        targetChatSessionId: data.targetChatSessionId,
        targetChatTitle: data.targetChatTitle,
      })
      return response.status(201).json({ automation })
    } catch (error) {
      logger.error({ err: error }, '[AutomationsController] Failed to create automation')
      return response.status(500).json({
        error: 'Failed to create automation',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async update({ params, request, response }: HttpContext) {
    try {
      const data = await request.validateUsing(updateAutomationSchema)
      const automation = await this.automationsService.updateAutomation(params.id, {
        name: data.name,
        prompt: data.prompt,
        scheduleCron: data.scheduleCron,
        model: data.model,
        tools: data.tools,
        targetChatSessionId: data.targetChatSessionId,
        targetChatTitle: data.targetChatTitle,
      })
      return response.status(200).json({ automation })
    } catch (error) {
      logger.error({ err: error }, '[AutomationsController] Failed to update automation')
      return response.status(500).json({
        error: 'Failed to update automation',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async destroy({ params, response }: HttpContext) {
    try {
      await this.automationsService.deleteAutomation(params.id)
      return response.status(204)
    } catch (error) {
      logger.error({ err: error }, '[AutomationsController] Failed to delete automation')
      return response.status(500).json({
        error: 'Failed to delete automation',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async run({ params, response }: HttpContext) {
    try {
      const result = await this.automationsService.runNow(params.id)
      return response.status(200).json(result)
    } catch (error) {
      logger.error({ err: error }, '[AutomationsController] Failed to run automation')
      return response.status(500).json({
        error: 'Failed to run automation',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async runs({ params, response }: HttpContext) {
    try {
      const runs = await this.automationsService.listRuns(params.id)
      return response.status(200).json({ runs })
    } catch (error) {
      logger.error({ err: error }, '[AutomationsController] Failed to list runs')
      return response.status(500).json({
        error: 'Failed to list runs',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async tools({ response }: HttpContext) {
    const tools = this.toolRegistry.list().map((t) => ({
      name: t.name,
      description: t.description,
    }))
    return response.status(200).json({ tools })
  }

  async models({ response }: HttpContext) {
    try {
      const defaultModel = await this.automationsService.resolveDefaultModel()
      return response.status(200).json({ defaultModel })
    } catch {
      return response.status(200).json({ defaultModel: '' })
    }
  }

  async chats({ response }: HttpContext) {
    const sessions = await this.chatService.getAllSessions()
    return response.status(200).json({ chats: sessions })
  }

  async saveApiKey({ request, response }: HttpContext) {
    const data = await request.validateUsing(saveN8nApiKeySchema)
    await KVStore.setValue('automation.n8nApiKey', data.apiKey)
    return response.status(200).json({ success: true })
  }

  async status({ response }: HttpContext) {
    const n8nInstalled = await this.automationsService.isN8nInstalled()
    const enabled = await this.automationsService.isEnabled()
    const n8nApiKey = await KVStore.getValue('automation.n8nApiKey')
    return response.status(200).json({
      n8nInstalled,
      enabled,
      n8nApiKeyConfigured: Boolean(
        n8nApiKey && typeof n8nApiKey === 'string' && n8nApiKey.trim() !== ''
      ),
    })
  }

  async deliver({ request, response }: HttpContext) {
    if (!(await this._verifyInternalSecret(request))) {
      return response.status(401).json({ error: 'Unauthorized' })
    }
    try {
      const data = await request.validateUsing(deliverAutomationSchema)
      const result = await this.automationsService.deliverToChat({
        sessionId: data.sessionId,
        content: data.content,
        images: data.images,
        sources: data.sources,
        toolSteps: data.toolSteps,
      })
      return response.status(201).json(result)
    } catch (error) {
      logger.error({ err: error }, '[AutomationsController] deliver failed')
      return response.status(500).json({
        error: 'Failed to deliver automation output',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async runTool({ params, request, response }: HttpContext) {
    if (!(await this._verifyInternalSecret(request))) {
      return response.status(401).json({ error: 'Unauthorized' })
    }
    try {
      const data = await request.validateUsing(runToolSchema)
      const result = await this.toolRegistry.run(params.name, data.input ?? {}, {})
      return response.status(200).json({ result })
    } catch (error) {
      logger.error({ err: error }, `[AutomationsController] runTool "${params.name}" failed`)
      return response.status(500).json({
        error: 'Tool execution failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async modelChat({ request, response }: HttpContext) {
    if (!(await this._verifyInternalSecret(request))) {
      return response.status(401).json({ error: 'Unauthorized' })
    }
    try {
      const data = await request.validateUsing(modelChatSchema)
      const result = await this.automationsService.runModelChat({
        model: data.model,
        messages: data.messages,
      })
      return response.status(200).json(result)
    } catch (error) {
      logger.error({ err: error }, '[AutomationsController] modelChat failed')
      return response.status(500).json({
        error: 'Model chat failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async _verifyInternalSecret(request: HttpContext['request']): Promise<boolean> {
    const provided = request.header('x-nomad-automation-secret')
    if (!provided) return false
    const expected = await KVStore.getValue('automation.n8nApiKey')
    return Boolean(
      expected &&
      typeof expected === 'string' &&
      expected.trim() !== '' &&
      provided === expected.trim()
    )
  }
}
