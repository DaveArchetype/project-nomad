import { NomadToolBase } from './nomadToolBase'

export class NomadToolCalculator extends NomadToolBase {
  static spec = {
    toolName: 'calculator',
    displayName: 'NOMAD Calculator',
    description:
      'Evaluate a mathematical expression. Supports +, -, *, /, %, ^, parentheses, and decimals. Use this for any arithmetic or math computation.',
    inputSchema: {
      expression: {
        type: 'string' as const,
        description: 'The mathematical expression to evaluate, e.g. "2 + 3 * 4"',
        required: true,
      },
    },
  }
}
