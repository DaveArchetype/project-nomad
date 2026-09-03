import type { INodeType, INodeTypeDescription } from 'n8n-workflow'
import { buildDescriptionFromSpec, supplyDataForSpec, type NomadToolSpec } from './nomadToolBase'

const SPEC: NomadToolSpec = {
  toolName: 'web_search',
  displayName: 'NOMAD Web Search',
  description:
    'Search the web for current information. Returns results with titles, URLs, and snippets. Use this for news, facts, or any information that requires up-to-date data.',
  inputSchema: {
    query: { type: 'string', description: 'The search query', required: true },
  },
}

export class NomadToolWebSearch implements INodeType {
  description: INodeTypeDescription = buildDescriptionFromSpec(SPEC)
  async supplyData(this: any): Promise<any> {
    return supplyDataForSpec.call(this, SPEC)
  }
}
