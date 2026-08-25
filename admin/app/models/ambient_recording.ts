import { DateTime } from 'luxon'
import { BaseModel, column, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'

/**
 * A single transcribed ambient-listening utterance. Raw audio is never
 * persisted — only the transcript, its time bounds, whether it followed the
 * configured wake word, and the id of the corresponding Qdrant vector (see
 * `RagService`'s sibling collection `nomad_ambient_recall` used by
 * `AmbientRecallService`).
 */
export default class AmbientRecording extends BaseModel {
  static table = 'ambient_recordings'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare transcript: string

  @column.dateTime()
  declare started_at: DateTime

  @column.dateTime()
  declare ended_at: DateTime

  @column()
  declare duration_ms: number

  @column()
  declare is_wake_word: boolean

  @column()
  declare qdrant_point_id: string | null

  @column.date()
  declare recap_date: DateTime

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime
}
