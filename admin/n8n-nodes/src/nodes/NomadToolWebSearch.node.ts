import { NomadToolBase } from './nomadToolBase'

export class NomadToolWebSearch extends NomadToolBase {
  static spec = {
    toolName: 'web_search',
    displayName: 'NOMAD Web Search',
    description:
      'Search the web for current information. Returns results with titles, URLs, and snippets. Use this for news, facts, or any information that requires up-to-date data.',
    inputSchema: {
      query: { type: 'string' as const, description: 'The search query', required: true },
    },
  }
}
