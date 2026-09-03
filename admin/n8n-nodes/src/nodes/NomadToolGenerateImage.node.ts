import type { INodeType, INodeTypeDescription } from 'n8n-workflow'
import { buildDescriptionFromSpec, supplyDataForSpec, type NomadToolSpec } from './nomadToolBase'

const SPEC: NomadToolSpec = {
  toolName: 'generate_image',
  displayName: 'NOMAD Generate Image',
  description:
    'Generate an image from a text prompt via Project NOMAD Image Studio. Use this when the user asks to create, draw, or generate an image.',
  inputSchema: {
    prompt: {
      type: 'string',
      description: 'The text description of the image to generate',
      required: true,
    },
  },
}

export class NomadToolGenerateImage implements INodeType {
  description: INodeTypeDescription = buildDescriptionFromSpec(SPEC)
  async supplyData(this: any): Promise<any> {
    return supplyDataForSpec.call(this, SPEC)
  }
}
