import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'chat_suggestions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.date('suggestion_date').notNullable()
      table.text('text').notNullable()
      table.string('model_used', 255).nullable()
      table.timestamp('generated_at').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.index(['suggestion_date'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
