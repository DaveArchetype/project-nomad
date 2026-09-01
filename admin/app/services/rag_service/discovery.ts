import { join } from 'node:path'
import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'
import {
  determineFileType,
  getFileStatsIfExists,
  listDirectoryContentsRecursive,
  ZIM_STORAGE_PATH,
} from '../../utils/fs.js'
import type { FileEntry } from '../../../types/files.js'
import { UPLOADS_STORAGE_PATH } from './constants.js'

export async function discoverNomadDocs(
  force?: boolean
): Promise<{ success: boolean; message: string }> {
  try {
    const README_PATH = join(process.cwd(), 'README.md')
    const DOCS_DIR = join(process.cwd(), 'docs')

    const alreadyEmbeddedRaw = await KVStore.getValue('rag.docsEmbedded')
    if (alreadyEmbeddedRaw && !force) {
      logger.info('[RAG] Nomad docs have already been discovered and queued. Skipping.')
      return {
        success: true,
        message: 'Nomad docs have already been discovered and queued. Skipping.',
      }
    }

    const filesToEmbed: Array<{ path: string; source: string }> = []

    const readmeExists = await getFileStatsIfExists(README_PATH)
    if (readmeExists) {
      filesToEmbed.push({ path: README_PATH, source: 'README.md' })
    }

    const dirContents = await listDirectoryContentsRecursive(DOCS_DIR)
    for (const entry of dirContents) {
      if (entry.type === 'file') {
        filesToEmbed.push({ path: entry.key, source: join('docs', entry.name) })
      }
    }

    logger.info(`[RAG] Discovered ${filesToEmbed.length} Nomad doc files to embed`)

    const { EmbedFileJob } = await import('#jobs/embed_file_job')

    for (const fileInfo of filesToEmbed) {
      try {
        logger.info(`[RAG] Dispatching embed job for: ${fileInfo.source}`)
        await EmbedFileJob.dispatch({
          filePath: fileInfo.path,
          fileName: fileInfo.source,
        })
        logger.info(`[RAG] Successfully dispatched job for ${fileInfo.source}`)
      } catch (fileError) {
        logger.error(`[RAG] Error dispatching job for file ${fileInfo.source}:`, fileError)
      }
    }

    await KVStore.setValue('rag.docsEmbedded', true)

    return {
      success: true,
      message: `Nomad docs discovery completed. Dispatched ${filesToEmbed.length} embedding jobs.`,
    }
  } catch (error) {
    logger.error('Error discovering Nomad docs:', error)
    return { success: false, message: 'Error discovering Nomad docs.' }
  }
}

export async function discoverKbFiles(): Promise<string[]> {
  const KB_UPLOADS_PATH = join(process.cwd(), UPLOADS_STORAGE_PATH)
  const ZIM_PATH = join(process.cwd(), ZIM_STORAGE_PATH)
  const filesInStorage: string[] = []

  for (const [label, dirPath] of [
    [UPLOADS_STORAGE_PATH, KB_UPLOADS_PATH] as const,
    [ZIM_STORAGE_PATH, ZIM_PATH] as const,
  ]) {
    try {
      const contents = await listDirectoryContentsRecursive(dirPath)
      contents.forEach((entry: FileEntry) => {
        if (entry.type === 'file') filesInStorage.push(entry.key)
      })
      logger.debug(`[RAG] Found ${contents.length} files in ${label}`)
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.debug(`[RAG] ${label} directory does not exist, skipping`)
      } else {
        throw error
      }
    }
  }

  return filesInStorage.filter((f) => determineFileType(f) !== 'unknown')
}

export async function dispatchEmbedJobsFor(
  filePaths: string[],
  options?: { force?: boolean }
): Promise<{ queuedCount: number; dedupedCount: number; failedPaths: string[] }> {
  const { EmbedFileJob } = await import('#jobs/embed_file_job')
  let queuedCount = 0
  let dedupedCount = 0
  const failedPaths: string[] = []
  for (const filePath of filePaths) {
    try {
      const fileName = filePath.split(/[/\\]/).pop() || filePath
      const stats = await getFileStatsIfExists(filePath)
      const result = await EmbedFileJob.dispatch(
        {
          filePath,
          fileName,
          fileSize: stats?.size,
        },
        { force: options?.force }
      )
      if (result.created) {
        queuedCount++
      } else {
        dedupedCount++
      }
    } catch (fileError) {
      failedPaths.push(filePath)
      logger.error(`[RAG] Error dispatching job for file ${filePath}:`, fileError)
    }
  }
  return { queuedCount, dedupedCount, failedPaths }
}

export async function hasInflightEmbedJobs(): Promise<boolean> {
  const { EmbedFileJob } = await import('#jobs/embed_file_job')
  const { QueueService } = await import('#services/queue_service')
  const queue = QueueService.getInstance().getQueue(EmbedFileJob.queue)
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'paused')
  return (
    (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0) + (counts.paused || 0) > 0
  )
}
