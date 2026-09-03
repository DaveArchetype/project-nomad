import { NomadToolBase } from './nomadToolBase'

export class NomadToolWebFetch extends NomadToolBase {
  static spec = {
    toolName: 'web_fetch',
    displayName: 'NOMAD Web Fetch',
    description:
      'Fetch the text content of a specific web page URL. Use this to read a full page when search snippets are not enough.',
    inputSchema: {
      url: {
        type: 'string' as const,
        description: 'The full URL of the page to fetch',
        required: true,
      },
    },
  }
}
