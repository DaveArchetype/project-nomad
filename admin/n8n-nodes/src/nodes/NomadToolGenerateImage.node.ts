import { NomadToolBase } from './nomadToolBase'

export class NomadToolGenerateImage extends NomadToolBase {
  static spec = {
    toolName: 'generate_image',
    displayName: 'NOMAD Generate Image',
    description:
      'Generate an image from a text prompt via Project NOMAD Image Studio. Use this when the user asks to create, draw, or generate an image.',
    inputSchema: {
      prompt: {
        type: 'string' as const,
        description: 'The text description of the image to generate',
        required: true,
      },
    },
  }
}
