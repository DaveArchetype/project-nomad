import {
  NodeConnectionTypes,
  type INodeType,
  type INodeTypeDescription,
  type ISupplyDataFunctions,
  type SupplyData,
} from 'n8n-workflow'
import { DynamicTool } from '@langchain/core/tools'
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
    properties: [],
  }

  async supplyData(this: ISupplyDataFunctions): Promise<SupplyData> {
    const secret = await getNomadSecret.call(this as any)

    const tool = new DynamicTool({
      name: 'current_time',
      description:
        'Gets the current date and time. Input can be a timezone string like "Europe/London" or empty for UTC. Use this when the user asks about the current time or date.',
      func: async (input: string) => {
        try {
          const parsed = JSON.parse(input)
          if (parsed?.timezone) input = parsed.timezone
        } catch {}
        const result = await nomadPost(
          `${NOMAD_ADMIN_BASE_URL}/api/automations/tools/current_time/run`,
          { input: { timezone: input || undefined } },
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
