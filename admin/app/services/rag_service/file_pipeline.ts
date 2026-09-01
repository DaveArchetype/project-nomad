import logger from '@adonisjs/core/services/logger'
import { deleteFileIfExists, determineFileType, getFile } from '../../../utils/fs.js'
import type { ProcessAndEmbedFileResponse } from '../../../types/rag.js'
import type { RagCtx } from './types.js'
import { embedAndStoreText } from './embedding.js'
import { processZIMFile } from './zim_processing.js'
import {
  processDocxFile,
  processEPUBFile,
  processImageFile,
  processPDFFile,
  processTextFile,
} from './file_processors.js'

export async function embedTextAndCleanup(
  ctx: RagCtx,
  extractedText: string,
  filepath: string,
  deleteAfterEmbedding: boolean = false,
  onProgress?: (percent: number) => Promise<void>,
  collection?: string
): Promise<{ success: boolean; message: string; chunks?: number }> {
  if (!extractedText || extractedText.trim().length === 0) {
    return {
      success: false,
      message: 'Process completed succesfully, but no text was found to embed.',
    }
  }

  const embedResult = await embedAndStoreText(
    ctx,
    extractedText,
    {
      source: filepath,
      ...(collection ? { collection } : {}),
    },
    onProgress
  )

  if (!embedResult) {
    return { success: false, message: 'Failed to embed and store the extracted text.' }
  }

  if (deleteAfterEmbedding) {
    logger.info(`[RAG] Embedding complete, deleting uploaded file: ${filepath}`)
    await deleteFileIfExists(filepath)
  }

  return {
    success: true,
    message: 'File processed and embedded successfully.',
    chunks: embedResult.chunks,
  }
}

export async function processAndEmbedFile(
  ctx: RagCtx,
  filepath: string,
  deleteAfterEmbedding: boolean = false,
  options: {
    startOffset?: number
    onProgress?: (percent: number) => Promise<void>
    onFlush?: (
      articlesSeen: number,
      chunksEmbedded: number,
      totalArticles: number
    ) => Promise<boolean | void>
    collection?: string
    chunksEstimated?: number
    baseChunks?: number
    repairPaths?: string[]
  } = {}
): Promise<ProcessAndEmbedFileResponse> {
  const { onProgress, collection } = options
  try {
    const fileType = determineFileType(filepath)
    logger.debug(`[RAG] Processing file: ${filepath} (detected type: ${fileType})`)

    if (fileType === 'unknown') {
      return { success: false, message: 'Unsupported file type.' }
    }

    const fileBuffer = fileType !== 'zim' ? await getFile(filepath, 'buffer') : null
    if (fileType !== 'zim' && !fileBuffer) {
      return { success: false, message: 'Failed to read the uploaded file.' }
    }

    if (fileType === 'zim') {
      return await processZIMFile(ctx, filepath, deleteAfterEmbedding, options)
    }

    if (onProgress) await onProgress(10)
    let extractedText: string
    switch (fileType) {
      case 'image':
        extractedText = await processImageFile(fileBuffer!)
        break
      case 'pdf':
        extractedText = await processPDFFile(fileBuffer!)
        break
      case 'docx':
        extractedText = await processDocxFile(fileBuffer!)
        break
      case 'epub':
        extractedText = await processEPUBFile(fileBuffer!)
        break
      case 'text':
      default:
        extractedText = await processTextFile(fileBuffer!)
        break
    }

    if (onProgress) await onProgress(15)
    const scaledProgress = onProgress ? (p: number) => onProgress(15 + p * 0.85) : undefined

    return await embedTextAndCleanup(
      ctx,
      extractedText,
      filepath,
      deleteAfterEmbedding,
      scaledProgress,
      collection
    )
  } catch (error) {
    logger.error('[RAG] Error processing and embedding file:', error)
    return { success: false, message: 'Error processing and embedding file.' }
  }
}
