import { DateTime } from 'luxon'
import { BaseModel, column, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import { KV_STORE_SCHEMA, type KVStoreKey, type KVStoreValue } from '../../types/kv_store.js'
import { parseBoolean } from '../utils/misc.js'
import encryption from '@adonisjs/core/services/encryption'
import logger from '@adonisjs/core/services/logger'

const ENCRYPTED_VALUE_PREFIX = 'encv1:'
const SECRET_SETTING_KEYS = new Set<KVStoreKey>([
  'apps.homebox.apiKeyPepper',
  'secrets.huggingFaceToken',
  'registry.giteaPassword',
  'vpn.openvpnPassword',
  'automation.n8nEncryptionKey',
  'automation.n8nApiKey',
])

export function isSecretSettingKey(key: KVStoreKey): boolean {
  return SECRET_SETTING_KEYS.has(key)
}

/**
 * Generic key-value store model for storing various settings
 * that don't necessitate their own dedicated models.
 */
export default class KVStore extends BaseModel {
  static table = 'kv_store'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare key: KVStoreKey

  @column()
  declare value: string | null

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updated_at: DateTime

  /**
   * Get a setting value by key, automatically deserializing to the correct type.
   */
  static async getValue<K extends KVStoreKey>(key: K): Promise<KVStoreValue<K> | null> {
    const setting = await this.findBy('key', key)
    if (!setting || setting.value === undefined || setting.value === null) {
      return null
    }
    const raw = String(setting.value)
    if (isSecretSettingKey(key)) {
      if (raw.startsWith(ENCRYPTED_VALUE_PREFIX)) {
        const decrypted = encryption.decrypt<string>(raw.slice(ENCRYPTED_VALUE_PREFIX.length))
        if (decrypted === null) {
          logger.warn(`[KVStore] Failed to decrypt secret setting: ${key}`)
          return null
        }
        return decrypted as KVStoreValue<K>
      }
      setting.value = `${ENCRYPTED_VALUE_PREFIX}${encryption.encrypt(raw)}`
      await setting.save()
      return raw as KVStoreValue<K>
    }
    return (KV_STORE_SCHEMA[key] === 'boolean' ? parseBoolean(raw) : raw) as KVStoreValue<K>
  }

  /**
   * Set a setting value by key (creates if not exists), automatically serializing to string.
   */
  static async setValue<K extends KVStoreKey>(key: K, value: KVStoreValue<K>): Promise<KVStore> {
    const serialized = String(value)
    const existing = await this.findBy('key', key)
    if (existing) {
      if (isSecretSettingKey(key)) {
        const currentValue = await this.getValue(key)
        if (currentValue === serialized) return existing
        existing.value = `${ENCRYPTED_VALUE_PREFIX}${encryption.encrypt(serialized)}`
      } else {
        if (existing.value === serialized) return existing
        existing.value = serialized
      }
      await existing.save()
      return existing
    }
    const storedValue = isSecretSettingKey(key)
      ? `${ENCRYPTED_VALUE_PREFIX}${encryption.encrypt(serialized)}`
      : serialized
    return this.create({ key, value: storedValue })
  }

  /**
   * Clear a setting value by key, storing null so getValue returns null.
   */
  static async clearValue<K extends KVStoreKey>(key: K): Promise<void> {
    const setting = await this.findBy('key', key)
    if (setting && setting.value !== null) {
      setting.value = null
      await setting.save()
    }
  }
}
