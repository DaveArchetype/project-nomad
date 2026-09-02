import { randomBytes } from 'node:crypto'
import KVStore from '#models/kv_store'
import logger from '@adonisjs/core/services/logger'

export async function resolveHomeboxPepper(): Promise<string> {
  const existing = await KVStore.getValue('apps.homebox.apiKeyPepper')
  if (typeof existing === 'string' && existing.length >= 32) {
    return existing
  }
  const pepper = randomBytes(48).toString('base64')
  await KVStore.setValue('apps.homebox.apiKeyPepper', pepper)
  logger.info('[DockerService] Generated and persisted Homebox API key pepper')
  return pepper
}

export async function resolveN8nEncryptionKey(): Promise<string> {
  const existing = await KVStore.getValue('automation.n8nEncryptionKey')
  if (typeof existing === 'string' && existing.length >= 32) {
    return existing
  }
  const key = randomBytes(48).toString('base64')
  await KVStore.setValue('automation.n8nEncryptionKey', key)
  logger.info('[DockerService] Generated and persisted n8n encryption key')
  return key
}
