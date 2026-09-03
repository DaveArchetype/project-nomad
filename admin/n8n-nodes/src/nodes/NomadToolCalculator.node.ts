import {
  NodeConnectionTypes,
  type INodeType,
  type INodeTypeDescription,
  type ISupplyDataFunctions,
  type SupplyData,
} from 'n8n-workflow'
import { NOMAD_ADMIN_BASE_URL, getNomadSecret, nomadPost } from '../nomadConfig'

export class NomadToolCalculator implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'NOMAD Calculator',
    name: 'nomadTool_calculator',
    icon: 'file:nomad.svg',
    group: ['transform'],
    version: 1,
    description:
      'Evaluate a mathematical expression. Supports +, -, *, /, %, ^, parentheses, and decimals. Use this for any arithmetic or math computation.',
    defaults: { name: 'NOMAD Calculator' },
    inputs: [],
    outputs: [NodeConnectionTypes.AiTool],
    outputNames: ['Tool'],
    usableAsTool: true,
    properties: [
      {
        displayName: 'Expression',
        name: 'expression',
        type: 'string',
        description: 'The mathematical expression to evaluate, e.g. "2 + 3 * 4"',
        default: '',
        required: true,
      },
    ],
  }

  async supplyData(this: ISupplyDataFunctions): Promise<SupplyData> {
    const secret = await getNomadSecret.call(this as any)
    const zod = require('zod')
    const { StructuredTool } = require('@langchain/core/tools')

    const schema = zod.object({
      expression: zod.string().describe('The mathematical expression to evaluate'),
    })

    const tool = new StructuredTool({
      name: 'calculator',
      description:
        'Evaluate a mathematical expression. Supports +, -, *, /, %, ^, parentheses, and decimals. Use this for any arithmetic or math computation.',
      schema,
      func: async (input: any) => {
        const result = await nomadPost(
          `${NOMAD_ADMIN_BASE_URL}/api/automations/tools/calculator/run`,
          { input },
          secret
        )
        return typeof result?.result === 'string'
          ? result.result
          : JSON.stringify(result?.result ?? result)
      },
    })

    return { response: tool }
  }
}
