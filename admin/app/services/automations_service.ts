import { inject } from '@adonisjs/core'
import axios, { AxiosInstance } from 'axios'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'
import Service from '#models/service'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import { OllamaService } from './ollama_service.js'
import { ChatService } from './chat_service.js'
import { SystemService } from './system_service.js'
import transmit from '@adonisjs/transmit/services/main'
import { BROADCAST_CHANNELS } from '../../constants/broadcast.js'
import { SYSTEM_PROMPTS } from '../../constants/ollama.js'

export type Automation = {
  id: string
  name: string
  prompt: string
  scheduleCron: string | null
  model: string
  tools: string[]
  targetChatSessionId: string | 'new'
  targetChatTitle: string | null
  active: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  isDefault: boolean
}

export type AutomationRun = {
  id: string
  status: string
  startedAt: string
  finishedAt: string | null
  mode: string
}

export type CreateAutomationInput = {
  name: string
  prompt: string
  scheduleCron: string | null
  model?: string
  tools?: string[]
  targetChatSessionId?: string | 'new'
  targetChatTitle?: string
}

const N8N_TAG = 'nomad-automation'
const N8N_DEFAULT_TAG = 'nomad-default'
const DEFAULT_AUTOMATION_NAME = 'Daily Topic Suggestions'
const DEFAULT_AUTOMATION_PROMPT =
  'Generate 5 interesting, varied topic suggestions the user might want to explore today. For each, write a one-line hook that makes them want to dig in. Return them as a numbered list.'
const DEFAULT_AUTOMATION_CRON = '0 15 * * *'

@inject()
export class AutomationsService {
  constructor(
    private ollamaService: OllamaService,
    private chatService: ChatService,
    private systemService: SystemService
  ) {}

  async isN8nInstalled(): Promise<boolean> {
    return this.systemService.checkServiceInstalled(SERVICE_NAMES.N8N)
  }

  async isEnabled(): Promise<boolean> {
    const enabled = await KVStore.getValue('automation.enabled')
    return enabled !== false
  }

  private async resolveN8nBaseUrl(): Promise<string | null> {
    const override = await KVStore.getValue('automation.n8nBaseUrl')
    if (override && typeof override === 'string' && override.trim() !== '') {
      return override.trim().replace(/\/$/, '')
    }

    const service = await Service.query()
      .where('service_name', SERVICE_NAMES.N8N)
      .andWhere('installed', true)
      .first()
    if (!service) return null

    const hostname = process.env.NODE_ENV === 'production' ? SERVICE_NAMES.N8N : 'localhost'
    let internalPort: string | null = null
    try {
      const raw = service.container_config
      const parsed = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : null
      if (parsed) {
        const exposed = parsed.ExposedPorts || {}
        internalPort = Object.keys(exposed)[0]?.replace('/tcp', '') ?? null
        if (!internalPort && parsed.HostConfig?.PortBindings) {
          internalPort = Object.keys(parsed.HostConfig.PortBindings)[0]?.replace('/tcp', '') ?? null
        }
      }
    } catch {}

    if (!internalPort) return null
    const hostPort =
      service.ui_location && Number.parseInt(service.ui_location, 10)
        ? service.ui_location
        : internalPort
    const port = hostname === 'localhost' ? hostPort : internalPort
    return `http://${hostname}:${port}`
  }

  private async getN8nClient(): Promise<{ client: AxiosInstance; baseUrl: string }> {
    const baseUrl = await this.resolveN8nBaseUrl()
    if (!baseUrl) {
      throw new Error('Automations engine (n8n) is not installed or not reachable.')
    }
    const apiKey = await KVStore.getValue('automation.n8nApiKey')
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new Error(
        'n8n API key is not configured. Open n8n → Settings → API → create a key, then paste it into the Automations settings panel.'
      )
    }
    const client = axios.create({
      baseURL: `${baseUrl}/api/v1`,
      headers: {
        'X-N8N-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    })
    return { client, baseUrl }
  }

  async resolveDefaultModel(): Promise<string> {
    const explicit = await KVStore.getValue('automation.defaultModel')
    if (explicit && typeof explicit === 'string' && explicit.trim() !== '') {
      return explicit.trim()
    }
    const lastModel = await KVStore.getValue('chat.lastModel')
    if (lastModel && typeof lastModel === 'string' && lastModel.trim() !== '') {
      return lastModel.trim()
    }
    const models = await this.ollamaService.getModels()
    if (models && models.length > 0) {
      const smallest = models.reduce((prev, cur) => (prev.size < cur.size ? prev : cur))
      return smallest.name
    }
    return 'llama3.2'
  }

  async listAutomations(): Promise<Automation[]> {
    if (!(await this.isN8nInstalled())) return []
    let client: AxiosInstance
    try {
      ;({ client } = await this.getN8nClient())
    } catch (err) {
      logger.warn(
        `[AutomationsService] listAutomations: n8n client unavailable: ${
          err instanceof Error ? err.message : err
        }`
      )
      return []
    }

    try {
      const res = await client.get('/workflows', { params: { tags: N8N_TAG } })
      const workflows: any[] = res.data?.data ?? res.data ?? []
      const mapped = workflows.map((w) => this._mapWorkflow(w))
      await this.ensureDefaultAutomation(mapped).catch((err) => {
        logger.warn(
          `[AutomationsService] ensureDefaultAutomation failed: ${
            err instanceof Error ? err.message : err
          }`
        )
      })
      if (mapped.length === 0) {
        try {
          const res2 = await client.get('/workflows', { params: { tags: N8N_TAG } })
          return (res2.data?.data ?? res2.data ?? []).map((w: any) => this._mapWorkflow(w))
        } catch {
          return mapped
        }
      }
      return mapped
    } catch (err) {
      logger.warn(
        `[AutomationsService] listAutomations failed: ${err instanceof Error ? err.message : err}`
      )
      return []
    }
  }

  async createAutomation(input: CreateAutomationInput): Promise<Automation> {
    const { client } = await this.getN8nClient()
    const model = input.model?.trim() || (await this.resolveDefaultModel())
    const tools = input.tools ?? []
    const targetChatSessionId = input.targetChatSessionId ?? 'new'
    let resolvedSessionId = targetChatSessionId
    let targetChatTitle = input.targetChatTitle ?? null

    if (targetChatSessionId === 'new') {
      const title = input.targetChatTitle || input.name
      const session = await this.chatService.createSession(title, model)
      resolvedSessionId = session.id
      targetChatTitle = title
    }

    const workflow = this._buildWorkflowJson({
      name: input.name,
      prompt: input.prompt,
      scheduleCron: input.scheduleCron,
      model,
      tools,
      targetChatSessionId: resolvedSessionId,
    })

    const res = await client.post('/workflows', workflow)
    const created = res.data
    const workflowId = created.id

    await this._tagWorkflow(client, workflowId, [N8N_TAG])

    if (input.scheduleCron) {
      await client.post(`/workflows/${workflowId}/activate`)
    }

    return this._mapWorkflow(created, { targetChatTitle })
  }

  async updateAutomation(id: string, input: Partial<CreateAutomationInput>): Promise<Automation> {
    const { client } = await this.getN8nClient()
    const existing = await client.get(`/workflows/${id}`)
    const current = existing.data

    const model =
      input.model?.trim() || this._extractModel(current) || (await this.resolveDefaultModel())
    const tools = input.tools ?? this._extractTools(current)
    const prompt = input.prompt ?? this._extractPrompt(current)
    const name = input.name ?? current.name
    const scheduleCron =
      input.scheduleCron !== undefined ? input.scheduleCron : this._extractCron(current)

    let targetChatSessionId = this._extractTargetChat(current)
    let targetChatTitle = input.targetChatTitle ?? null
    if (input.targetChatSessionId === 'new') {
      const title = input.targetChatTitle || name
      const session = await this.chatService.createSession(title, model)
      targetChatSessionId = session.id
      targetChatTitle = title
    } else if (input.targetChatSessionId && input.targetChatSessionId !== 'new') {
      targetChatSessionId = input.targetChatSessionId
    }

    const workflow = this._buildWorkflowJson({
      name,
      prompt,
      scheduleCron,
      model,
      tools,
      targetChatSessionId,
    })

    const res = await client.put(`/workflows/${id}`, { ...workflow, versionId: current.versionId })
    const updated = res.data

    if (scheduleCron) {
      await client.post(`/workflows/${id}/activate`).catch(() => {})
    } else {
      await client.post(`/workflows/${id}/deactivate`).catch(() => {})
    }

    return this._mapWorkflow(updated, { targetChatTitle })
  }

  async deleteAutomation(id: string): Promise<void> {
    const { client } = await this.getN8nClient()
    await client.delete(`/workflows/${id}`)
  }

  async runNow(id: string): Promise<{ executionId: string }> {
    const { client } = await this.getN8nClient()
    const res = await client.post(`/workflows/${id}/execute`, { runData: {} })
    return { executionId: String(res.data?.executionId ?? res.data?.id ?? '') }
  }

  async listRuns(id: string, limit = 20): Promise<AutomationRun[]> {
    const { client } = await this.getN8nClient()
    const res = await client.get('/executions', { params: { workflowId: id, limit } })
    const runs: any[] = res.data?.data ?? res.data ?? []
    return runs.map((r) => ({
      id: String(r.id),
      status: r.status ?? 'unknown',
      startedAt: r.startedAt ?? r.started_at ?? null,
      finishedAt: r.stoppedAt ?? r.stopped_at ?? null,
      mode: r.mode ?? 'manual',
    }))
  }

  async ensureDefaultAutomation(existing?: Automation[]): Promise<void> {
    const current = existing ?? (await this.listAutomations().catch(() => []))
    if (current.some((a) => a.isDefault)) return

    const model = await this.resolveDefaultModel()
    const session = await this.chatService.createSession(DEFAULT_AUTOMATION_NAME, model)
    const workflow = this._buildWorkflowJson({
      name: DEFAULT_AUTOMATION_NAME,
      prompt: DEFAULT_AUTOMATION_PROMPT,
      scheduleCron: DEFAULT_AUTOMATION_CRON,
      model,
      tools: [],
      targetChatSessionId: session.id,
    })

    try {
      const { client } = await this.getN8nClient()
      const res = await client.post('/workflows', workflow)
      const workflowId = res.data.id
      await this._tagWorkflow(client, workflowId, [N8N_TAG, N8N_DEFAULT_TAG])
      await client.post(`/workflows/${workflowId}/activate`)
      logger.info(`[AutomationsService] Seeded default automation "${DEFAULT_AUTOMATION_NAME}"`)
    } catch (err) {
      logger.warn(
        `[AutomationsService] Failed to seed default automation: ${
          err instanceof Error ? err.message : err
        }`
      )
    }
  }

  async deliverToChat(params: {
    sessionId: string
    content: string
    images?: string[] | null
    sources?: Record<string, any>[] | null
    toolSteps?: Record<string, any>[] | null
  }): Promise<{ messageId: string }> {
    const sessionIdNum = Number.parseInt(params.sessionId, 10)
    if (!Number.isFinite(sessionIdNum)) {
      throw new Error(`Invalid session id: ${params.sessionId}`)
    }
    const message = await this.chatService.addMessage(
      sessionIdNum,
      'assistant',
      params.content,
      params.images ?? null,
      params.sources ?? null,
      params.toolSteps ?? null
    )
    transmit.broadcast(BROADCAST_CHANNELS.AUTOMATION_DELIVERED, {
      sessionId: params.sessionId,
      messageId: message.id,
    })
    return { messageId: message.id }
  }

  async runModelChat(params: {
    model?: string
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  }): Promise<{ content: string; model: string }> {
    const model = params.model?.trim() || (await this.resolveDefaultModel())
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPTS.default },
      ...params.messages,
    ]
    const response = await this.ollamaService.chat({ model, messages })
    return {
      content: response.message?.content ?? '',
      model,
    }
  }

  private async _tagWorkflow(
    client: AxiosInstance,
    workflowId: string,
    tags: string[]
  ): Promise<void> {
    try {
      const tagRes = await client.get('/tags', { params: { limit: 100 } })
      const allTags: any[] = tagRes.data?.data ?? tagRes.data ?? []
      const tagIds: string[] = []
      for (const tagName of tags) {
        const found = allTags.find((t) => t.name === tagName)
        if (found) {
          tagIds.push(found.id)
        } else {
          try {
            const created = await client.post('/tags', { name: tagName })
            if (created.data?.id) tagIds.push(created.data.id)
          } catch {}
        }
      }
      if (tagIds.length > 0) {
        await client.put(`/workflows/${workflowId}/tags`, { tagIds })
      }
    } catch (err) {
      logger.warn(
        `[AutomationsService] Failed to tag workflow ${workflowId}: ${
          err instanceof Error ? err.message : err
        }`
      )
    }
  }

  private _buildWorkflowJson(params: {
    name: string
    prompt: string
    scheduleCron: string | null
    model: string
    tools: string[]
    targetChatSessionId: string
  }): any {
    const nodes: any[] = []
    const connections: any = {}

    const triggerId = 'nomad-trigger'
    const agentId = 'nomad-agent'
    const modelId = 'nomad-model'
    const sendId = 'nomad-send'
    const toolNodeIds = params.tools.map((t) => `nomad-tool-${t}`)

    if (params.scheduleCron) {
      nodes.push({
        id: triggerId,
        name: triggerId,
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2,
        position: [0, 0],
        parameters: {
          rule: {
            interval: [{ field: 'cronExpression', expression: params.scheduleCron }],
          },
        },
      })
    } else {
      nodes.push({
        id: triggerId,
        name: triggerId,
        type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1,
        position: [0, 0],
        parameters: {},
      })
    }

    nodes.push({
      id: agentId,
      name: agentId,
      type: '@n8n/n8n-nodes-langchain.agent',
      typeVersion: 1.7,
      position: [220, 0],
      parameters: {
        agent: 'toolsAgent',
        promptType: 'define',
        text: params.prompt,
        options: {
          systemMessage: SYSTEM_PROMPTS.default,
        },
      },
    })

    nodes.push({
      id: modelId,
      name: modelId,
      type: 'CUSTOM.nomadChatModel',
      typeVersion: 1,
      position: [220, 220],
      parameters: {
        model: params.model,
      },
    })

    for (let i = 0; i < params.tools.length; i++) {
      const toolName = params.tools[i]
      const toolId = toolNodeIds[i]
      nodes.push({
        id: toolId,
        name: toolId,
        type: `CUSTOM.nomadTool_${toolName}`,
        typeVersion: 1,
        position: [440, 200 + i * 120],
        parameters: {},
      })
    }

    nodes.push({
      id: sendId,
      name: sendId,
      type: 'CUSTOM.nomadChatSend',
      typeVersion: 1,
      position: [660, 0],
      parameters: {
        sessionId: params.targetChatSessionId,
        content: '={{ $json.output || $json.text || $json.content }}',
      },
    })

    connections[triggerId] = { main: [[{ node: agentId, type: 'main', index: 0 }]] }
    connections[agentId] = { main: [[{ node: sendId, type: 'main', index: 0 }]] }
    connections[modelId] = {
      ai_languageModel: [[{ node: agentId, type: 'ai_languageModel', index: 0 }]],
    }
    for (const tid of toolNodeIds) {
      connections[tid] = {
        ai_tool: [[{ node: agentId, type: 'ai_tool', index: 0 }]],
      }
    }

    return {
      name: params.name,
      nodes,
      connections,
      settings: { executionOrder: 'v1' },
    }
  }

  private _mapWorkflow(w: any, extra?: { targetChatTitle?: string | null }): Automation {
    const tags: string[] = w.tags?.map((t: any) => t.name) ?? []
    const isDefault = tags.includes(N8N_DEFAULT_TAG)
    return {
      id: String(w.id),
      name: w.name ?? '',
      prompt: this._extractPrompt(w),
      scheduleCron: this._extractCron(w),
      model: this._extractModel(w),
      tools: this._extractTools(w),
      targetChatSessionId: this._extractTargetChat(w),
      targetChatTitle: extra?.targetChatTitle ?? null,
      active: Boolean(w.active),
      lastRunAt: w.lastRunAt ?? null,
      nextRunAt: w.nextRunAt ?? null,
      isDefault,
    }
  }

  private _findNode(w: any, typePrefix: string): any | null {
    const nodes: any[] = w.nodes ?? []
    return nodes.find((n) => typeof n.type === 'string' && n.type.includes(typePrefix)) ?? null
  }

  private _extractPrompt(w: any): string {
    const agent = this._findNode(w, 'langchain.agent')
    return agent?.parameters?.text ?? ''
  }

  private _extractCron(w: any): string | null {
    const trigger = w.nodes?.find((n: any) => n.type === 'n8n-nodes-base.scheduleTrigger')
    if (!trigger) return null
    const expr = trigger.parameters?.rule?.interval?.[0]?.expression
    return typeof expr === 'string' ? expr : null
  }

  private _extractModel(w: any): string {
    const modelNode = this._findNode(w, 'CUSTOM.nomadChatModel')
    return modelNode?.parameters?.model ?? ''
  }

  private _extractTools(w: any): string[] {
    const nodes: any[] = w.nodes ?? []
    return nodes
      .filter((n) => typeof n.type === 'string' && n.type.includes('nomadTool_'))
      .map((n) => n.type.replace('CUSTOM.nomadTool_', ''))
  }

  private _extractTargetChat(w: any): string {
    const send = this._findNode(w, 'CUSTOM.nomadChatSend')
    return send?.parameters?.sessionId ?? 'new'
  }
}

export function parseSchedule(natural: string): string | null {
  const input = natural.trim().toLowerCase()
  if (!input) return null

  const cronMatch = input.match(/^cron:\s*(.+)$/)
  if (cronMatch) return cronMatch[1].trim()

  const everyDayAt = input.match(
    /(?:every\s+day|daily|each\s+day)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/
  )
  if (everyDayAt) {
    let hour = Number.parseInt(everyDayAt[1], 10)
    const minute = everyDayAt[2] ? Number.parseInt(everyDayAt[2], 10) : 0
    const ampm = everyDayAt[3]
    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0
    return `${minute} ${hour} * * *`
  }

  const atTime = input.match(/(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?/)
  if (
    atTime &&
    (input.includes('every day') || input.includes('daily') || input.includes('each day'))
  ) {
    let hour = Number.parseInt(atTime[1], 10)
    const minute = Number.parseInt(atTime[2], 10)
    const ampm = atTime[3]
    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0
    return `${minute} ${hour} * * *`
  }

  const weekdayMatch = input.match(
    /(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/
  )
  if (weekdayMatch) {
    const dayMap: Record<string, number> = {
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6,
    }
    const dow = dayMap[weekdayMatch[1]]
    let hour = Number.parseInt(weekdayMatch[2], 10)
    const minute = weekdayMatch[3] ? Number.parseInt(weekdayMatch[3], 10) : 0
    const ampm = weekdayMatch[4]
    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0
    return `${minute} ${hour} * * ${dow}`
  }

  const dateMatch = input.match(
    /(\d{4})-(\d{2})-(\d{2})\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/
  )
  if (dateMatch) {
    const [, year, month, day, hourStr, minuteStr, ampm] = dateMatch
    let hour = Number.parseInt(hourStr, 10)
    const minute = minuteStr ? Number.parseInt(minuteStr, 10) : 0
    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0
    const dt = DateTime.fromObject({
      year: Number.parseInt(year, 10),
      month: Number.parseInt(month, 10),
      day: Number.parseInt(day, 10),
      hour,
      minute,
    })
    if (!dt.isValid) return null
    return `${minute} ${hour} ${day} ${month} *`
  }

  return null
}
