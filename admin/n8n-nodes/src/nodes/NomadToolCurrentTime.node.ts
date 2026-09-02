import { NomadToolBase } from './nomadToolBase';

export class NomadToolCurrentTime extends NomadToolBase {
  static spec = {
    toolName: 'current_time',
    displayName: 'NOMAD Current Time',
    description: 'Get the current date and time.',
  };
}
