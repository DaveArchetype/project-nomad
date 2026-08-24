import vine from '@vinejs/vine'

export const createSessionSchema = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(200),
    model: vine.string().trim().optional(),
  })
)

export const updateSessionSchema = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(200).optional(),
    model: vine.string().trim().optional(),
  })
)

export const addMessageSchema = vine.compile(
  vine.object({
    role: vine.enum(['system', 'user', 'assistant'] as const),
    content: vine.string().trim().minLength(1),
    // Relative paths (chat_images/YYYY-MM-DD/...) for image attachments on user messages.
    images: vine.array(vine.string()).optional(),
    // RAG source objects backing an assistant message's answer, persisted so Sources
    // chips survive session reloads.
    sources: vine.array(vine.any()).optional(),
  })
)
