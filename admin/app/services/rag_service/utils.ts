import logger from '@adonisjs/core/services/logger'
import { removeStopwords } from 'stopword'
import { join, resolve, sep } from 'node:path'
import { UPLOADS_STORAGE_PATH, CHAR_TO_TOKEN_RATIO } from './constants.js'

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (const [i, val] of a.entries()) {
    dot += val * b[i]
    normA += val * val
    normB += val * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export function sanitizeText(text: string): string {
  return (
    text
      // Null bytes
      .replace(/\u0000/g, '')
      // Problematic control characters (keep \n, \r, \t)
      .replace(/[\u0001-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, '')
      // Invalid Unicode surrogates (lone surrogates that break JSON parsers)
      .replace(/[\uD800-\uDFFF]/g, '')
      // Unicode non-characters (U+FDD0..U+FDEF, U+FFFE, U+FFFF, and the
      // ..FFFE/FFFF in other planes) — some JSON parsers reject these
      .replace(/[\uFDD0-\uFDEF\uFFFE\uFFFF]/g, '')
      // Trim extra whitespace
      .trim()
  )
}

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / CHAR_TO_TOKEN_RATIO)
}

export function truncateToTokenLimit(text: string, maxTokens: number): string {
  const estimatedTokens = estimateTokenCount(text)

  if (estimatedTokens <= maxTokens) {
    return text
  }

  const maxChars = Math.floor(maxTokens * CHAR_TO_TOKEN_RATIO)

  let truncated = text.substring(0, maxChars)
  const lastSpace = truncated.lastIndexOf(' ')

  if (lastSpace > maxChars * 0.8) {
    truncated = truncated.substring(0, lastSpace)
  }

  logger.warn(
    `[RAG] Truncated text from ${text.length} to ${truncated.length} chars (est. ${estimatedTokens} → ${estimateTokenCount(truncated)} tokens)`
  )

  return truncated
}

export const QUERY_EXPANSION_DICTIONARY: Record<string, string> = {
  bob: 'bug out bag',
  bov: 'bug out vehicle',
  bol: 'bug out location',
  edc: 'every day carry',
  mre: 'meal ready to eat',
  shtf: 'shit hits the fan',
  teotwawki: 'the end of the world as we know it',
  opsec: 'operational security',
  ifak: 'individual first aid kit',
  ghb: 'get home bag',
  ghi: 'get home in',
  wrol: 'without rule of law',
  emp: 'electromagnetic pulse',
  ham: 'ham amateur radio',
  nbr: 'nuclear biological radiological',
  cbrn: 'chemical biological radiological nuclear',
  sar: 'search and rescue',
  comms: 'communications radio',
  fifo: 'first in first out',
  mylar: 'mylar bag food storage',
  paracord: 'paracord 550 cord',
  ferro: 'ferro rod fire starter',
  bivvy: 'bivvy bivy emergency shelter',
  bdu: 'battle dress uniform',
  gmrs: 'general mobile radio service',
  frs: 'family radio service',
  nbc: 'nuclear biological chemical',
}

export function preprocessQuery(query: string): string {
  let expanded = query.trim()

  const words = expanded.toLowerCase().split(/\s+/)
  const expansions: string[] = []

  for (const word of words) {
    const cleaned = word.replace(/[^\w]/g, '')
    if (QUERY_EXPANSION_DICTIONARY[cleaned]) {
      expansions.push(QUERY_EXPANSION_DICTIONARY[cleaned])
    }
  }

  if (expansions.length > 0) {
    expanded = `${expanded} ${expansions.join(' ')}`
    logger.debug(`[RAG] Query expanded with domain terms: "${expanded}"`)
  }

  logger.debug(`[RAG] Original query: "${query}"`)
  logger.debug(`[RAG] Preprocessed query: "${expanded}"`)
  return expanded
}

export function extractKeywords(query: string): string[] {
  const split = query.split(' ')
  const noStopWords = removeStopwords(split)

  const keywords = noStopWords
    .map((word) => word.replace(/[^\w]/g, '').toLowerCase())
    .filter((word) => word.length > 2)

  return [...new Set(keywords)]
}

export function resolveUploadPath(source: string): string | null {
  const uploadsAbsPath = resolve(join(process.cwd(), UPLOADS_STORAGE_PATH))
  const resolved = resolve(source)
  if (!resolved.startsWith(uploadsAbsPath + sep)) return null
  return resolved
}
