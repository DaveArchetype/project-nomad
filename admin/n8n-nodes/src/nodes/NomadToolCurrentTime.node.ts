import {
  NodeConnectionTypes,
  type INodeType,
  type INodeTypeDescription,
  type ISupplyDataFunctions,
  type SupplyData,
} from 'n8n-workflow'
import { NOMAD_ADMIN_BASE_URL, getNomadSecret, nomadPost } from '../nomadConfig'

export class NomadToolCurrentTime implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'NOMAD Current Time',
    name: 'nomadTool_current_time',
    icon: 'file:nomad.svg',
    group: ['transform'],
    version: 1,
    description:
      'Get the current date and time. Use this when the user asks about the current time or date.',
    defaults: { name: 'NOMAD Current Time' },
    inputs: [],
    outputs: [NodeConnectionTypes.AiTool],
    outputNames: ['Tool'],
    usableAsTool: true,
    properties: [
      {
        displayName: 'Timezone',
        name: 'timezone',
        type: 'string',
        description: 'Optional timezone, e.g. "Europe/London". Defaults to UTC.',
        default: '',
        required: false,
      },
    ],
  }

  async supplyData(this: ISupplyDataFunctions): Promise<SupplyData> {
    const secret = await getNomadSecret.call(this as any)
    const zod = require('zod')
    const { StructuredTool } = require('@langchain/core/tools')

    const schema = zod.object({
      timezone: zod.string().optional().describe('Optional timezone, e.g. "Europe/London"'),
    })

    const tool = new StructuredTool({
      name: 'current_time',
      description:
        'Get the current date and time. Use this when the user asks about the current time or date.',
      schema,
      func: async (input: any) => {
        const result = await nomadPost(
          `${NOMAD_ADMIN_BASE_URL}/api/automations/tools/current_time/run`,
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
