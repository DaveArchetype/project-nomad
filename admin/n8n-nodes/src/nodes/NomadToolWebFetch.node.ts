import { NomadToolBase } from './nomadToolBase';

export class NomadToolWebFetch extends NomadToolBase {
  static spec = {
    toolName: 'web_fetch',
    displayName: 'NOMAD Web Fetch',
    description: 'Fetch the text content of a specific web page URL.',
  };
}
