import {
  NodeConnectionTypes,
  type INodeType,
  type INodeTypeDescription,
  type ISupplyDataFunctions,
  type SupplyData,
} from 'n8n-workflow'

const NOMAD_OLLAMA_BASE_URL = process.env.NOMAD_OLLAMA_BASE_URL || 'http://nomad_ollama:11434/v1'

export class NomadChatModel implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'NOMAD Chat Model',
    name: 'nomadChatModel',
    icon: 'file:nomad.svg',
    group: ['transform'],
    version: 1,
    description:
      'Runs chat completions against the Project NOMAD Ollama service. The model name is set by NOMAD when building the workflow (defaults to the currently selected chat model).',
    defaults: { name: 'NOMAD Chat Model' },
    inputs: [],
    outputs: [NodeConnectionTypes.AiLanguageModel],
    outputNames: ['Model'],
    usableAsTool: true,
    properties: [
      {
        displayName: 'Model',
        name: 'model',
        type: 'string',
        default: '',
        description: 'Ollama model name. Set by NOMAD when building the workflow.',
        required: true,
      },
      {
        displayName: 'Temperature',
        name: 'temperature',
        type: 'number',
        default: 0.7,
        typeOptions: { minValue: 0, maxValue: 2, numberStepSize: 0.1 },
      },
    ],
  }

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const model = this.getNodeParameter('model', itemIndex) as string
    const temperature = this.getNodeParameter('temperature', itemIndex) as number

    let ChatOpenAICtor: any
    try {
      const mod = require('@langchain/openai')
      ChatOpenAICtor = mod.ChatOpenAI
    } catch {
      throw new Error(
        "NOMAD Chat Model requires '@langchain/openai' to be available in the n8n container. This is bundled with n8n by default."
      )
    }

    const chatModel = new ChatOpenAICtor({
      modelName: model,
      temperature,
      openAIApiKey: 'ollama',
      configuration: { baseURL: NOMAD_OLLAMA_BASE_URL },
    })

    return {
      response: chatModel,
    }
  }
}
