import {
  NodeConnectionTypes,
  type INodeType,
  type INodeTypeDescription,
  type ISupplyDataFunctions,
  type SupplyData,
} from 'n8n-workflow'
import { DynamicTool } from '@langchain/core/tools'
import { NOMAD_ADMIN_BASE_URL, getNomadSecret, nomadPost } from '../nomadConfig'

export class NomadToolWebFetch implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'NOMAD Web Fetch',
    name: 'nomadTool_web_fetch',
    icon: 'file:nomad.svg',
    group: ['transform'],
    version: 1,
    description:
      'Fetch the text content of a specific web page URL. Use this to read a full page when search snippets are not enough.',
    defaults: { name: 'NOMAD Web Fetch' },
    inputs: [],
    outputs: [NodeConnectionTypes.AiTool],
    outputNames: ['Tool'],
    usableAsTool: true,
    properties: [],
  }

  async supplyData(this: ISupplyDataFunctions): Promise<SupplyData> {
    const secret = await getNomadSecret.call(this as any)

    const tool = new DynamicTool({
      name: 'web_fetch',
      description:
        'Fetches the text content of a web page. Input should be a full URL string like https://example.com/page. Use this to read a full page when search snippets are not enough.',
      func: async (input: string) => {
        try {
          const parsed = JSON.parse(input)
          if (parsed?.url) input = parsed.url
        } catch {}
        const result = await nomadPost(
          `${NOMAD_ADMIN_BASE_URL}/api/automations/tools/web_fetch/run`,
          { input: { url: input } },
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
