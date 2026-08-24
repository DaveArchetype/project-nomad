import vine from '@vinejs/vine'

export const chatSchema = vine.compile(
  vine.object({
    model: vine.string().trim().minLength(1),
    messages: vine.array(
      vine.object({
        role: vine.enum(['system', 'user', 'assistant'] as const),
        content: vine.string(),
        // Base64 data URLs for image attachments on user messages (vision models only).
        // The controller converts these to OpenAI multimodal content parts and persists
        // them to disk before forwarding to OllamaService.
        images: vine.array(vine.string()).optional(),
      })
    ),
    stream: vine.boolean().optional(),
    sessionId: vine.number().positive().optional(),
    // Effective per-request thinking preference (per-model override or global default),
    // resolved client-side. Omitted -> server falls back to the ai.autoThinking KV default.
    think: vine.boolean().optional(),
  })
)

export const unloadChatModelsSchema = vine.compile(
  vine.object({
    targetModel: vine.string().trim().minLength(1).nullable().optional(),
    vramAware: vine.boolean().optional(),
  })
)

export const getAvailableModelsSchema = vine.compile(
  vine.object({
    sort: vine.enum(['pulls', 'name'] as const).optional(),
    recommendedOnly: vine.boolean().optional(),
    query: vine.string().trim().optional(),
    limit: vine.number().positive().optional(),
    force: vine.boolean().optional(),
  })
)
