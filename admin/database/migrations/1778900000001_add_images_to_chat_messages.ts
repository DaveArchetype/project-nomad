import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'chat_messages'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // JSON array of relative paths (chat_images/YYYY-MM-DD/...) for image attachments
      // on user messages sent to vision-capable models. Nullable for backwards compat.
      table.json('images').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('images')
    })
  }
}
