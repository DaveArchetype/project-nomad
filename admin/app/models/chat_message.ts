import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ChatSession from './chat_session.js'

export default class ChatMessage extends BaseModel {
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare session_id: number

  @column()
  declare role: 'system' | 'user' | 'assistant'

  @column()
  declare content: string

  // JSON array of relative paths (chat_images/YYYY-MM-DD/...) for image attachments on
  // user messages sent to vision-capable models. SQLite stores JSON as text, so use
  // consume/prepare to (de)serialize. Null for text-only messages.
  @column({
    consume: (value: any) =>
      value === null || value === undefined
        ? null
        : typeof value === 'string'
          ? (JSON.parse(value) as string[])
          : value,
    prepare: (value: string[] | null) => (value === null ? null : JSON.stringify(value)),
  })
  declare images: string[] | null

  // JSON array of RAG source objects backing an assistant message's answer. Persisted so
  // Sources chips survive session reloads. SQLite stores JSON as text, so use consume/prepare.
  @column({
    consume: (value: any) =>
      value === null || value === undefined
        ? null
        : typeof value === 'string'
          ? (JSON.parse(value) as Record<string, any>[])
          : value,
    prepare: (value: Record<string, any>[] | null) =>
      value === null ? null : JSON.stringify(value),
  })
  declare sources: Record<string, any>[] | null

  // JSON array of agent tool-step records (tool name, step type, input/output) backing an
  // assistant message produced by the agent loop. Persisted so tool-call indicators survive
  // session reloads. SQLite stores JSON as text, so use consume/prepare.
  @column({
    consume: (value: any) =>
      value === null || value === undefined
        ? null
        : typeof value === 'string'
          ? (JSON.parse(value) as Record<string, any>[])
          : value,
    prepare: (value: Record<string, any>[] | null) =>
      value === null ? null : JSON.stringify(value),
  })
  declare tool_steps: Record<string, any>[] | null

  @belongsTo(() => ChatSession, { foreignKey: 'session_id', localKey: 'id' })
  declare session: BelongsTo<typeof ChatSession>

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updated_at: DateTime
}
