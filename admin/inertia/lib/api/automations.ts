import { AxiosInstance } from 'axios'
import { catchInternal } from '../util'

export type Automation = {
  id: string
  name: string
  prompt: string
  scheduleCron: string | null
  model: string
  tools: string[]
  deliverToChat: boolean
  targetChatSessionId: string | 'new' | null
  targetChatTitle: string | null
  active: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  isDefault: boolean
}

export type AutomationRun = {
  id: string
  status: string
  startedAt: string | null
  finishedAt: string | null
  mode: string
}

export type AutomationTool = {
  name: string
  description: string
}

export type AutomationStatus = {
  n8nInstalled: boolean
  enabled: boolean
  n8nApiKeyConfigured: boolean
}

export type CreateAutomationInput = {
  name: string
  prompt: string
  scheduleCron: string | null
  model?: string
  tools?: string[]
  deliverToChat?: boolean
  targetChatSessionId?: string | 'new'
  targetChatTitle?: string
}

export function listAutomations(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ automations: Automation[] }>('/automations')
    return response.data
  })()
}

export function createAutomation(client: AxiosInstance, input: CreateAutomationInput) {
  return catchInternal(async () => {
    const response = await client.post<{ automation: Automation }>('/automations', input)
    return response.data
  })()
}

export function updateAutomation(
  client: AxiosInstance,
  id: string,
  input: Partial<CreateAutomationInput>
) {
  return catchInternal(async () => {
    const response = await client.put<{ automation: Automation }>(`/automations/${id}`, input)
    return response.data
  })()
}

export function deleteAutomation(client: AxiosInstance, id: string) {
  return catchInternal(async () => {
    await client.delete(`/automations/${id}`)
    return true
  })()
}

export function runAutomation(client: AxiosInstance, id: string) {
  return catchInternal(async () => {
    const response = await client.post<{ executionId: string }>(`/automations/${id}/run`)
    return response.data
  })()
}

export function listAutomationRuns(client: AxiosInstance, id: string) {
  return catchInternal(async () => {
    const response = await client.get<{ runs: AutomationRun[] }>(`/automations/${id}/runs`)
    return response.data
  })()
}

export function listAutomationTools(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ tools: AutomationTool[] }>('/automations/tools')
    return response.data
  })()
}

export function getAutomationDefaultModel(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ defaultModel: string }>('/automations/models')
    return response.data
  })()
}

export function listAutomationChats(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ chats: any[] }>('/automations/chats')
    return response.data
  })()
}

export function getAutomationStatus(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<AutomationStatus>('/automations/status')
    return response.data
  })()
}

export function saveN8nApiKey(client: AxiosInstance, apiKey: string) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean }>('/automations/api-key', { apiKey })
    return response.data
  })()
}
