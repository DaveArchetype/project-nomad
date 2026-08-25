import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ambient_recordings'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.text('transcript').notNullable()
      table.timestamp('started_at').notNullable()
      table.timestamp('ended_at').notNullable()
      table.integer('duration_ms').unsigned().notNullable()
      table.boolean('is_wake_word').notNullable().defaultTo(false)
      // Point id used for the corresponding vector in the `nomad_ambient_recall`
      // Qdrant collection. Nullable — embedding can fail independently of the
      // transcript being worth keeping around.
      table.string('qdrant_point_id', 64).nullable()
      // Denormalized local calendar date (YYYY-MM-DD) the segment falls on, so
      // DailyRecapService can select a day's rows with a plain equality filter
      // instead of a timezone-aware range query.
      table.date('recap_date').notNullable()
      table.timestamp('created_at').notNullable()

      table.index(['recap_date'])
      table.index(['is_wake_word'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
