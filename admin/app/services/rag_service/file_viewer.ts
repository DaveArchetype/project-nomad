import logger from '@adonisjs/core/services/logger'
import { getFileStatsIfExists } from '../../../utils/fs.js'
import { resolveUploadPath } from './utils.js'

const VIEWABLE_TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'md',
  'txt',
  'csv',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'html',
])

export async function readFileContent(
  source: string
): Promise<{ content: string; extension: string; fileName: string } | null> {
  const resolved = resolveUploadPath(source)
  if (!resolved) return null

  const extension = resolved.split('.').at(-1)?.toLowerCase() ?? ''
  if (!VIEWABLE_TEXT_EXTENSIONS.has(extension)) return null

  const stats = await getFileStatsIfExists(resolved)
  if (!stats) return null

  try {
    const { readFile } = await import('node:fs/promises')
    const content = await readFile(resolved, 'utf-8')
    const fileName = resolved.split(/[/\\]/).at(-1) ?? resolved
    return { content, extension, fileName }
  } catch (error) {
    logger.warn({ err: error, source }, '[RagService.readFileContent] read failed')
    return null
  }
}

export async function resolveDownloadPath(source: string): Promise<string | null> {
  const resolved = resolveUploadPath(source)
  if (!resolved) return null
  const stats = await getFileStatsIfExists(resolved)
  return stats ? resolved : null
}
