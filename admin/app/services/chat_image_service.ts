import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'

/**
 * Persists chat image attachments to disk, organized by day with datetime-stamped
 * filenames. Images are written under `storage/chat_images/YYYY-MM-DD/` and the DB
 * stores the relative path (`chat_images/YYYY-MM-DD/...`) so sessions can re-render
 * attachments across reloads via the serving endpoint.
 *
 * Path traversal is guarded in resolveAbsolutePath: only paths that resolve inside
 * the chat_images root are accepted.
 */
export class ChatImageService {
  static STORAGE_REL = 'storage/chat_images'

  private get rootAbs(): string {
    return app.makePath(ChatImageService.STORAGE_REL)
  }

  /**
   * Decode a base64 data URL and write it to disk. Returns the relative path
   * (e.g. `chat_images/2026-08-24/20260824153012-a1b2c3.jpg`) for DB storage.
   * Returns null if the input is not a valid image data URL.
   */
  async saveImage(dataUrl: string): Promise<string | null> {
    const parsed = this._parseDataUrl(dataUrl)
    if (!parsed) return null

    const now = new Date()
    const dayDir = now.toISOString().slice(0, 10) // YYYY-MM-DD
    const stamp = this._timestamp(now)
    const rand = randomBytes(3).toString('hex')
    const filename = `${stamp}-${rand}.${parsed.ext}`
    const absDir = join(this.rootAbs, dayDir)
    await mkdir(absDir, { recursive: true })
    const absPath = join(absDir, filename)
    await writeFile(absPath, parsed.buffer)
    return `${dayDir}/${filename}`
  }

  /**
   * Resolve a stored relative path to an absolute filesystem path, rejecting
   * traversal attempts. Returns null if the path is outside the chat_images root.
   */
  resolveAbsolutePath(relPath: string): string | null {
    const cleaned = relPath.startsWith('chat_images/')
      ? relPath.slice('chat_images/'.length)
      : relPath
    const root = resolve(this.rootAbs)
    const abs = resolve(join(this.rootAbs, cleaned))
    if (!abs.startsWith(root + sep)) return null
    return abs
  }

  private _parseDataUrl(dataUrl: string): { buffer: Buffer; ext: string } | null {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
    if (!match) return null
    const mime = match[1]
    const base64 = match[2]
    if (!base64) return null
    let ext: string
    switch (mime) {
      case 'image/jpeg':
      case 'image/jpg':
        ext = 'jpg'
        break
      case 'image/png':
        ext = 'png'
        break
      case 'image/webp':
        ext = 'webp'
        break
      case 'image/gif':
        ext = 'gif'
        break
      default:
        logger.warn(`[ChatImageService] Unsupported image mime: ${mime}`)
        return null
    }
    try {
      const buffer = Buffer.from(base64, 'base64')
      if (buffer.length === 0) return null
      return { buffer, ext }
    } catch {
      return null
    }
  }

  private _timestamp(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    return (
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
      `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    )
  }
}
