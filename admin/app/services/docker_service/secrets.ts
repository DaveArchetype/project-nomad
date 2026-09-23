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

export async function resolveCometProxyPassword(): Promise<string> {
  const existing = await KVStore.getValue('secrets.cometProxyPassword')
  if (typeof existing === 'string' && existing.length >= 16) {
    return existing
  }
  let password = randomBytes(24).toString('base64url')
  for (let attempt = 0; attempt < 25; attempt++) {
    const encoded = Buffer.from(JSON.stringify({ debridStreamProxyPassword: password })).toString(
      'base64'
    )
    if (!encoded.includes('+') && !encoded.includes('/')) break
    password = randomBytes(24).toString('base64url')
  }
  await KVStore.setValue('secrets.cometProxyPassword', password)
  logger.info('[DockerService] Generated and persisted Comet debrid stream proxy password')
  return password
}

export async function buildCometAddonConfig(): Promise<string | null> {
  const storedApiKey = await KVStore.getValue('secrets.debridApiKey')
  const apiKey = storedApiKey?.trim()
  if (!apiKey) return null
  const password = await resolveCometProxyPassword()
  const encoded = Buffer.from(JSON.stringify({ debridStreamProxyPassword: password })).toString(
    'base64'
  )
  return !encoded.includes('+') && !encoded.includes('/') ? encoded : null
}

export async function buildCometDirectAddonConfig(): Promise<string | null> {
  const storedApiKey = await KVStore.getValue('secrets.debridApiKey')
  const apiKey = storedApiKey?.trim()
  if (!apiKey) return null
  const storedProvider = await KVStore.getValue('secrets.debridProvider')
  const provider = storedProvider?.trim() || 'realdebrid'
  const shapes = [
    { debridServices: [{ service: provider, apiKey }] },
    { debridService: provider, debridApiKey: apiKey },
  ]
  for (const shape of shapes) {
    const encoded = Buffer.from(JSON.stringify(shape)).toString('base64')
    if (!encoded.includes('/')) return encoded
  }
  return null
}
