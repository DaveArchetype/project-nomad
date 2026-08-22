import { Worker } from 'node:worker_threads'
import os from 'node:os'
import logger from '@adonisjs/core/services/logger'
import type { ZIMArchiveMetadata, ZIMContentChunk } from '../../types/zim.js'

/**
 * Inline worker function. Serialized via `Function.toString()` and run with
 * `new Worker(source, { eval: true })` so it works identically in dev (ts-node)
 * and prod (compiled JS) without file-path resolution issues.
 *
 * Everything the worker needs is self-contained: cheerio and @openzim/libzim
 * are loaded via dynamic `import()`, and the extraction logic (HTML cleaning,
 * structured/simple strategy selection, section splitting) is inlined as a
 * faithful copy of ZIMExtractionService + zim_html.ts. Each worker opens its
 * own read-only `Archive` handle on the same ZIM file (`workerData.filePath`)
 * so that article decompression — the actual CPU-heavy work for large
 * archives — happens in parallel across worker threads instead of serially
 * on the main thread. The main thread only enumerates dirent metadata
 * (path/title/mimetype) via `archive.iterByPath()`, which is cheap, and
 * dispatches `articlePath` to a worker to do the decompression + parsing.
 *
 * KEEP IN SYNC with:
 *   - ZIMExtractionService.loadCleanedHTML / chooseChunkingStrategy / hasStructuredHeadings / extractTextFromHTML
 *   - zim_html.ts: extractStructuredContent / tableToText / isNonContentHeading
 *   - constants/zim_extraction.ts: HTML_SELECTORS_TO_REMOVE / NON_CONTENT_HEADING_PATTERNS
 */
function workerFn() {
  const { parentPort, workerData } = require('node:worker_threads')
  const archiveMetadata = workerData.archiveMetadata
  const filePath = workerData.filePath

  const HTML_SELECTORS_TO_REMOVE = [
    'script',
    'style',
    'nav',
    'header',
    'footer',
    'noscript',
    'iframe',
    'svg',
    '.navbox',
    '.sidebar',
    '.infobox',
    '.mw-editsection',
    '.reference',
    '.reflist',
    '.toc',
    '.noprint',
    '.mw-jump-link',
    '.mw-headline-anchor',
    '[role="navigation"]',
    '.navbar',
    '.hatnote',
    '.ambox',
    '.sistersitebox',
    '.portal',
    '#coordinates',
    '.geo-nondefault',
    '.authority-control',
  ]

  const NON_CONTENT_HEADING_PATTERNS = [
    /^see also$/i,
    /^references$/i,
    /^external links$/i,
    /^further reading$/i,
    /^notes$/i,
    /^bibliography$/i,
    /^navigation$/i,
  ]

  function isNonContentHeading(heading: string) {
    return NON_CONTENT_HEADING_PATTERNS.some((p) => p.test(heading))
  }

  function tableToText($: any, table: any) {
    const rows: string[] = []
    $(table)
      .find('tr')
      .each((_: any, tr: any) => {
        const cells = $(tr)
          .find('th, td')
          .map((__: any, cell: any) => $(cell).text().replace(/\s+/g, ' ').trim())
          .get()
          .filter((c: string) => c.length > 0)
        if (cells.length > 0) rows.push(cells.join(' | '))
      })
    return rows.join('\n')
  }

  function extractStructuredContent($: any) {
    const title = $('h1').first().text().trim() || $('title').text().trim()
    const sections: any[] = []
    let currentSection: { heading: string; content: string[]; level: number; skip: boolean } = {
      heading: 'Introduction',
      content: [],
      level: 2,
      skip: false,
    }

    const flushSection = () => {
      if (!currentSection.skip && currentSection.content.length > 0) {
        sections.push({
          heading: currentSection.heading,
          text: currentSection.content.join(' ').replace(/\s+/g, ' ').trim(),
          level: currentSection.level,
        })
      }
    }

    $('body')
      .find('h2, h3, h4, p, ul, ol, dl, table')
      .each((_: any, element: any) => {
        const $el = $(element)
        const tagName = element.tagName ? element.tagName.toLowerCase() : ''

        if (['h2', 'h3', 'h4'].includes(tagName)) {
          flushSection()
          const heading = $el
            .text()
            .replace(/\[edit\]/gi, '')
            .trim()
          const level = Number.parseInt(tagName.substring(1))
          currentSection = { heading, content: [], level, skip: isNonContentHeading(heading) }
        } else if (['p', 'ul', 'ol', 'dl', 'table'].includes(tagName)) {
          if (currentSection.skip) return
          const text = tagName === 'table' ? tableToText($, element) : $el.text().trim()
          if (text.length > 0) currentSection.content.push(text)
        }
      })
    flushSection()

    if (sections.length === 0) {
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
      if (bodyText.length > 0) {
        sections.push({ heading: title || 'Content', text: bodyText, level: 2 })
      }
    }

    return { title, sections }
  }

  function hasStructuredHeadings($: any) {
    const headings = $('h2, h3').toArray()
    if (headings.length < 2) return false
    let sectionsWithContent = 0

    for (const heading of headings) {
      const $heading = $(heading)
      const headingText = $heading.text().trim()
      if (headingText.length < 3) continue
      if (NON_CONTENT_HEADING_PATTERNS.some((p) => p.test(headingText))) continue

      let contentLength = 0
      let $next = $heading.next()
      while ($next.length && !$next.is('h1, h2, h3, h4')) {
        contentLength += $next.text().trim().length
        $next = $next.next()
      }
      if (contentLength >= 100) sectionsWithContent++
    }
    return sectionsWithContent >= 2
  }

  function extractTextFromHTML($: any) {
    try {
      const text = $('body').length ? $('body').text() : $.root().text()
      return text
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim()
    } catch {
      return null
    }
  }

  let cheerioLoad: any = null
  let archive: any = null
  const initPromise: any = Promise.all([
    import('cheerio').then((m: any) => {
      cheerioLoad = m.load || (m.default && m.default.load)
    }),
    import('@openzim/libzim').then((m: any) => {
      const ArchiveCtor = m.Archive || (m.default && m.default.Archive)
      archive = new ArchiveCtor(filePath)
    }),
  ]).catch((err: any) => {
    initPromise.__error = err
  })

  parentPort.on('message', (msg: any) => {
    initPromise.then(() => {
      const { id, articlePath, articleTitle, documentId, strategy } = msg
      try {
        if (!cheerioLoad) {
          throw new Error('cheerio module not loaded in worker')
        }
        if (!archive) {
          throw new Error('ZIM archive not opened in worker')
        }

        // Each worker owns its own read-only Archive handle into the same
        // underlying ZIM file, so decompression (the actual CPU-heavy work
        // for large archives) happens in parallel across worker threads
        // instead of serially on the main thread.
        const entry = archive.getEntryByPath(articlePath)
        const htmlBuffer = Buffer.from(entry.item.data.data)

        const $ = cheerioLoad(htmlBuffer.toString('utf-8'))
        for (const selector of HTML_SELECTORS_TO_REMOVE) {
          $(selector).remove()
        }

        const chosenStrategy = strategy || (hasStructuredHeadings($) ? 'structured' : 'simple')
        let chunks

        if (chosenStrategy === 'structured') {
          const structured = extractStructuredContent($)
          chunks = structured.sections.map((s) => ({
            text: s.text,
            articleTitle,
            articlePath,
            sectionTitle: s.heading,
            fullTitle: `${articleTitle} - ${s.heading}`,
            hierarchy: `${articleTitle} > ${s.heading}`,
            sectionLevel: s.level,
            documentId,
            archiveMetadata,
            strategy: chosenStrategy,
          }))
        } else {
          const text = extractTextFromHTML($) || ''
          chunks = [
            {
              text,
              articleTitle,
              articlePath,
              sectionTitle: articleTitle,
              fullTitle: articleTitle,
              hierarchy: articleTitle,
              documentId,
              archiveMetadata,
              strategy: chosenStrategy,
            },
          ]
        }

        const nonEmpty = chunks.filter((c) => c.text.trim().length >= 200)
        parentPort.postMessage({ id, chunks: nonEmpty })
      } catch (err) {
        parentPort.postMessage({ id, error: err.message, chunks: [] })
      }
    })
  })
}

const workerSource = `(${workerFn.toString()})()`

export interface PendingRequest {
  resolve: (chunks: ZIMContentChunk[]) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Pool of `worker_threads` that parallelize ZIM article extraction — both the
 * libzim decompression and the cheerio HTML parsing/section splitting —
 * across CPU cores.
 *
 * The main thread only enumerates dirent entries via the libzim native
 * iterator (path/title/mimetype — cheap metadata, can't be parallelized) and
 * dispatches article paths to workers. Each worker opens its own `Archive`
 * handle on the same ZIM file, decompresses the article itself, cleans the
 * HTML with cheerio, extracts sections, and returns ready-to-chunk text.
 * This turns what would otherwise be a single-threaded decompression
 * bottleneck into N-core parallelism.
 *
 * Workers are created with `eval: true` using a serialized function, so no
 * separate worker file is needed — this avoids TS/JS path resolution issues
 * between dev (ts-node) and prod (compiled build).
 */
export class ZIMWorkerPool {
  private workers: Worker[] = []
  private workerAlive: boolean[] = []
  private nextWorker = 0
  private nextId = 0
  private pending = new Map<number, PendingRequest>()
  private terminated = false

  constructor(numWorkers: number, archiveMetadata: ZIMArchiveMetadata, filePath: string) {
    for (let i = 0; i < numWorkers; i++) {
      const worker = new Worker(workerSource, {
        eval: true,
        workerData: { archiveMetadata, filePath },
      })

      const workerIndex = i
      this.workerAlive.push(true)

      worker.on('message', (msg: any) => {
        const entry = this.pending.get(msg.id)
        if (!entry) return
        this.pending.delete(msg.id)
        clearTimeout(entry.timer)
        if (msg.error) {
          entry.reject(new Error(msg.error))
        } else {
          entry.resolve(msg.chunks as ZIMContentChunk[])
        }
      })

      worker.on('error', (err) => {
        logger.error(`[ZIMWorkerPool] Worker ${workerIndex} error: ${err.message}`)
        this.markWorkerDead(workerIndex, err)
      })

      worker.on('exit', (code) => {
        if (code !== 0 && !this.terminated) {
          logger.warn(`[ZIMWorkerPool] Worker ${workerIndex} exited with code ${code}`)
        }
        this.markWorkerDead(
          workerIndex,
          new Error(`Worker ${workerIndex} exited with code ${code}`)
        )
      })

      this.workers.push(worker)
    }
  }

  get size(): number {
    return this.workers.length
  }

  get healthyWorkerCount(): number {
    return this.workerAlive.filter(Boolean).length
  }

  private markWorkerDead(workerIndex: number, err: Error): void {
    if (!this.workerAlive[workerIndex]) return
    this.workerAlive[workerIndex] = false

    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      this.pending.delete(id)
      entry.reject(err)
    }
  }

  processArticle(
    articlePath: string,
    articleTitle: string,
    documentId: string,
    strategy?: string,
    timeoutMs = 120_000
  ): Promise<ZIMContentChunk[]> {
    if (this.terminated) {
      return Promise.reject(new Error('Worker pool has been terminated'))
    }

    if (this.healthyWorkerCount === 0) {
      return Promise.reject(
        new Error('All worker threads have died — worker pool is no longer usable')
      )
    }

    const id = this.nextId++
    const workerIndex = this.nextAliveWorker()
    if (workerIndex === -1) {
      return Promise.reject(
        new Error('No alive worker threads available — worker pool is no longer usable')
      )
    }
    const worker = this.workers[workerIndex]

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`Worker timeout after ${timeoutMs}ms for article ${articlePath}`))
        }
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      worker.postMessage({ id, articlePath, articleTitle, documentId, strategy })
    })
  }

  private nextAliveWorker(): number {
    const total = this.workers.length
    for (let attempt = 0; attempt < total; attempt++) {
      const idx = this.nextWorker
      this.nextWorker = (this.nextWorker + 1) % total
      if (this.workerAlive[idx]) return idx
    }
    return -1
  }

  async terminate(): Promise<void> {
    this.terminated = true
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('Worker pool terminated'))
    }
    this.pending.clear()
    await Promise.all(this.workers.map((w) => w.terminate()))
  }

  static getDefaultWorkerCount(): number {
    const cores =
      typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length
    return Math.min(Math.max(cores - 1, 1), 8)
  }
}
