import type { QdrantClient } from '@qdrant/js-client-rest'
import type { TokenChunker } from '@chonkiejs/core'
import type { DockerService } from '../docker_service.js'
import type { OllamaService } from '../ollama_service.js'

export type EmbedSingleFileFailureCode =
  | 'not_found'
  | 'inflight'
  | 'delete_failed'
  | 'dispatch_failed'

export type EmbedSingleFileResult =
  | { success: true; message: string }
  | { success: false; code: EmbedSingleFileFailureCode; message: string }

export interface QdrantHealth {
  online: boolean
  message?: string
}

export interface RagCtx {
  self: any
  dockerService: DockerService
  ollamaService: OllamaService
  ensuredCollections: Set<string>
  indexingThresholdApplied: Set<string>
  getQdrant(): QdrantClient
  ensureDependencies(): Promise<void>
  initializeQdrantClient(): Promise<void>
  ensureCollection(name: string, dimensions?: number): Promise<void>
  resetQdrantClientState(): void
  dropEnsuredCollection(name: string): void
  dropIndexingThreshold(name: string): void
  ensureEmbeddingModel(): Promise<boolean>
  getResolvedEmbeddingModel(): string | null
  isEmbeddingModelVerified(): boolean
  setEmbeddingModelVerified(modelName: string): void
  getTokenChunker(): Promise<TokenChunker>
  checkQdrantHealth(): Promise<QdrantHealth>
}
