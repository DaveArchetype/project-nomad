import {
  NodeConnectionTypes,
  type IExecuteFunctions,
  type INodeType,
  type INodeTypeDescription,
  type INodeExecutionData,
} from 'n8n-workflow'
import { NOMAD_ADMIN_BASE_URL, getNomadSecret, nomadPost } from '../nomadConfig'

export class NomadChatSend implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'NOMAD Chat Send',
    name: 'nomadChatSend',
    icon: 'file:nomad.svg',
    group: ['output'],
    version: 1,
    subtitle: '={{$parameter["sessionId"]}}',
    description: 'Deliver an automation run output into a Project NOMAD chat session',
    defaults: { name: 'NOMAD Chat Send' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    properties: [
      {
        displayName: 'Chat Session ID',
        name: 'sessionId',
        type: 'string',
        default: '',
        description: 'The NOMAD chat session id to deliver the message into',
        required: true,
      },
      {
        displayName: 'Content',
        name: 'content',
        type: 'string',
        default: '',
        typeOptions: { rows: 6 },
        description: 'The message content to deliver (accepts expressions)',
        required: true,
      },
    ],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData()
    const secret = await getNomadSecret.call(this)
    const returnData: INodeExecutionData[] = []

    for (let i = 0; i < items.length; i++) {
      const sessionId = this.getNodeParameter('sessionId', i) as string
      const content = this.getNodeParameter('content', i) as string

      const result = await nomadPost(
        `${NOMAD_ADMIN_BASE_URL}/api/automations/deliver`,
        { sessionId, content },
        secret
      )

      returnData.push({
        json: { sessionId, messageId: result?.messageId, delivered: true },
        pairedItem: { item: i },
      })
    }

    return [returnData]
  }
}
