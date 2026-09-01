import { QdrantClient } from '@qdrant/js-client-rest'
import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'
import { loadIngestSettings } from '../../utils/ingest_settings.js'
import { CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION } from './constants.js'
import type { QdrantHealth, RagCtx } from './types.js'

export async function ensureCollection(
  ctx: RagCtx,
  collectionName: string,
  dimensions: number = EMBEDDING_DIMENSION
): Promise<void> {
  try {
    await ctx.ensureDependencies()

    if (ctx.ensuredCollections.has(collectionName)) {
      return
    }

    const qdrant = ctx.getQdrant()
    const collections = await qdrant.getCollections()
    const collectionExists = collections.collections.some((col) => col.name === collectionName)

    if (!collectionExists) {
      await qdrant.createCollection(collectionName, {
        vectors: {
          size: dimensions,
          distance: 'Cosine',
        },
      })
    }

    await qdrant.createPayloadIndex(collectionName, {
      field_name: 'source',
      field_schema: 'keyword',
    })
    await qdrant.createPayloadIndex(collectionName, {
      field_name: 'content_type',
      field_schema: 'keyword',
    })
    await qdrant.createPayloadIndex(collectionName, {
      field_name: 'collection',
      field_schema: 'keyword',
    })

    if (!ctx.indexingThresholdApplied.has(collectionName)) {
      try {
        const ingestSettings = await loadIngestSettings()
        if (ingestSettings.qdrantIndexingThreshold != null) {
          await qdrant.updateCollection(collectionName, {
            optimizers_config: {
              indexing_threshold: ingestSettings.qdrantIndexingThreshold,
            },
          })
          logger.info(
            `[RAG] Applied Qdrant indexing_threshold=${ingestSettings.qdrantIndexingThreshold} to collection ${collectionName}`
          )
        }
        ctx.indexingThresholdApplied.add(collectionName)
      } catch (threshErr) {
        logger.warn(
          `[RAG] Failed to apply Qdrant indexing_threshold to ${collectionName}: %s`,
          threshErr instanceof Error ? threshErr.message : String(threshErr)
        )
      }
    }

    ctx.ensuredCollections.add(collectionName)
  } catch (error) {
    logger.error('Error ensuring Qdrant collection:', error)
    throw error
  }
}

export async function checkQdrantHealth(ctx: RagCtx): Promise<QdrantHealth> {
  try {
    await ctx.ensureDependencies()
    await ctx.getQdrant().getCollections()
    return { online: true }
  } catch {
    ctx.resetQdrantClientState()
    return {
      online: false,
      message:
        'Qdrant vector database is offline. Restart the AI Assistant service in Settings to restore the Knowledge Base.',
    }
  }
}

export async function resetIndexingThreshold(ctx: RagCtx): Promise<void> {
  try {
    await ctx.ensureDependencies()
    const collectionName = CONTENT_COLLECTION_NAME
    await ctx.getQdrant().updateCollection(collectionName, {
      optimizers_config: {
        indexing_threshold: 20000,
      },
    })
    await KVStore.clearValue('rag.qdrantIndexingThreshold')
    ctx.dropIndexingThreshold(collectionName)
    logger.info(
      `[RAG] Reset Qdrant indexing_threshold to 20000 on ${collectionName} after all jobs completed`
    )
  } catch (err) {
    logger.warn(
      `[RAG] Failed to reset Qdrant indexing_threshold: %s`,
      err instanceof Error ? err.message : String(err)
    )
  }
}

export async function deleteCollection(ctx: RagCtx, name: string): Promise<void> {
  await ctx.getQdrant().deleteCollection(name)
}

export function getQdrantSafe(ctx: RagCtx): QdrantClient {
  return ctx.getQdrant()
}
