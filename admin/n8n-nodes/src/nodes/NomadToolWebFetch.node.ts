import type { INodeType, INodeTypeDescription } from 'n8n-workflow'
import { buildDescriptionFromSpec, supplyDataForSpec, type NomadToolSpec } from './nomadToolBase'

const SPEC: NomadToolSpec = {
  toolName: 'web_fetch',
  displayName: 'NOMAD Web Fetch',
  description:
    'Fetch the text content of a specific web page URL. Use this to read a full page when search snippets are not enough.',
  inputSchema: {
    url: { type: 'string', description: 'The full URL of the page to fetch', required: true },
  },
}

export class NomadToolWebFetch implements INodeType {
  description: INodeTypeDescription = buildDescriptionFromSpec(SPEC)
  async supplyData(this: any): Promise<any> {
    return supplyDataForSpec.call(this, SPEC)
  }
}
