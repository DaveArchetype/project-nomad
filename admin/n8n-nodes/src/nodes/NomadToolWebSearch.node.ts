import {
  NodeConnectionTypes,
  type INodeType,
  type INodeTypeDescription,
  type ISupplyDataFunctions,
  type SupplyData,
} from 'n8n-workflow'
import { NOMAD_ADMIN_BASE_URL, getNomadSecret, nomadPost } from '../nomadConfig'

export class NomadToolWebSearch implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'NOMAD Web Search',
    name: 'nomadTool_web_search',
    icon: 'file:nomad.svg',
    group: ['transform'],
    version: 1,
    description:
      'Search the web for current information. Returns results with titles, URLs, and snippets. Use this for news, facts, or any information that requires up-to-date data.',
    defaults: { name: 'NOMAD Web Search' },
    inputs: [],
    outputs: [NodeConnectionTypes.AiTool],
    outputNames: ['Tool'],
    usableAsTool: true,
    properties: [
      {
        displayName: 'Query',
        name: 'query',
        type: 'string',
        description: 'The search query',
        default: '',
        required: true,
      },
    ],
  }

  async supplyData(this: ISupplyDataFunctions): Promise<SupplyData> {
    const secret = await getNomadSecret.call(this as any)
    const zod = require('zod')
    const { StructuredTool } = require('@langchain/core/tools')

    const schema = zod.object({
      query: zod.string().describe('The search query'),
    })

    const tool = new StructuredTool({
      name: 'web_search',
      description:
        'Search the web for current information. Returns results with titles, URLs, and snippets. Use this for news, facts, or any information that requires up-to-date data.',
      schema,
      func: async (input: any) => {
        const result = await nomadPost(
          `${NOMAD_ADMIN_BASE_URL}/api/automations/tools/web_search/run`,
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
