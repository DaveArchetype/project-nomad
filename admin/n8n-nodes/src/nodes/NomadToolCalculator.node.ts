import type { INodeType, INodeTypeDescription } from 'n8n-workflow'
import { buildDescriptionFromSpec, supplyDataForSpec, type NomadToolSpec } from './nomadToolBase'

const SPEC: NomadToolSpec = {
  toolName: 'calculator',
  displayName: 'NOMAD Calculator',
  description:
    'Evaluate a mathematical expression. Supports +, -, *, /, %, ^, parentheses, and decimals. Use this for any arithmetic or math computation.',
  inputSchema: {
    expression: {
      type: 'string',
      description: 'The mathematical expression to evaluate, e.g. "2 + 3 * 4"',
      required: true,
    },
  },
}

export class NomadToolCalculator implements INodeType {
  description: INodeTypeDescription = buildDescriptionFromSpec(SPEC)
  async supplyData(this: any): Promise<any> {
    return supplyDataForSpec.call(this, SPEC)
  }
}
