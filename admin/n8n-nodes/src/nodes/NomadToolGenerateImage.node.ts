import {
  NodeConnectionTypes,
  type INodeType,
  type INodeTypeDescription,
  type ISupplyDataFunctions,
  type SupplyData,
} from 'n8n-workflow'
import { DynamicTool } from '@langchain/core/tools'
import { NOMAD_ADMIN_BASE_URL, getNomadSecret, nomadPost } from '../nomadConfig'

export class NomadToolGenerateImage implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'NOMAD Generate Image',
    name: 'nomadTool_generate_image',
    icon: 'file:nomad.svg',
    group: ['transform'],
    version: 1,
    description:
      'Generate an image from a text prompt via Project NOMAD Image Studio. Use this when the user asks to create, draw, or generate an image.',
    defaults: { name: 'NOMAD Generate Image' },
    inputs: [],
    outputs: [NodeConnectionTypes.AiTool],
    outputNames: ['Tool'],
    usableAsTool: true,
    properties: [],
  }

  async supplyData(this: ISupplyDataFunctions): Promise<SupplyData> {
    const secret = await getNomadSecret.call(this as any)

    const tool = new DynamicTool({
      name: 'generate_image',
      description:
        'Generates an image from a text description via Project NOMAD Image Studio. Input should be a text description of the image to generate. Use this when the user asks to create, draw, or generate an image.',
      func: async (input: string) => {
        try {
          const parsed = JSON.parse(input)
          if (parsed?.prompt) input = parsed.prompt
        } catch {}
        const result = await nomadPost(
          `${NOMAD_ADMIN_BASE_URL}/api/automations/tools/generate_image/run`,
          { input: { prompt: input } },
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
