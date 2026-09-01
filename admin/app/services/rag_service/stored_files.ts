import { join, resolve, sep } from 'node:path'
import logger from '@adonisjs/core/services/logger'
import KbIngestState from '#models/kb_ingest_state'
import { getFileStatsIfExists } from '../../utils/fs.js'
import type { KbIngestStateValue } from '../../../types/kb_ingest_state.js'
import type { StoredFileInfo } from '../../../types/rag.js'
import {
  CONTENT_COLLECTION_NAME,
  EMBEDDING_DIMENSION,
  FACET_SOURCE_LIMIT,
  UPLOADS_STORAGE_PATH,
} from './constants.js'
import type { RagCtx } from './types.js'

export async function hasDocuments(ctx: RagCtx): Promise<boolean> {
  try {
    await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)
    const collectionInfo = await ctx.getQdrant().getCollection(CONTENT_COLLECTION_NAME)
    return (collectionInfo.points_count ?? 0) > 0
  } catch {
    return false
  }
}

export async function getStoredFiles(ctx: RagCtx): Promise<StoredFileInfo[]> {
  try {
    await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)

    const qdrant = ctx.getQdrant()
    const sources = new Set<string>()
    const facetResult = await qdrant.facet(CONTENT_COLLECTION_NAME, {
      key: 'source',
      limit: FACET_SOURCE_LIMIT,
      exact: true,
    })
    for (const hit of facetResult.hits) {
      if (typeof hit.value === 'string') sources.add(hit.value)
    }

    const stateByPath = new Map<
      string,
      { state: KbIngestStateValue; chunks_embedded: number; collection: string | null }
    >()
    try {
      const stateRows = await KbIngestState.query().select(
        'file_path',
        'state',
        'chunks_embedded',
        'collection'
      )
      for (const row of stateRows) {
        sources.add(row.file_path)
        stateByPath.set(row.file_path, {
          state: row.state,
          chunks_embedded: row.chunks_embedded,
          collection: row.collection,
        })
      }
    } catch (error) {
      logger.warn(
        { err: error },
        '[RagService.getStoredFiles] state-machine union skipped; returning Qdrant-only list'
      )
    }

    const uploadsAbsPath = resolve(join(process.cwd(), UPLOADS_STORAGE_PATH))
    return await Promise.all(
      Array.from(sources).map(async (source) => {
        const row = stateByPath.get(source)
        const fileName = source.split(/[/\\]/).at(-1) ?? source
        const isUserUpload = resolve(source).startsWith(uploadsAbsPath + sep)
        const stats = await getFileStatsIfExists(source)
        return {
          source,
          state: row?.state ?? null,
          chunksEmbedded: row?.chunks_embedded ?? 0,
          fileName,
          size: stats?.size ?? null,
          uploadedAt: stats?.modifiedTime.toISOString() ?? null,
          isUserUpload,
          collection: row?.collection ?? null,
        }
      })
    )
  } catch (error) {
    logger.error('Error retrieving stored files:', error)
    return []
  }
}

export async function getKnowledgeCollections(ctx: RagCtx): Promise<string[]> {
  await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)
  const facetResult = await ctx.getQdrant().facet(CONTENT_COLLECTION_NAME, {
    key: 'collection',
    limit: FACET_SOURCE_LIMIT,
    exact: true,
  })
  const collections = new Set<string>()
  for (const hit of facetResult.hits) {
    if (typeof hit.value === 'string') collections.add(hit.value)
  }
  return Array.from(collections).sort()
}

export async function updateFileCollection(
  ctx: RagCtx,
  source: string,
  collection: string | null
): Promise<{ success: boolean; message: string }> {
  try {
    await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)

    await ctx.getQdrant().setPayload(CONTENT_COLLECTION_NAME, {
      payload: { collection },
      filter: { must: [{ key: 'source', match: { value: source } }] },
    })

    const row = await KbIngestState.getOrCreate(source)
    row.collection = collection
    await row.save()

    return {
      success: true,
      message: collection ? `Moved to "${collection}".` : 'Moved to Uncategorized.',
    }
  } catch (error) {
    logger.error('[RAG] Error updating file collection:', error)
    return { success: false, message: 'Error updating file collection.' }
  }
}

export async function renameKnowledgeCollection(
  ctx: RagCtx,
  oldName: string,
  newName: string
): Promise<{ success: boolean; message: string }> {
  try {
    if (!oldName || !newName || oldName === newName) {
      return { success: false, message: 'Invalid collection names.' }
    }
    await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)

    await ctx.getQdrant().setPayload(CONTENT_COLLECTION_NAME, {
      payload: { collection: newName },
      filter: { must: [{ key: 'collection', match: { value: oldName } }] },
    })

    await KbIngestState.query().where('collection', oldName).update({ collection: newName })

    return { success: true, message: `Renamed "${oldName}" to "${newName}".` }
  } catch (error) {
    logger.error('[RAG] Error renaming knowledge collection:', error)
    return { success: false, message: 'Error renaming collection.' }
  }
}

export async function deleteKnowledgeCollection(
  ctx: RagCtx,
  name: string
): Promise<{ success: boolean; message: string }> {
  try {
    if (!name) {
      return { success: false, message: 'Invalid collection name.' }
    }
    await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)

    await ctx.getQdrant().setPayload(CONTENT_COLLECTION_NAME, {
      payload: { collection: null },
      filter: { must: [{ key: 'collection', match: { value: name } }] },
    })

    await KbIngestState.query().where('collection', name).update({ collection: null })

    return { success: true, message: `"${name}" removed. Files moved to Uncategorized.` }
  } catch (error) {
    logger.error('[RAG] Error deleting knowledge collection:', error)
    return { success: false, message: 'Error deleting collection.' }
  }
}
