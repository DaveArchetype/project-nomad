import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'daily_recaps'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.date('recap_date').notNullable().unique()
      table.text('summary').notNullable()
      table.integer('source_recording_count').unsigned().notNullable().defaultTo(0)
      table.string('model_used', 255).nullable()
      table.timestamp('generated_at').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
