import {
  NodeConnectionTypes,
  type INodeType,
  type INodeTypeDescription,
  type ISupplyDataFunctions,
  type SupplyData,
} from 'n8n-workflow'
import { NOMAD_ADMIN_BASE_URL, getNomadSecret, nomadPost } from '../nomadConfig'

export type NomadToolSpec = {
  toolName: string
  displayName: string
  description: string
  inputSchema: Record<string, { type: 'string' | 'number'; description: string; required: boolean }>
}

export abstract class NomadToolBase implements INodeType {
  static spec: NomadToolSpec
  description: INodeTypeDescription

  constructor() {
    const spec = (this.constructor as any).spec as NomadToolSpec
    const schemaFields = Object.entries(spec.inputSchema || {})
    const properties: any[] = schemaFields.map(([key, field]) => ({
      displayName: key.charAt(0).toUpperCase() + key.slice(1),
      name: key,
      type: field.type === 'number' ? 'number' : 'string',
      description: field.description,
      typeOptions: { password: false },
      default: '',
      required: field.required,
    }))

    this.description = {
      displayName: spec.displayName,
      name: `nomadTool_${spec.toolName}`,
      icon: 'file:nomad.svg',
      group: ['transform'],
      version: 1,
      description: spec.description,
      defaults: { name: spec.displayName },
      inputs: [],
      outputs: [NodeConnectionTypes.AiTool],
      outputNames: ['Tool'],
      usableAsTool: true,
      properties,
    }
  }

  async supplyData(this: ISupplyDataFunctions): Promise<SupplyData> {
    const node = this.getNode()
    const toolName = node.type.replace('CUSTOM.nomadTool_', '')
    const secret = await getNomadSecret.call(this as any)
    const spec = (this.constructor as any).spec as NomadToolSpec | undefined

    let zod: any
    try {
      zod = require('zod')
    } catch {
      throw new Error("NOMAD tool nodes require 'zod' to be available in the n8n container.")
    }

    let StructuredToolCtor: any
    try {
      const mod = require('@langchain/core/tools')
      StructuredToolCtor = mod.StructuredTool
    } catch {
      throw new Error(
        "NOMAD tool nodes require '@langchain/core' to be available in the n8n container."
      )
    }

    const schemaFields = spec?.inputSchema ?? {}
    const zodShape: Record<string, any> = {}
    for (const [key, field] of Object.entries(schemaFields)) {
      let zodType: any
      if (field.type === 'number') {
        zodType = zod.number().describe(field.description)
      } else {
        zodType = zod.string().describe(field.description)
      }
      if (!field.required) {
        zodType = zodType.optional()
      }
      zodShape[key] = zodType
    }
    const schema = zod.object(zodShape)

    const description = spec?.description ?? toolName

    const tool = new StructuredToolCtor({
      name: toolName,
      description,
      schema,
      func: async (input: any) => {
        const result = await nomadPost(
          `${NOMAD_ADMIN_BASE_URL}/api/automations/tools/${toolName}/run`,
          { input },
          secret
        )
        return typeof result?.result === 'string'
          ? result.result
          : JSON.stringify(result?.result ?? result)
      },
    })

    return { response: tool }
  }
}
