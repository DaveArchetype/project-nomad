import { join, relative, sep } from 'node:path'
import { access } from 'node:fs/promises'
import logger from '@adonisjs/core/services/logger'
import { BOOKS_STORAGE_PATH } from '../utils/fs.js'

export type CalibreBookInfo = {
  bookId: number
  title: string
  authorSort: string
  format: string
}

export type CalibreBookSummary = {
  title: string
  authorSort: string
  path: string
}

const METADATA_DB_FILENAME = 'metadata.db'

function resolveMetadataDbPath(): string {
  return join(process.cwd(), BOOKS_STORAGE_PATH, METADATA_DB_FILENAME)
}

async function metadataDbExists(): Promise<boolean> {
  try {
    await access(resolveMetadataDbPath())
    return true
  } catch {
    return false
  }
}

async function openCalibreDb(): Promise<any | null> {
  const exists = await metadataDbExists()
  if (!exists) return null
  try {
    const mod = await import('better-sqlite3')
    const Database = mod.default
    const db = new Database(resolveMetadataDbPath(), { readonly: true, fileMustExist: true })
    db.pragma('journal_mode = WAL')
    return db
  } catch (error) {
    logger.warn(
      `[CalibreService] Failed to open metadata.db: ${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }
}

function extractCalibreRelativePath(absPath: string): string | null {
  const booksAbsPath = join(process.cwd(), BOOKS_STORAGE_PATH)
  const rel = relative(booksAbsPath, absPath)
  if (rel.startsWith('..') || rel === '') return null
  const parts = rel.split(sep)
  if (parts.length < 2) return null
  return `${parts[0]}/${parts[1]}/`
}

export class CalibreService {
  async lookupByFilePath(absPath: string): Promise<CalibreBookInfo | null> {
    const calibrePath = extractCalibreRelativePath(absPath)
    if (!calibrePath) return null

    const ext = absPath.split('.').at(-1)?.toLowerCase() ?? ''
    if (!ext) return null

    const db = await openCalibreDb()
    if (!db) return null

    try {
      const row = db
        .prepare(
          `SELECT b.id AS bookId, b.title AS title, b.author_sort AS authorSort, d.format AS format
           FROM books b
           JOIN data d ON d.book = b.id
           WHERE b.path = ? AND LOWER(d.format) = ?
           LIMIT 1`
        )
        .get(calibrePath, ext.toUpperCase()) as
        | { bookId: number; title: string; authorSort: string; format: string }
        | undefined

      if (!row) return null
      return {
        bookId: row.bookId,
        title: row.title,
        authorSort: row.authorSort,
        format: row.format.toLowerCase(),
      }
    } catch (error) {
      logger.warn(
        `[CalibreService] lookupByFilePath query failed: ${error instanceof Error ? error.message : String(error)}`
      )
      return null
    } finally {
      try {
        db.close()
      } catch {}
    }
  }

  async lookupById(bookId: number): Promise<CalibreBookSummary | null> {
    const db = await openCalibreDb()
    if (!db) return null

    try {
      const row = db
        .prepare(`SELECT title, author_sort AS authorSort, path FROM books WHERE id = ? LIMIT 1`)
        .get(bookId) as { title: string; authorSort: string; path: string } | undefined

      if (!row) return null
      return { title: row.title, authorSort: row.authorSort, path: row.path }
    } catch (error) {
      logger.warn(
        `[CalibreService] lookupById query failed: ${error instanceof Error ? error.message : String(error)}`
      )
      return null
    } finally {
      try {
        db.close()
      } catch {}
    }
  }
}

export default CalibreService
