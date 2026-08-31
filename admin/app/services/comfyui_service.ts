import { inject } from '@adonisjs/core'
import axios from 'axios'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { DockerService } from './docker_service.js'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import {
  COMFYUI_CHAT_WORKFLOW_OVERRIDE_REL,
  COMFYUI_DEFAULT_CHAT_WORKFLOW,
  COMFYUI_DEFAULT_HEIGHT,
  COMFYUI_DEFAULT_NEGATIVE_PROMPT,
  COMFYUI_DEFAULT_STEPS,
  COMFYUI_DEFAULT_WIDTH,
  COMFYUI_GENERATION_TIMEOUT_MS,
  COMFYUI_NODE_IDS,
  COMFYUI_POLL_INTERVAL_MS,
  COMFYUI_SERVICE_PORT,
} from '../../constants/comfyui.js'
import Service from '#models/service'

const REQUEST_TIMEOUT_MS = 15_000
const VIEW_TIMEOUT_MS = 30_000
const OBJECT_INFO_TIMEOUT_MS = 10_000

export type ComfyuiGenerateParams = {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  steps?: number
  seed?: number
  checkpoint?: string
  signal?: AbortSignal
}

export type ComfyuiGenerateResult = {
  buffer: Buffer
  mimeType: string
  filename: string
  checkpoint: string
}

@inject()
export class ComfyuiService {
  constructor(private dockerService: DockerService) {}

  async isAvailable(): Promise<boolean> {
    const url = await this._resolveUrl()
    return url !== null
  }

  async listCheckpoints(opts?: { signal?: AbortSignal }): Promise<string[]> {
    const baseUrl = await this._resolveUrl()
    if (!baseUrl) {
      throw new Error('Image Studio is not installed or running.')
    }
    const response = await axios.get(`${baseUrl}/object_info/CheckpointLoaderSimple`, {
      timeout: OBJECT_INFO_TIMEOUT_MS,
      signal: opts?.signal,
    })
    const names = response.data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]
    return Array.isArray(names) ? names.filter((n: any) => typeof n === 'string') : []
  }

  async generate(params: ComfyuiGenerateParams): Promise<ComfyuiGenerateResult> {
    const baseUrl = await this._resolveUrl()
    if (!baseUrl) {
      throw new Error('Image Studio is not installed or running.')
    }

    const checkpoints = await this.listCheckpoints({ signal: params.signal })
    if (checkpoints.length === 0) {
      throw new Error(
        'No image models (checkpoints) are installed in Image Studio. Open Image Studio from the home page and download a checkpoint with ComfyUI Manager (for example an SDXL model), or place a .safetensors file in the comfyui/models/checkpoints storage folder, then try again.'
      )
    }
    const checkpoint =
      params.checkpoint && checkpoints.includes(params.checkpoint)
        ? params.checkpoint
        : checkpoints[0]

    const workflow = await this._buildWorkflow({ ...params, checkpoint })

    let promptId: string | undefined
    try {
      const response = await axios.post(
        `${baseUrl}/prompt`,
        { prompt: workflow, client_id: randomUUID() },
        { timeout: REQUEST_TIMEOUT_MS, signal: params.signal }
      )
      promptId = response.data?.prompt_id
    } catch (error: any) {
      if (params.signal?.aborted || error?.name === 'AbortError') throw error
      const validationError = this._formatValidationError(error)
      throw new Error(
        validationError ??
          `Image generation request failed: ${error?.response?.status ? `ComfyUI responded with ${error.response.status}. ` : ''}${error instanceof Error ? error.message : 'unknown error'}`
      )
    }
    if (!promptId) {
      throw new Error('ComfyUI did not accept the generation request.')
    }

    const outputs = await this._waitForOutputs(baseUrl, promptId, params.signal)
    const image = this._firstOutputImage(outputs)

    const viewResponse = await axios.get(`${baseUrl}/view`, {
      params: {
        filename: image.filename,
        subfolder: image.subfolder ?? '',
        type: image.type ?? 'output',
      },
      responseType: 'arraybuffer',
      timeout: VIEW_TIMEOUT_MS,
      signal: params.signal,
    })
    const contentType = String(viewResponse.headers?.['content-type'] ?? 'image/png')
    if (!contentType.startsWith('image/')) {
      throw new Error('Unexpected response from the ComfyUI image endpoint.')
    }

    return {
      buffer: Buffer.from(viewResponse.data),
      mimeType: contentType,
      filename: image.filename,
      checkpoint,
    }
  }

  private _firstOutputImage(outputs: Record<string, any>): {
    filename: string
    subfolder?: string
    type?: string
  } {
    for (const nodeOutput of Object.values<any>(outputs)) {
      if (Array.isArray(nodeOutput?.images)) {
        for (const img of nodeOutput.images) {
          if (img?.filename) {
            return { filename: img.filename, subfolder: img.subfolder, type: img.type }
          }
        }
      }
    }
    throw new Error('Image generation finished but produced no image.')
  }

  private async _waitForOutputs(
    baseUrl: string,
    promptId: string,
    signal?: AbortSignal
  ): Promise<Record<string, any>> {
    const deadline = Date.now() + COMFYUI_GENERATION_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (signal?.aborted) {
        throw new Error('Image generation aborted.')
      }
      let entry: any = null
      try {
        const response = await axios.get(`${baseUrl}/history/${promptId}`, {
          timeout: OBJECT_INFO_TIMEOUT_MS,
          signal,
        })
        entry = response.data?.[promptId]
      } catch (error: any) {
        if (signal?.aborted || error?.name === 'AbortError') {
          throw new Error('Image generation aborted.')
        }
        await new Promise((resolve) => setTimeout(resolve, COMFYUI_POLL_INTERVAL_MS))
        continue
      }
      if (entry) {
        const status = entry.status
        if (status?.status_str === 'error') {
          throw new Error(`Image generation failed: ${this._extractExecutionError(status)}`)
        }
        if (entry.outputs && Object.keys(entry.outputs).length > 0) {
          return entry.outputs
        }
      }
      await new Promise((resolve) => setTimeout(resolve, COMFYUI_POLL_INTERVAL_MS))
    }
    throw new Error(
      `Image generation timed out after ${Math.round(COMFYUI_GENERATION_TIMEOUT_MS / 1000)} seconds.`
    )
  }

  private _extractExecutionError(status: any): string {
    const messages = Array.isArray(status?.messages) ? status.messages : []
    for (const message of messages) {
      if (Array.isArray(message) && message[0] === 'execution_error' && message[1]) {
        const detail = message[1]
        const nodeType = detail.node_type ? ` (node: ${detail.node_type})` : ''
        return `${detail.exception_message ?? 'execution error'}${nodeType}`
      }
    }
    return 'execution error'
  }

  private _formatValidationError(error: any): string | null {
    const data = error?.response?.data
    if (!data || typeof data !== 'object') return null
    if (data.node_errors && typeof data.node_errors === 'object') {
      const parts: string[] = []
      for (const [nodeId, nodeError] of Object.entries<any>(data.node_errors)) {
        for (const e of nodeError?.errors ?? []) {
          parts.push(`node ${nodeId}: ${e?.message ?? e?.details ?? 'invalid input'}`)
        }
      }
      if (parts.length > 0) return `ComfyUI rejected the workflow — ${parts.join('; ')}`
    }
    if (typeof data.error === 'string') {
      return `ComfyUI rejected the workflow — ${data.error}`
    }
    return null
  }

  private async _buildWorkflow(
    params: ComfyuiGenerateParams & { checkpoint: string }
  ): Promise<Record<string, any>> {
    let workflow: Record<string, any>
    try {
      const raw = await readFile(app.makePath(COMFYUI_CHAT_WORKFLOW_OVERRIDE_REL), 'utf-8')
      workflow = JSON.parse(raw)
      if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
        throw new Error('not an object')
      }
    } catch {
      workflow = JSON.parse(JSON.stringify(COMFYUI_DEFAULT_CHAT_WORKFLOW))
    }

    const checkpointNode = workflow[COMFYUI_NODE_IDS.checkpoint]
    const positiveNode = workflow[COMFYUI_NODE_IDS.positive]
    if (!checkpointNode?.inputs || !positiveNode?.inputs) {
      throw new Error(
        `The chat workflow is missing required nodes "${COMFYUI_NODE_IDS.checkpoint}" (CheckpointLoaderSimple) or "${COMFYUI_NODE_IDS.positive}" (CLIPTextEncode). If storage/comfyui/chat_workflow_api.json exists, fix or delete it.`
      )
    }
    checkpointNode.inputs.ckpt_name = params.checkpoint
    positiveNode.inputs.text = params.prompt

    const negativeNode = workflow[COMFYUI_NODE_IDS.negative]
    if (negativeNode?.inputs) {
      negativeNode.inputs.text = params.negativePrompt ?? COMFYUI_DEFAULT_NEGATIVE_PROMPT
    }

    const latentNode = workflow[COMFYUI_NODE_IDS.latent]
    if (latentNode?.inputs) {
      if ('width' in latentNode.inputs)
        latentNode.inputs.width = params.width ?? COMFYUI_DEFAULT_WIDTH
      if ('height' in latentNode.inputs) {
        latentNode.inputs.height = params.height ?? COMFYUI_DEFAULT_HEIGHT
      }
      if ('batch_size' in latentNode.inputs) latentNode.inputs.batch_size = 1
    }

    const samplerNode = workflow[COMFYUI_NODE_IDS.sampler]
    if (samplerNode?.inputs) {
      if ('seed' in samplerNode.inputs) {
        samplerNode.inputs.seed = params.seed ?? Math.floor(Math.random() * 1_000_000_000)
      }
      if ('steps' in samplerNode.inputs) {
        samplerNode.inputs.steps = params.steps ?? COMFYUI_DEFAULT_STEPS
      }
    }

    const saveNode = workflow[COMFYUI_NODE_IDS.save]
    if (saveNode?.inputs && 'filename_prefix' in saveNode.inputs) {
      saveNode.inputs.filename_prefix = 'nomad_chat'
    }

    return workflow
  }

  private async _resolveUrl(): Promise<string | null> {
    const service = await Service.query()
      .where('service_name', SERVICE_NAMES.COMFYUI)
      .andWhere('installed', true)
      .first()
    if (!service) return null

    const hostname = process.env.NODE_ENV === 'production' ? SERVICE_NAMES.COMFYUI : 'localhost'

    let internalPort: string | null = COMFYUI_SERVICE_PORT
    try {
      const raw = service.container_config
      const parsedConfig = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw as string)) : null
      if (parsedConfig) {
        const exposedPorts = parsedConfig.ExposedPorts || {}
        internalPort = Object.keys(exposedPorts)[0]?.replace('/tcp', '') ?? null
        if (!internalPort) {
          const portBindings = parsedConfig.HostConfig?.PortBindings
          if (portBindings) {
            internalPort = Object.keys(portBindings)[0]?.replace('/tcp', '') ?? null
          }
        }
      }
    } catch {}

    if (!internalPort) {
      return await this.dockerService.getServiceURL(SERVICE_NAMES.COMFYUI)
    }

    const hostPort =
      service.ui_location && Number.parseInt(service.ui_location, 10)
        ? service.ui_location
        : internalPort

    const port = hostname === 'localhost' ? hostPort : internalPort
    logger.debug(`[ComfyuiService] Resolved URL: http://${hostname}:${port}`)
    return `http://${hostname}:${port}`
  }
}
