import vine from '@vinejs/vine'

export const synthesizeSchema = vine.compile(
  vine.object({
    text: vine.string().trim().minLength(1).maxLength(5000),
    voice: vine.string().trim().optional(),
    speed: vine.number().min(0.5).max(2.0).optional(),
    engine: vine.string().in(['piper', 'xtts']).optional(),
    language: vine.string().trim().optional(),
  })
)

export const recapDateParamSchema = vine.compile(
  vine.object({
    date: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
)
