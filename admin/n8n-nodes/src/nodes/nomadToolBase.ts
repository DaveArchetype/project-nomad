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
}

export abstract class NomadToolBase implements INodeType {
  static spec: NomadToolSpec
  description: INodeTypeDescription

  constructor() {
    const spec = (this.constructor as any).spec as NomadToolSpec
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
      credentials: [
        {
          name: 'nomadAutomationSecret',
          required: true,
        },
      ],
      properties: [],
    }
  }

  async supplyData(this: ISupplyDataFunctions): Promise<SupplyData> {
    const node = this.getNode()
    const toolName = node.type.replace('CUSTOM.nomadTool_', '')
    const secret = await getNomadSecret.call(this as any)

    let DynamicToolCtor: any
    try {
      const mod = require('@langchain/core/tools')
      DynamicToolCtor = mod.DynamicTool
    } catch {
      throw new Error(
        "NOMAD tool nodes require '@langchain/core' to be available in the n8n container. This is bundled with n8n by default."
      )
    }

    const description = toolName

    const tool = new DynamicToolCtor({
      name: toolName,
      description,
      func: async (input: string) => {
        let parsed: any = input
        try {
          parsed = JSON.parse(input)
        } catch {
          parsed = { input }
        }
        const result = await nomadPost(
          `${NOMAD_ADMIN_BASE_URL}/api/automations/tools/${toolName}/run`,
          { input: parsed },
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
