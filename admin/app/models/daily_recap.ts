import { DateTime } from 'luxon'
import { BaseModel, column, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'

/**
 * A nightly LLM-generated summary of a day's `ambient_recordings`, produced by
 * `DailyRecapService` / `DailyRecapJob`. Chat's RAG augmentation reads these
 * back in for temporal queries ("what happened yesterday?").
 */
export default class DailyRecap extends BaseModel {
  static table = 'daily_recaps'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true })
  declare id: number

  @column.date()
  declare recap_date: DateTime

  @column()
  declare summary: string

  @column()
  declare source_recording_count: number

  @column()
  declare model_used: string | null

  @column.dateTime()
  declare generated_at: DateTime

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updated_at: DateTime
}
