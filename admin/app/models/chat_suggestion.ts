import { DateTime } from 'luxon'
import { BaseModel, column, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'

export default class ChatSuggestion extends BaseModel {
  static table = 'chat_suggestions'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true })
  declare id: number

  @column.date()
  declare suggestion_date: DateTime

  @column()
  declare text: string

  @column()
  declare model_used: string | null

  @column.dateTime()
  declare generated_at: DateTime

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updated_at: DateTime
}
