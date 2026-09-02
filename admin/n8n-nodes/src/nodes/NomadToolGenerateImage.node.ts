import { NomadToolBase } from './nomadToolBase';

export class NomadToolGenerateImage extends NomadToolBase {
  static spec = {
    toolName: 'generate_image',
    displayName: 'NOMAD Generate Image',
    description: 'Generate an image from a text prompt via Project NOMAD Image Studio.',
  };
}
