import type { INodeType, INodeTypeDescription } from 'n8n-workflow'
import { buildDescriptionFromSpec, supplyDataForSpec, type NomadToolSpec } from './nomadToolBase'

const SPEC: NomadToolSpec = {
  toolName: 'current_time',
  displayName: 'NOMAD Current Time',
  description:
    'Get the current date and time. Use this when the user asks about the current time or date.',
  inputSchema: {
    timezone: {
      type: 'string',
      description: 'Optional timezone, e.g. "Europe/London". Defaults to UTC.',
      required: false,
    },
  },
}

export class NomadToolCurrentTime implements INodeType {
  description: INodeTypeDescription = buildDescriptionFromSpec(SPEC)
  async supplyData(this: any): Promise<any> {
    return supplyDataForSpec.call(this, SPEC)
  }
}
