import {
  NodeConnectionTypes,
  type INodeType,
  type INodeTypeDescription,
  type ISupplyDataFunctions,
  type SupplyData,
} from 'n8n-workflow'
import { z } from 'zod'
import { DynamicStructuredTool } from '@langchain/core/tools'
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
    properties: [
      {
        displayName: 'URL',
        name: 'url',
        type: 'string',
        description: 'The full URL of the page to fetch',
        default: '',
        required: true,
      },
    ],
  }

  async supplyData(this: ISupplyDataFunctions): Promise<SupplyData> {
    const secret = await getNomadSecret.call(this as any)

    const schema = z.object({
      url: z.string().describe('The full URL of the page to fetch'),
    })

    const tool = new DynamicStructuredTool({
      name: 'web_fetch',
      description:
        'Fetch the text content of a specific web page URL. Use this to read a full page when search snippets are not enough.',
      schema,
      func: async (input: any) => {
        const result = await nomadPost(
          `${NOMAD_ADMIN_BASE_URL}/api/automations/tools/web_fetch/run`,
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
