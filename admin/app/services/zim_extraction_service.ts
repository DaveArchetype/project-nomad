import { Archive, Entry } from '@openzim/libzim'
import * as cheerio from 'cheerio'
import {
  HTML_SELECTORS_TO_REMOVE,
  NON_CONTENT_HEADING_PATTERNS,
} from '../../constants/zim_extraction.js'
import { extractStructuredContent } from '../utils/zim_html.js'
import { ZIMWorkerPool } from './zim_worker_pool.js'
import logger from '@adonisjs/core/services/logger'
import {
  ExtractZIMChunkingStrategy,
  StreamZIMContentOptions,
  StreamZIMContentResult,
  StreamZIMArticleCallback,
  ZIMContentChunk,
  ZIMArchiveMetadata,
} from '../../types/zim.js'
import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { isValidZimFile } from '../utils/fs.js'

export class ZIMExtractionService {
  private extractArchiveMetadata(archive: Archive): ZIMArchiveMetadata {
    try {
      return {
        title: archive.getMetadata('Title') || archive.getMetadata('Name') || 'Unknown',
        creator: archive.getMetadata('Creator') || 'Unknown',
        publisher: archive.getMetadata('Publisher') || 'Unknown',
        date: archive.getMetadata('Date') || 'Unknown',
        language: archive.getMetadata('Language') || 'Unknown',
        description: archive.getMetadata('Description') || '',
      }
    } catch (error) {
      logger.warn('[ZIMExtractionService]: Could not extract all metadata, using defaults', error)
      return {
        title: 'Unknown',
        creator: 'Unknown',
        publisher: 'Unknown',
        date: 'Unknown',
        language: 'Unknown',
        description: '',
      }
    }
  }

  async streamZIMContent(
    filePath: string,
    opts: StreamZIMContentOptions = {},
    onArticle: StreamZIMArticleCallback
  ): Promise<StreamZIMContentResult> {
    try {
      logger.info(
        `[ZIMExtractionService]: Streaming ZIM file at path: ${filePath} (startOffset=${opts.startOffset || 0})`
      )

      try {
        await access(filePath)
      } catch {
        logger.error(`[ZIMExtractionService]: ZIM file not accessible: ${filePath}`)
        throw new Error(`ZIM file not found or not accessible: ${filePath}`)
      }

      // Validate ZIM magic number before opening with native library.
      // A corrupted file causes a native C++ abort that cannot be caught by JS.
      if (!(await isValidZimFile(filePath))) {
        throw new Error(`ZIM file is invalid or corrupted: ${filePath}`)
      }

      const archive = new Archive(filePath)
      const archiveMetadata = this.extractArchiveMetadata(archive)
      const totalArticles = archive.articleCount
      logger.info(
        `[ZIMExtractionService]: Archive metadata - Title: ${archiveMetadata.title}, Language: ${archiveMetadata.language}, Articles: ${totalArticles}`
      )

      const startOffset = opts.startOffset || 0
      let articlesSeen = 0
      let articlesProcessed = 0
      let cancelled = false

      const useWorkers = opts.useWorkers !== false
      let pool: ZIMWorkerPool | null = null

      if (useWorkers) {
        try {
          const numWorkers = ZIMWorkerPool.getDefaultWorkerCount()
          pool = new ZIMWorkerPool(numWorkers, archiveMetadata)
          logger.info(
            `[ZIMExtractionService]: Using ${numWorkers} worker threads for parallel article extraction`
          )
        } catch (poolErr) {
          logger.warn(
            `[ZIMExtractionService]: Failed to create worker pool, falling back to inline processing: %s`,
            poolErr instanceof Error ? poolErr.message : String(poolErr)
          )
          pool = null
        }
      }

      try {
        if (pool) {
          const batchSize = pool.size * 2
          let batch: Array<{
            htmlBuffer: Buffer
            articlePath: string
            articleTitle: string
            documentId: string
            articlesSeen: number
          }> = []

          const processBatch = async () => {
            if (batch.length === 0) return
            const currentBatch = batch
            batch = []

            const results = await Promise.all(
              currentBatch.map((b) =>
                pool!
                  .processArticle(
                    b.htmlBuffer,
                    b.articlePath,
                    b.articleTitle,
                    b.documentId,
                    opts.strategy
                  )
                  .catch((err) => {
                    logger.warn(
                      `[ZIMExtractionService]: Worker error for article ${b.articlePath}: %s`,
                      err instanceof Error ? err.message : String(err)
                    )
                    return [] as ZIMContentChunk[]
                  })
              )
            )

            for (const [i, result] of results.entries()) {
              articlesProcessed++
              const shouldContinue = await onArticle(
                result,
                currentBatch[i].articlesSeen,
                totalArticles
              )
              if (shouldContinue === false) {
                cancelled = true
                break
              }
            }
          }

          for (const entry of archive.iterByPath()) {
            if (!this.isArticleEntry(entry)) {
              continue
            }

            if (articlesSeen < startOffset) {
              articlesSeen++
              continue
            }
            articlesSeen++

            let htmlBuffer: Buffer
            try {
              htmlBuffer = Buffer.from(entry.item.data.data)
            } catch (readErr) {
              logger.warn(
                `[ZIMExtractionService]: Failed to read article ${entry.path}: %s`,
                readErr instanceof Error ? readErr.message : String(readErr)
              )
              continue
            }

            batch.push({
              htmlBuffer,
              articlePath: entry.path,
              articleTitle: entry.title || entry.path,
              documentId: randomUUID(),
              articlesSeen,
            })

            if (batch.length >= batchSize) {
              await processBatch()
              if (cancelled) break
            }
          }

          if (!cancelled) {
            await processBatch()
          }
        } else {
          for (const entry of archive.iterByPath()) {
            if (!this.isArticleEntry(entry)) {
              continue
            }

            if (articlesSeen < startOffset) {
              articlesSeen++
              continue
            }
            articlesSeen++

            const $ = this.loadCleanedHTML(entry.item.data.data)
            const strategy = opts.strategy || this.chooseChunkingStrategy($)
            const documentId = randomUUID()
            const articleTitle = entry.title || entry.path

            let chunks: ZIMContentChunk[]

            if (strategy === 'structured') {
              const structured = extractStructuredContent($)
              chunks = structured.sections.map((s) => ({
                text: s.text,
                articleTitle,
                articlePath: entry.path,
                sectionTitle: s.heading,
                fullTitle: `${articleTitle} - ${s.heading}`,
                hierarchy: `${articleTitle} > ${s.heading}`,
                sectionLevel: s.level,
                documentId,
                archiveMetadata,
                strategy,
              }))
            } else {
              const text = this.extractTextFromHTML($) || ''
              chunks = [
                {
                  text,
                  articleTitle,
                  articlePath: entry.path,
                  sectionTitle: articleTitle,
                  fullTitle: articleTitle,
                  hierarchy: articleTitle,
                  documentId,
                  archiveMetadata,
                  strategy,
                },
              ]
            }

            const nonEmptyChunks = chunks.filter((c) => c.text.trim().length > 0)
            articlesProcessed++

            const shouldContinue = await onArticle(nonEmptyChunks, articlesSeen, totalArticles)
            if (shouldContinue === false) {
              cancelled = true
              break
            }
          }
        }
      } finally {
        if (pool) {
          await pool.terminate()
        }
      }

      logger.info(
        `[ZIMExtractionService]: Stream ${cancelled ? 'cancelled' : 'completed'}. Articles processed this run: ${articlesProcessed}, articles seen total: ${articlesSeen}`
      )
      return { articlesProcessed, totalArticles, cancelled }
    } catch (error) {
      logger.error('Error streaming ZIM file:', error)
      throw error
    }
  }

  private chooseChunkingStrategy($: cheerio.CheerioAPI): ExtractZIMChunkingStrategy {
    return this.hasStructuredHeadings($) ? 'structured' : 'simple'
  }

  private loadCleanedHTML(buff: Buffer): cheerio.CheerioAPI {
    const $ = cheerio.load(buff.toString('utf-8'))

    HTML_SELECTORS_TO_REMOVE.forEach((selector) => {
      $(selector).remove()
    })

    return $
  }

  private extractTextFromHTML($: cheerio.CheerioAPI): string | null {
    try {
      const text = $('body').length ? $('body').text() : $.root().text()

      return text
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim()
    } catch (error) {
      logger.error('Error extracting text from HTML:', error)
      return null
    }
  }

  private hasStructuredHeadings($: cheerio.CheerioAPI): boolean {
    const headings = $('h2, h3').toArray()

    // Consider it structured if it has at least 2 headings to break content into meaningful sections
    if (headings.length < 2) return false

    // Check that headings have substantial content between them
    let sectionsWithContent = 0

    for (const heading of headings) {
      const $heading = $(heading)
      const headingText = $heading.text().trim()

      // Skip empty or very short headings, likely not meaningful
      if (headingText.length < 3) continue

      // Skip common non-content headings
      if (NON_CONTENT_HEADING_PATTERNS.some((pattern) => pattern.test(headingText))) {
        continue
      }

      // Content until next heading
      let contentLength = 0
      let $next = $heading.next()

      while ($next.length && !$next.is('h1, h2, h3, h4')) {
        contentLength += $next.text().trim().length
        $next = $next.next()
      }

      // Consider it a real section if it has at least 100 chars of content
      if (contentLength >= 100) {
        sectionsWithContent++
      }
    }

    // Require at least 2 sections with substantial content
    return sectionsWithContent >= 2
  }

  private isArticleEntry(entry: Entry): boolean {
    try {
      if (entry.isRedirect) return false

      const item = entry.item
      const mimeType = item.mimetype

      return mimeType === 'text/html' || mimeType === 'application/xhtml+xml'
    } catch {
      return false
    }
  }
}
