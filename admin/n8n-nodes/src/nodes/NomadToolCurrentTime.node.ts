import { NomadToolBase } from './nomadToolBase'

export class NomadToolCurrentTime extends NomadToolBase {
  static spec = {
    toolName: 'current_time',
    displayName: 'NOMAD Current Time',
    description:
      'Get the current date and time. Use this when the user asks about the current time or date.',
    inputSchema: {
      timezone: {
        type: 'string' as const,
        description: 'Optional timezone, e.g. "Europe/London". Defaults to UTC.',
        required: false,
      },
    },
  }
}
