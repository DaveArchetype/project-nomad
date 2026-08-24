import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'chat_messages'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // JSON array of RAG source objects backing an assistant message's answer.
      // Persisted so Sources chips survive session reloads. Nullable for backwards compat
      // and for user messages / non-RAG turns.
      table.json('sources').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('sources')
    })
  }
}
