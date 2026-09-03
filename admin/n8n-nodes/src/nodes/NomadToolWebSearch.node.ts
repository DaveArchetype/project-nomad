import {
  NodeConnectionTypes,
  type INodeType,
  type INodeTypeDescription,
  type ISupplyDataFunctions,
  type SupplyData,
} from 'n8n-workflow'
import { DynamicTool } from '@langchain/core/tools'
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
    properties: [],
  }

  async supplyData(this: ISupplyDataFunctions): Promise<SupplyData> {
    const secret = await getNomadSecret.call(this as any)

    const tool = new DynamicTool({
      name: 'web_search',
      description:
        'Searches the web for current information. Input should be a search query string. Returns results with titles, URLs, and snippets. Use this for news, facts, or any information that requires up-to-date data.',
      func: async (input: string) => {
        try {
          const parsed = JSON.parse(input)
          if (parsed?.query) input = parsed.query
        } catch {}
        const result = await nomadPost(
          `${NOMAD_ADMIN_BASE_URL}/api/automations/tools/web_search/run`,
          { input: { query: input } },
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
