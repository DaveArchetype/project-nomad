import logger from '@adonisjs/core/services/logger'
import { EMBEDDING_MODEL_NAME } from '../../../constants/ollama.js'
import type { RAGResult, RerankedRAGResult } from '../../../types/rag.js'
import {
  CONTENT_COLLECTION_NAME,
  EMBEDDING_DIMENSION,
  MAX_SAFE_TOKENS,
  SEARCH_QUERY_PREFIX,
} from './constants.js'
import type { RagCtx } from './types.js'
import {
  cosineSimilarity,
  estimateTokenCount,
  extractKeywords,
  preprocessQuery,
  truncateToTokenLimit,
} from './utils.js'

export async function searchSimilarDocuments(
  ctx: RagCtx,
  query: string,
  limit: number = 5,
  scoreThreshold: number = 0.3,
  collection?: string
): Promise<Array<{ text: string; score: number; metadata?: Record<string, any> }>> {
  try {
    logger.debug(`[RAG] Starting similarity search for query: "${query}"`)

    await ctx.ensureCollection(CONTENT_COLLECTION_NAME, EMBEDDING_DIMENSION)

    const qdrant = ctx.getQdrant()
    const collectionInfo = await qdrant.getCollection(CONTENT_COLLECTION_NAME)
    const pointCount = collectionInfo.points_count || 0
    logger.debug(`[RAG] Knowledge base contains ${pointCount} document chunks`)

    if (pointCount === 0) {
      logger.debug('[RAG] Knowledge base is empty. Could not perform search.')
      return []
    }

    if (!ctx.isEmbeddingModelVerified()) {
      const allModels = await ctx.ollamaService.getModels(true)
      const embeddingModel =
        allModels.find((model) => model.name === EMBEDDING_MODEL_NAME) ??
        allModels.find((model) => model.name.toLowerCase().includes('nomic-embed-text'))

      if (!embeddingModel) {
        logger.warn(`[RAG] ${EMBEDDING_MODEL_NAME} not found. Cannot perform similarity search.`)
        return []
      }
      ctx.setEmbeddingModelVerified(embeddingModel.name)
    }

    const processedQuery = preprocessQuery(query)
    const keywords = extractKeywords(processedQuery)
    logger.debug(`[RAG] Extracted keywords: [${keywords.join(', ')}]`)

    const prefixTokens = estimateTokenCount(SEARCH_QUERY_PREFIX)
    const maxQueryTokens = MAX_SAFE_TOKENS - prefixTokens
    const truncatedQuery = truncateToTokenLimit(processedQuery, maxQueryTokens)

    const prefixedQuery = SEARCH_QUERY_PREFIX + truncatedQuery
    logger.debug(`[RAG] Generating embedding with prefix: "${SEARCH_QUERY_PREFIX}"`)

    const queryTokenCount = estimateTokenCount(prefixedQuery)
    if (queryTokenCount > MAX_SAFE_TOKENS) {
      logger.error(
        `[RAG] Query too long even after truncation: ${queryTokenCount} tokens (max: ${MAX_SAFE_TOKENS})`
      )
      return []
    }

    const response = await ctx.ollamaService.embed(
      ctx.getResolvedEmbeddingModel() ?? EMBEDDING_MODEL_NAME,
      [prefixedQuery]
    )

    const searchLimit = limit * 3
    logger.debug(
      `[RAG] Searching for top ${searchLimit} semantic matches (threshold: ${scoreThreshold})`
    )

    const searchResults = await qdrant.search(CONTENT_COLLECTION_NAME, {
      vector: response.embeddings[0],
      limit: searchLimit,
      score_threshold: scoreThreshold,
      with_payload: true,
      ...(collection
        ? { filter: { must: [{ key: 'collection', match: { value: collection } }] } }
        : {}),
    })

    logger.debug(`[RAG] Found ${searchResults.length} results above threshold ${scoreThreshold}`)

    const resultsWithMetadata: RAGResult[] = searchResults.map((result) => ({
      text: (result.payload?.text as string) || '',
      score: result.score,
      keywords: (result.payload?.keywords as string) || '',
      chunk_index: (result.payload?.chunk_index as number) || 0,
      created_at: (result.payload?.created_at as number) || 0,
      article_title: result.payload?.article_title as string | undefined,
      article_path: result.payload?.article_path as string | undefined,
      section_title: result.payload?.section_title as string | undefined,
      full_title: result.payload?.full_title as string | undefined,
      hierarchy: result.payload?.hierarchy as string | undefined,
      document_id: result.payload?.document_id as string | undefined,
      content_type: result.payload?.content_type as string | undefined,
      source: result.payload?.source as string | undefined,
      calibre_book_id: result.payload?.calibre_book_id as number | undefined,
      calibre_format: result.payload?.calibre_format as string | undefined,
    }))

    const rerankedResults = rerankResults(resultsWithMetadata, keywords, query)

    logger.debug(`[RAG] Top 3 results after reranking:`)
    rerankedResults.slice(0, 3).forEach((result, idx) => {
      logger.debug(
        `[RAG]   ${idx + 1}. Score: ${result.finalScore.toFixed(4)} (semantic: ${result.score.toFixed(4)}) - "${result.text.substring(0, 100)}..."`
      )
    })

    const diverseResults = applySourceDiversity(rerankedResults)

    return diverseResults.slice(0, limit).map((result) => ({
      text: result.text,
      score: result.finalScore,
      metadata: {
        chunk_index: result.chunk_index,
        created_at: result.created_at,
        semantic_score: result.score,
        article_title: result.article_title,
        article_path: result.article_path,
        section_title: result.section_title,
        full_title: result.full_title,
        hierarchy: result.hierarchy,
        document_id: result.document_id,
        content_type: result.content_type,
        source: result.source,
        calibre_book_id: result.calibre_book_id,
        calibre_format: result.calibre_format,
      },
    }))
  } catch (error) {
    logger.error('[RAG] Error searching similar documents:', error)
    return []
  }
}

export async function filterSourcesByResponseRelevance<T extends { snippet: string }>(
  ctx: RagCtx,
  sources: T[],
  responseText: string
): Promise<T[]> {
  if (sources.length === 0 || !responseText.trim()) return sources

  try {
    const ok = await ctx.ensureEmbeddingModel()
    if (!ok) return sources

    const model = ctx.getResolvedEmbeddingModel() ?? EMBEDDING_MODEL_NAME
    const inputs = [responseText, ...sources.map((s) => s.snippet)]
    const { embeddings } = await ctx.ollamaService.embed(model, inputs)

    const responseVec = embeddings[0]
    const threshold = 0.3
    const filtered = sources.filter((_, idx) => {
      const sim = cosineSimilarity(responseVec, embeddings[idx + 1])
      logger.debug(
        `[RAG] Source relevance filter: source ${idx + 1}/${sources.length} sim=${sim.toFixed(4)} ${sim >= threshold ? 'KEEP' : 'DROP'}`
      )
      return sim >= threshold
    })

    logger.debug(
      `[RAG] Source relevance filter: ${filtered.length}/${sources.length} sources kept (threshold ${threshold})`
    )
    return filtered
  } catch (error) {
    logger.warn(
      `[RAG] Source relevance filter failed, keeping all sources: ${error instanceof Error ? error.message : error}`
    )
    return sources
  }
}

export function rerankResults(
  results: Array<RAGResult>,
  queryKeywords: string[],
  originalQuery: string
): Array<RerankedRAGResult> {
  return results
    .map((result) => {
      let finalScore = result.score

      const MIN_SEMANTIC_THRESHOLD = 0.35

      if (result.score < MIN_SEMANTIC_THRESHOLD) {
        logger.debug(
          `[RAG] Skipping boost for low semantic score: ${result.score.toFixed(3)} (threshold: ${MIN_SEMANTIC_THRESHOLD})`
        )
        return {
          ...result,
          finalScore,
        }
      }

      const docKeywords = result.keywords
        .toLowerCase()
        .split(' ')
        .filter((k) => k.length > 0)
      const matchingKeywords = queryKeywords.filter(
        (kw) =>
          docKeywords.includes(kw.toLowerCase()) ||
          result.text.toLowerCase().includes(kw.toLowerCase())
      )
      const keywordOverlap = matchingKeywords.length / Math.max(queryKeywords.length, 1)

      const keywordBoost = Math.sqrt(keywordOverlap) * 0.1 * result.score

      if (keywordOverlap > 0) {
        logger.debug(
          `[RAG] Keyword overlap: ${matchingKeywords.length}/${queryKeywords.length} - Boost: ${keywordBoost.toFixed(3)}`
        )
      }

      const queryTerms = originalQuery
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 3)
      const directMatches = queryTerms.filter((term) =>
        result.text.toLowerCase().includes(term)
      ).length

      if (queryTerms.length > 0) {
        const directMatchRatio = directMatches / queryTerms.length
        const directMatchBoost = Math.sqrt(directMatchRatio) * 0.075 * result.score

        if (directMatches > 0) {
          logger.debug(
            `[RAG] Direct term matches: ${directMatches}/${queryTerms.length} - Boost: ${directMatchBoost.toFixed(3)}`
          )
          finalScore += directMatchBoost
        }
      }

      const headingText = [result.full_title, result.section_title, result.article_title]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (headingText) {
        const headingHits = queryKeywords.filter((kw) =>
          headingText.includes(kw.toLowerCase())
        ).length
        if (headingHits > 0) {
          const headingRatio = headingHits / Math.max(queryKeywords.length, 1)
          const headingBoost = Math.sqrt(headingRatio) * 0.1 * result.score
          logger.debug(
            `[RAG] Heading match: ${headingHits}/${queryKeywords.length} - Boost: ${headingBoost.toFixed(3)}`
          )
          finalScore += headingBoost
        }
      }

      finalScore = Math.min(1.0, finalScore + keywordBoost)

      if (result.content_type === 'calibre_book') {
        const calibreBoost = 0.05 * result.score
        finalScore = Math.min(1.0, finalScore + calibreBoost)
        logger.debug(
          `[RAG] Calibre book preference boost: +${calibreBoost.toFixed(3)} (content_type=calibre_book)`
        )
      }

      return {
        ...result,
        finalScore,
      }
    })
    .sort((a, b) => b.finalScore - a.finalScore)
}

export function applySourceDiversity(results: Array<RerankedRAGResult>) {
  const sourceCounts = new Map<string, number>()
  const DIVERSITY_PENALTY = 0.85

  return results
    .map((result) => {
      const sourceKey = result.document_id || result.source || 'unknown'
      const count = sourceCounts.get(sourceKey) || 0
      const penalty = Math.pow(DIVERSITY_PENALTY, count)
      const diverseScore = result.finalScore * penalty

      sourceCounts.set(sourceKey, count + 1)

      if (count > 0) {
        logger.debug(
          `[RAG] Source diversity penalty for "${sourceKey}": ${result.finalScore.toFixed(4)} → ${diverseScore.toFixed(4)} (seen ${count}x)`
        )
      }

      return { ...result, finalScore: diverseScore }
    })
    .sort((a, b) => b.finalScore - a.finalScore)
}
