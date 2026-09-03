import {
  NodeConnectionTypes,
  type INodeType,
  type INodeTypeDescription,
  type ISupplyDataFunctions,
  type SupplyData,
} from 'n8n-workflow'
import { DynamicTool } from '@langchain/core/tools'
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
    properties: [],
  }

  async supplyData(this: ISupplyDataFunctions): Promise<SupplyData> {
    const secret = await getNomadSecret.call(this as any)

    const tool = new DynamicTool({
      name: 'calculator',
      description:
        'Evaluates a mathematical expression. Input should be a math expression string like "2 + 3 * 4" or "sqrt(16) + 5". Supports +, -, *, /, %, ^, parentheses, and decimals.',
      func: async (input: string) => {
        try {
          const parsed = JSON.parse(input)
          if (parsed?.expression) input = parsed.expression
        } catch {}
        const result = await nomadPost(
          `${NOMAD_ADMIN_BASE_URL}/api/automations/tools/calculator/run`,
          { input: { expression: input } },
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
