import type { ICredentialType, INodeProperties } from 'n8n-workflow'

export class NomadAutomationSecret implements ICredentialType {
  name = 'nomadAutomationSecret'
  displayName = 'NOMAD Automation Secret'
  documentationUrl = 'https://github.com/DaveArchetype/project-nomad'
  properties: INodeProperties[] = [
    {
      displayName: 'Secret',
      name: 'secret',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description:
        'The n8n API key configured in NOMAD Automations settings. Used to authenticate calls back to the NOMAD admin API.',
      required: true,
    },
  ]
}
