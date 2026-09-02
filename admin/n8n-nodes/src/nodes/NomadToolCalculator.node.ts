import { NomadToolBase } from './nomadToolBase';

export class NomadToolCalculator extends NomadToolBase {
  static spec = {
    toolName: 'calculator',
    displayName: 'NOMAD Calculator',
    description:
      'Evaluate a mathematical expression. Supports +, -, *, /, %, ^, parentheses, and decimals.',
  };
}
