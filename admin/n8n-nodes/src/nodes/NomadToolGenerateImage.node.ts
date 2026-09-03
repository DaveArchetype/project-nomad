import {
  NodeConnectionTypes,
  type INodeType,
  type INodeTypeDescription,
  type ISupplyDataFunctions,
  type SupplyData,
} from 'n8n-workflow'
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
    properties: [
      {
        displayName: 'Prompt',
        name: 'prompt',
        type: 'string',
        description: 'The text description of the image to generate',
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
      prompt: zod.string().describe('The text description of the image to generate'),
    })

    const tool = new StructuredTool({
      name: 'generate_image',
      description:
        'Generate an image from a text prompt via Project NOMAD Image Studio. Use this when the user asks to create, draw, or generate an image.',
      schema,
      func: async (input: any) => {
        const result = await nomadPost(
          `${NOMAD_ADMIN_BASE_URL}/api/automations/tools/generate_image/run`,
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
