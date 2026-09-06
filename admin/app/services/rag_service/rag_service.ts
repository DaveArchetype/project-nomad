import { QdrantClient } from '@qdrant/js-client-rest'
import { DockerService } from '../docker_service.js'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import { TokenChunker } from '@chonkiejs/core'
import { OllamaService } from '../ollama_service.js'
import { SERVICE_NAMES } from '../../../constants/service_names.js'
import { EMBEDDING_MODEL_NAME } from '../../../constants/ollama.js'
import * as C from './constants.js'
import type { EmbedSingleFileResult, QdrantHealth, RagCtx } from './types.js'
import {
  checkQdrantHealth as checkQdrantHealthFn,
  ensureCollection as ensureCollectionFn,
  resetIndexingThreshold as resetIndexingThresholdFn,
} from './qdrant.js'
import { embedAndStoreChunks, embedAndStoreText } from './embedding.js'
import { processZIMFile } from './zim_processing.js'
import { processAndEmbedFile } from './file_pipeline.js'
import { filterSourcesByResponseRelevance, searchSimilarDocuments } from './search.js'
import {
  deleteKnowledgeCollection,
  getKnowledgeCollections,
  getStoredFiles,
  hasDocuments,
  renameKnowledgeCollection,
  updateFileCollection,
} from './stored_files.js'
import { readFileContent, resolveDownloadPath } from './file_viewer.js'
import { getSourcePreviewImage } from './preview_images.js'
import { fetchPageForIframe, isValidHttpUrl } from './web_preview.js'
import { computeFileWarnings, getPolicyPromptState } from './warnings.js'
import { deleteFileBySource, removeKnowledgeArtifacts } from './artifacts.js'
import { reconcileReplacedContentFile } from './reindex.js'
import { discoverNomadDocs } from './discovery.js'
import {
  embedSingleFile,
  repairAllFiles,
  repairFileIngestion,
  resumeFileIngestion,
  verifyFileEmbeddings,
} from './embed_jobs.js'
import { reembedAll, resetAndRebuild, scanAndSyncStorage } from './sync.js'
import type { ProcessAndEmbedFileResponse, ProcessZIMFileResponse } from '../../../types/rag.js'

export type { EmbedSingleFileResult, EmbedSingleFileFailureCode } from './types.js'

@inject()
export class RagService {
  private qdrant: QdrantClient | null = null
  private qdrantInitPromise: Promise<void> | null = null
  private embeddingModelVerified = false
  private resolvedEmbeddingModel: string | null = null
  private ensuredCollections = new Set<string>()
  private indexingThresholdApplied = new Set<string>()
  private tokenChunker: TokenChunker | null = null

  public static UPLOADS_STORAGE_PATH = C.UPLOADS_STORAGE_PATH
  public static CONTENT_COLLECTION_NAME = C.CONTENT_COLLECTION_NAME
  public static EMBEDDING_DIMENSION = C.EMBEDDING_DIMENSION
  public static FACET_SOURCE_LIMIT = C.FACET_SOURCE_LIMIT
  public static MODEL_CONTEXT_LENGTH = C.MODEL_CONTEXT_LENGTH
  public static MAX_SAFE_TOKENS = C.MAX_SAFE_TOKENS
  public static TARGET_TOKENS_PER_CHUNK = C.TARGET_TOKENS_PER_CHUNK
  public static PREFIX_TOKEN_BUDGET = C.PREFIX_TOKEN_BUDGET
  public static CHAR_TO_TOKEN_RATIO = C.CHAR_TO_TOKEN_RATIO
  public static SEARCH_DOCUMENT_PREFIX = C.SEARCH_DOCUMENT_PREFIX
  public static SEARCH_QUERY_PREFIX = C.SEARCH_QUERY_PREFIX

  constructor(
    private dockerService: DockerService,
    private ollamaService: OllamaService
  ) {}

  private get ctx(): RagCtx {
    return {
      self: this,
      dockerService: this.dockerService,
      ollamaService: this.ollamaService,
      ensuredCollections: this.ensuredCollections,
      indexingThresholdApplied: this.indexingThresholdApplied,
      getQdrant: () => this.qdrant!,
      ensureDependencies: () => this._ensureDependencies(),
      initializeQdrantClient: () => this._initializeQdrantClient(),
      ensureCollection: (name, dimensions) => this._ensureCollection(name, dimensions),
      resetQdrantClientState: () => {
        this.qdrant = null
        this.qdrantInitPromise = null
        this.ensuredCollections.clear()
        this.indexingThresholdApplied.clear()
      },
      dropEnsuredCollection: (name) => this.ensuredCollections.delete(name),
      dropIndexingThreshold: (name) => this.indexingThresholdApplied.delete(name),
      ensureEmbeddingModel: () => this.ensureEmbeddingModel(),
      getResolvedEmbeddingModel: () => this.resolvedEmbeddingModel,
      isEmbeddingModelVerified: () => this.embeddingModelVerified,
      setEmbeddingModelVerified: (modelName) => {
        this.resolvedEmbeddingModel = modelName
        this.embeddingModelVerified = true
      },
      getTokenChunker: () => this.getTokenChunker(),
      checkQdrantHealth: () => this.checkQdrantHealth(),
    }
  }

  private async _initializeQdrantClient() {
    if (!this.qdrantInitPromise) {
      this.qdrantInitPromise = (async () => {
        const qdrantUrl = await this.dockerService.getServiceURL(SERVICE_NAMES.QDRANT)
        if (!qdrantUrl) {
          throw new Error(
            'Qdrant vector database is offline. Restart the AI Assistant service in Settings to restore the Knowledge Base.'
          )
        }
        this.qdrant = new QdrantClient({ url: qdrantUrl })
      })().catch((err) => {
        this.qdrantInitPromise = null
        this.qdrant = null
        throw err
      })
    }
    return this.qdrantInitPromise
  }

  private async _ensureDependencies() {
    if (!this.qdrant) {
      await this._initializeQdrantClient()
    }
  }

  private async _ensureCollection(
    collectionName: string,
    dimensions: number = C.EMBEDDING_DIMENSION
  ): Promise<void> {
    return ensureCollectionFn(this.ctx, collectionName, dimensions)
  }

  public async checkQdrantHealth(): Promise<QdrantHealth> {
    return checkQdrantHealthFn(this.ctx)
  }

  public async resetIndexingThreshold(): Promise<void> {
    return resetIndexingThresholdFn(this.ctx)
  }

  private async getTokenChunker(): Promise<TokenChunker> {
    if (!this.tokenChunker) {
      this.tokenChunker = await TokenChunker.create({
        chunkSize: Math.floor(C.TARGET_TOKENS_PER_CHUNK * C.CHAR_TO_TOKEN_RATIO),
        chunkOverlap: Math.floor(300 * C.CHAR_TO_TOKEN_RATIO),
      })
    }
    return this.tokenChunker
  }

  private async ensureEmbeddingModel(): Promise<boolean> {
    if (this.embeddingModelVerified) {
      return true
    }

    const allModels = await this.ollamaService.getModels(true)
    const embeddingModel =
      allModels.find((model) => model.name === EMBEDDING_MODEL_NAME) ??
      allModels.find((model) => model.name.toLowerCase().includes('nomic-embed-text'))

    if (!embeddingModel) {
      try {
        const downloadResult = await this.ollamaService.downloadModel(EMBEDDING_MODEL_NAME)
        if (!downloadResult.success) {
          throw new Error(downloadResult.message || 'Unknown error during model download')
        }
      } catch (modelError) {
        logger.error(
          `[RAG] Embedding model ${EMBEDDING_MODEL_NAME} not found locally and failed to download:`,
          modelError
        )
        this.embeddingModelVerified = false
        return false
      }
    }
    this.resolvedEmbeddingModel = embeddingModel?.name ?? EMBEDDING_MODEL_NAME
    this.embeddingModelVerified = true
    return true
  }

  public async embedAndStoreText(
    text: string,
    metadata: Record<string, any> = {},
    onProgress?: (percent: number) => Promise<void>
  ): Promise<{ chunks: number } | null> {
    return embedAndStoreText(this.ctx, text, metadata, onProgress)
  }

  public async embedAndStoreChunks(
    texts: string[],
    metadatas: Record<string, any>[],
    onProgress?: (percent: number) => Promise<void>
  ): Promise<{ chunks: number } | null> {
    return embedAndStoreChunks(this.ctx, texts, metadatas, onProgress)
  }

  public async processZIMFile(
    filepath: string,
    deleteAfterEmbedding: boolean,
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
  ): Promise<ProcessZIMFileResponse> {
    return processZIMFile(this.ctx, filepath, deleteAfterEmbedding, options)
  }

  public async processAndEmbedFile(
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
    return processAndEmbedFile(this.ctx, filepath, deleteAfterEmbedding, options)
  }

  public async searchSimilarDocuments(
    query: string,
    limit: number = 5,
    scoreThreshold: number = 0.3,
    collection?: string
  ): Promise<Array<{ text: string; score: number; metadata?: Record<string, any> }>> {
    return searchSimilarDocuments(this.ctx, query, limit, scoreThreshold, collection)
  }

  public async filterSourcesByResponseRelevance<T extends { snippet: string }>(
    sources: T[],
    responseText: string
  ): Promise<T[]> {
    return filterSourcesByResponseRelevance(this.ctx, sources, responseText)
  }

  public async hasDocuments(): Promise<boolean> {
    return hasDocuments(this.ctx)
  }

  public async getStoredFiles() {
    return getStoredFiles(this.ctx)
  }

  public async getKnowledgeCollections(): Promise<string[]> {
    return getKnowledgeCollections(this.ctx)
  }

  public async updateFileCollection(
    source: string,
    collection: string | null
  ): Promise<{ success: boolean; message: string }> {
    return updateFileCollection(this.ctx, source, collection)
  }

  public async renameKnowledgeCollection(
    oldName: string,
    newName: string
  ): Promise<{ success: boolean; message: string }> {
    return renameKnowledgeCollection(this.ctx, oldName, newName)
  }

  public async deleteKnowledgeCollection(
    name: string
  ): Promise<{ success: boolean; message: string }> {
    return deleteKnowledgeCollection(this.ctx, name)
  }

  public async readFileContent(
    source: string
  ): Promise<{ content: string; extension: string; fileName: string } | null> {
    return readFileContent(source)
  }

  public async resolveDownloadPath(source: string): Promise<string | null> {
    return resolveDownloadPath(source)
  }

  public async getSourcePreviewImage(
    source: string,
    kiwixPath?: string,
    index?: number
  ): Promise<{ buffer: Buffer; mimeType: string } | { redirect: string } | null> {
    return getSourcePreviewImage(source, kiwixPath, index)
  }

  public async getPolicyPromptState(): Promise<{
    shouldPrompt: boolean
    hasContent: boolean
    totalFiles: number
  }> {
    return getPolicyPromptState()
  }

  public async computeFileWarnings() {
    return computeFileWarnings(this.ctx)
  }

  public async removeKnowledgeArtifacts(source: string): Promise<void> {
    return removeKnowledgeArtifacts(this.ctx, source)
  }

  public async deleteFileBySource(source: string): Promise<{ success: boolean; message: string }> {
    return deleteFileBySource(this.ctx, source)
  }

  public async reconcileReplacedContentFile(params: {
    oldFilePath: string
    newFilePath: string
    fileName: string
  }) {
    return reconcileReplacedContentFile(this.ctx, params)
  }

  public async discoverNomadDocs(force?: boolean): Promise<{ success: boolean; message: string }> {
    return discoverNomadDocs(force)
  }

  public async embedSingleFile(
    source: string,
    force: boolean = false
  ): Promise<EmbedSingleFileResult> {
    return embedSingleFile(this.ctx, source, force)
  }

  public async verifyFileEmbeddings(source: string) {
    return verifyFileEmbeddings(this.ctx, source)
  }

  public async resumeFileIngestion(source: string): Promise<EmbedSingleFileResult> {
    return resumeFileIngestion(this.ctx, source)
  }

  public async repairAllFiles() {
    return repairAllFiles(this.ctx)
  }

  public async repairFileIngestion(source: string): Promise<EmbedSingleFileResult> {
    return repairFileIngestion(this.ctx, source)
  }

  public async scanAndSyncStorage() {
    return scanAndSyncStorage(this.ctx)
  }

  public async reembedAll() {
    return reembedAll(this.ctx)
  }

  public async resetAndRebuild() {
    return resetAndRebuild(this.ctx)
  }

  public async webPreview(url: string): Promise<{ html: string; contentType: string } | null> {
    if (!isValidHttpUrl(url)) return null
    return fetchPageForIframe(url)
  }
}
