import {
  NodeConnectionTypes,
  type IExecuteFunctions,
  type INodeType,
  type INodeTypeDescription,
  type INodeExecutionData,
} from 'n8n-workflow'
import { NOMAD_ADMIN_BASE_URL, getNomadSecret, nomadPost } from '../nomadConfig'

export class NomadSaveSuggestions implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'NOMAD Save Suggestions',
    name: 'nomadSaveSuggestions',
    icon: 'file:nomad.svg',
    group: ['transform'],
    version: 1,
    description:
      'Saves the incoming text as daily chat suggestions in NOMAD. Parses newline or comma-separated lists.',
    defaults: { name: 'NOMAD Save Suggestions' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: 'nomadAutomationSecret',
        required: false,
      },
    ],
    properties: [
      {
        displayName: 'Content',
        name: 'content',
        type: 'string',
        default: '={{ $json.output || $json.text || $json.content }}',
        typeOptions: { rows: 6 },
        description: 'The suggestions text to store (newline or comma separated)',
        required: true,
      },
    ],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData()
    const secret = await getNomadSecret.call(this)
    const returnData: INodeExecutionData[] = []

    for (let i = 0; i < items.length; i++) {
      const content = this.getNodeParameter('content', i) as string
      const result = await nomadPost(
        `${NOMAD_ADMIN_BASE_URL}/api/automations/suggestions`,
        { content },
        secret
      )
      returnData.push({ json: { success: true, saved: result?.saved ?? 0 } })
    }

    return [returnData]
  }
}
