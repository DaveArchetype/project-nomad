import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'chat_messages'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // JSON array of agent tool-step records (tool name, step type, input/output) backing an
      // assistant message produced by the agent loop. Persisted so tool-call indicators survive
      // session reloads. Nullable for backwards compat and for non-agent turns.
      table.json('tool_steps').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('tool_steps')
    })
  }
}
