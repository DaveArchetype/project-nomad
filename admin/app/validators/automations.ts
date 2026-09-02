import vine from '@vinejs/vine'

export const createAutomationSchema = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(200),
    prompt: vine.string().trim().minLength(1),
    scheduleCron: vine.string().trim().maxLength(120).nullable().optional(),
    model: vine.string().trim().optional(),
    tools: vine.array(vine.string().trim()).optional(),
    targetChatSessionId: vine.string().trim().optional(),
    targetChatTitle: vine.string().trim().maxLength(200).optional(),
  })
)

export const updateAutomationSchema = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(200).optional(),
    prompt: vine.string().trim().minLength(1).optional(),
    scheduleCron: vine.string().trim().maxLength(120).nullable().optional(),
    model: vine.string().trim().optional(),
    tools: vine.array(vine.string().trim()).optional(),
    targetChatSessionId: vine.string().trim().optional(),
    targetChatTitle: vine.string().trim().maxLength(200).optional(),
  })
)

export const deliverAutomationSchema = vine.compile(
  vine.object({
    sessionId: vine.string().trim().minLength(1),
    content: vine.string().minLength(1),
    images: vine.array(vine.string()).optional(),
    sources: vine.array(vine.any()).optional(),
    toolSteps: vine.array(vine.any()).optional(),
  })
)

export const runToolSchema = vine.compile(
  vine.object({
    input: vine.any().optional(),
  })
)

export const modelChatSchema = vine.compile(
  vine.object({
    model: vine.string().trim().optional(),
    messages: vine.array(
      vine.object({
        role: vine.enum(['system', 'user', 'assistant'] as const),
        content: vine.string(),
      })
    ),
  })
)

export const saveN8nApiKeySchema = vine.compile(
  vine.object({
    apiKey: vine.string().trim().minLength(1).maxLength(500),
  })
)
