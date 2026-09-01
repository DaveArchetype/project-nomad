import { join, resolve, sep } from 'node:path'
import axios from 'axios'
import JSZip from 'jszip'
import * as cheerio from 'cheerio'
import { fromBuffer } from 'pdf2pic'
import logger from '@adonisjs/core/services/logger'
import { getFile, getFileStatsIfExists, isValidZimFile } from '../../utils/fs.js'
import { UPLOADS_STORAGE_PATH } from './constants.js'
import { resolveUploadPath } from './utils.js'

function mimeForExt(ext: string): string {
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
  }
  return map[ext.toLowerCase()] || 'application/octet-stream'
}

function mimeForPath(pathStr: string): string {
  const ext = pathStr.split('.').at(-1)?.toLowerCase() ?? ''
  return mimeForExt(ext)
}

function findFirstImageRef(text: string): string | null {
  const mdMatch = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(text)
  if (mdMatch && mdMatch[1]) return mdMatch[1]
  const htmlMatch = /<img[^>]+src=["']([^"']+)["']/i.exec(text)
  if (htmlMatch && htmlMatch[1]) return htmlMatch[1]
  return null
}

function collectZimImageCandidates(html: string): string[] {
  const $ = cheerio.load(html)
  const seen = new Set<string>()
  const out: string[] = []

  const push = (src: string | undefined) => {
    if (!src) return
    const cleaned = src.trim().split(/\s+/)[0]
    if (!cleaned || seen.has(cleaned)) return
    seen.add(cleaned)
    out.push(cleaned)
  }

  $(
    'figure img, table.infobox img, .infobox img, .thumb img, img.thumbimage, article img, img'
  ).each((_, el) => {
    const $el = $(el)
    const widthAttr = $el.attr('width')
    if (widthAttr) {
      const w = Number.parseInt(widthAttr, 10)
      if (!Number.isNaN(w) && w < 50) return
    }
    push($el.attr('src') || $el.attr('data-src'))
  })

  return out.filter((src) => !src.toLowerCase().endsWith('.svg') && !src.includes('image/svg'))
}

function resolveZimImagePath(src: string, articleDir: string): string | null {
  let raw = src
  const queryIdx = raw.indexOf('?')
  if (queryIdx >= 0) raw = raw.slice(0, queryIdx)
  const hashIdx = raw.indexOf('#')
  if (hashIdx >= 0) raw = raw.slice(0, hashIdx)

  if (/^https?:\/\//i.test(raw)) return null
  if (/^data:/i.test(raw)) return null
  if (raw.startsWith('//')) return null

  try {
    raw = decodeURIComponent(raw)
  } catch {
    // malformed URI — leave as-is
  }

  raw = raw.replace(/^\.\/+/, '')
  raw = raw.replace(/\/\.\//g, '/')
  raw = raw.replace(/^\/+/, '')

  if (raw.startsWith('../')) {
    const parts = articleDir.split('/').filter(Boolean)
    const rel = raw.split('/')
    while (rel[0] === '..' && parts.length > 0) {
      parts.pop()
      rel.shift()
    }
    return [...parts, ...rel].filter(Boolean).join('/')
  }
  if (raw.startsWith('/')) return raw.replace(/^\/+/, '')
  return (articleDir + raw).replace(/^\/+/, '')
}

async function getZimArticlePreviewImage(
  source: string,
  kiwixPath: string,
  index: number = 0
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const { Archive } = await import('@openzim/libzim')

  const validZim = await isValidZimFile(source)
  if (!validZim) {
    logger.warn(
      `[RagService.getSourcePreviewImage] ZIM file not valid or not accessible: ${source}`
    )
    return null
  }

  const archive = new Archive(source)

  const cleanKiwixPath = kiwixPath.replace(/^\/+/, '')
  const firstSlash = cleanKiwixPath.indexOf('/')
  if (firstSlash <= 0) {
    logger.warn(
      `[RagService.getSourcePreviewImage] invalid kiwixPath (no slug separator): ${kiwixPath}`
    )
    return null
  }
  const articlePath = cleanKiwixPath.slice(firstSlash + 1).replace(/^\/+/, '')
  if (!articlePath) return null

  logger.debug(
    `[RagService.getSourcePreviewImage] ZIM article path: ${articlePath} (from kiwixPath: ${kiwixPath})`
  )

  let articleEntry: any
  try {
    articleEntry = archive.getEntryByPath(articlePath)
  } catch (error) {
    logger.warn(
      { err: error },
      `[RagService.getSourcePreviewImage] article entry not found in ZIM: ${articlePath}`
    )
    return null
  }
  if (!articleEntry) {
    logger.warn(`[RagService.getSourcePreviewImage] article entry is null for: ${articlePath}`)
    return null
  }

  let html: string
  try {
    html = Buffer.from(articleEntry.item.data.data).toString('utf-8')
  } catch (error) {
    logger.warn(
      { err: error },
      `[RagService.getSourcePreviewImage] failed to read article HTML for: ${articlePath}`
    )
    return null
  }
  if (!html) return null

  const candidates = collectZimImageCandidates(html)
  logger.debug(
    `[RagService.getSourcePreviewImage] found ${candidates.length} image candidates for ${articlePath}: ${candidates.slice(0, 5).join(', ')}`
  )
  if (candidates.length === 0) return null

  const articleDir = articlePath.includes('/')
    ? articlePath.slice(0, articlePath.lastIndexOf('/') + 1)
    : ''

  let foundIndex = 0
  for (const candidate of candidates) {
    const resolved = resolveZimImagePath(candidate, articleDir)
    if (!resolved) {
      logger.debug(`[RagService.getSourcePreviewImage] could not resolve candidate: ${candidate}`)
      continue
    }
    try {
      const imgEntry = archive.getEntryByPath(resolved)
      if (!imgEntry) {
        logger.debug(
          `[RagService.getSourcePreviewImage] image entry not found in ZIM: ${resolved} (from candidate: ${candidate})`
        )
        continue
      }
      const data = Buffer.from(imgEntry.item.data.data)
      const mimeType = (imgEntry.item.mimetype as string) || mimeForPath(resolved)
      if (!mimeType.startsWith('image/') || mimeType.includes('svg')) {
        logger.debug(
          `[RagService.getSourcePreviewImage] skipping non-image or SVG: ${resolved} (mime: ${mimeType})`
        )
        continue
      }
      if (foundIndex < index) {
        foundIndex++
        logger.debug(
          `[RagService.getSourcePreviewImage] skipping image ${foundIndex}/${index} at ${resolved}`
        )
        continue
      }
      logger.debug(
        `[RagService.getSourcePreviewImage] returning image index=${index}: ${resolved} (mime: ${mimeType}, ${data.length} bytes)`
      )
      return { buffer: data, mimeType }
    } catch (error) {
      logger.debug(
        { err: error },
        `[RagService.getSourcePreviewImage] error reading image entry: ${resolved}`
      )
      continue
    }
  }
  logger.warn(
    `[RagService.getSourcePreviewImage] no usable image at index=${index} among ${candidates.length} candidates for ${articlePath}`
  )
  return null
}

async function getWebPreviewImage(
  url: string,
  index: number
): Promise<{ buffer: Buffer; mimeType: string } | { redirect: string } | null> {
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      responseType: 'text',
      maxContentLength: 2 * 1024 * 1024,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; NomadAIAssistant/1.0; +https://github.com/DaveArchetype/project-nomad)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })

    const contentType = String(response.headers?.['content-type'] ?? '')
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return null
    }

    const html = typeof response.data === 'string' ? response.data : String(response.data)
    const $ = cheerio.load(html)

    const imageCandidates: string[] = []

    const ogImage = $('meta[property="og:image"]').attr('content')
    if (ogImage) imageCandidates.push(ogImage)

    const twitterImage = $('meta[name="twitter:image"]').attr('content')
    if (twitterImage) imageCandidates.push(twitterImage)

    $('article img, main img, .content img, figure img, img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src')
      if (!src) return
      const width = Number.parseInt($(el).attr('width') || '0', 10)
      const height = Number.parseInt($(el).attr('height') || '0', 10)
      if (width > 0 && width < 50) return
      if (height > 0 && height < 50) return
      const alt = $(el).attr('alt') || ''
      if (/logo|icon|avatar|sprite|tracking|pixel|ad-|advert/i.test(src + alt)) return
      imageCandidates.push(src)
    })

    if (imageCandidates.length === 0) return null
    const targetSrc = imageCandidates[Math.min(index, imageCandidates.length - 1)]

    const resolvedUrl = new URL(targetSrc, url).href

    if (/\.(png|jpe?g|webp|gif|avif)$/i.test(resolvedUrl)) {
      try {
        const imgResponse = await axios.get(resolvedUrl, {
          timeout: 8000,
          responseType: 'arraybuffer',
          maxContentLength: 5 * 1024 * 1024,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; NomadAIAssistant/1.0; +https://github.com/DaveArchetype/project-nomad)',
          },
        })
        const buffer = Buffer.from(imgResponse.data)
        const mimeType = String(imgResponse.headers?.['content-type'] || 'image/jpeg')
        if (!mimeType.startsWith('image/')) return null
        return { buffer, mimeType }
      } catch {
        return { redirect: resolvedUrl }
      }
    }

    return { redirect: resolvedUrl }
  } catch (error) {
    logger.warn({ err: error, url }, '[RagService._getWebPreviewImage] failed')
    return null
  }
}

async function firstZipImage(
  buffer: Buffer,
  pathRegex: RegExp
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const zip = await JSZip.loadAsync(buffer)
  const entries = Object.keys(zip.files).filter((p) => pathRegex.test(p))
  if (entries.length === 0) return null
  const name = entries[0]
  const data = await zip.files[name].async('nodebuffer')
  const ext = name.split('.').at(-1)?.toLowerCase() ?? ''
  return { buffer: data, mimeType: mimeForExt(ext) }
}

async function firstEpubCoverImage(
  buffer: Buffer
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const zip = await JSZip.loadAsync(buffer)

  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) return null
  const containerXml = await containerFile.async('text')
  const $container = cheerio.load(containerXml, { xml: true })
  const opfPath = $container('rootfile').attr('full-path')
  if (!opfPath) return null

  const opfFile = zip.file(opfPath)
  if (!opfFile) return null
  const opfContent = await opfFile.async('text')
  const $opf = cheerio.load(opfContent, { xml: true })

  const manifestById = new Map<string, { href: string; mediaType: string }>()
  $opf('item').each((_, el) => {
    const $el = $opf(el)
    const id = $el.attr('id')
    if (!id) return
    manifestById.set(id, {
      href: $el.attr('href') || '',
      mediaType: $el.attr('media-type') || '',
    })
  })

  const coverMeta = $opf('meta[name="cover"]').attr('content')
  let chosenHref: string | null = null
  let chosenMime: string | null = null
  if (coverMeta && manifestById.has(coverMeta)) {
    const item = manifestById.get(coverMeta)!
    chosenHref = item.href
    chosenMime = item.mediaType
  } else {
    for (const [, item] of manifestById) {
      if (item.mediaType.startsWith('image/')) {
        chosenHref = item.href
        chosenMime = item.mediaType
        break
      }
    }
  }
  if (!chosenHref) return null

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const targetPath = decodeURIComponent(chosenHref)
    .split('/')
    .reduce((acc, part) => {
      if (part === '..') {
        const idx = acc.lastIndexOf('/')
        return idx >= 0 ? acc.slice(0, idx) : ''
      }
      if (part === '.' || part === '') return acc
      return acc ? `${acc}/${part}` : part
    }, opfDir)

  const imgFile = zip.file(targetPath)
  if (!imgFile) return null
  const data = await imgFile.async('nodebuffer')
  const mimeType =
    chosenMime && chosenMime.startsWith('image/') ? chosenMime : mimeForPath(targetPath)
  if (!mimeType.startsWith('image/') || mimeType.includes('svg')) return null
  return { buffer: data, mimeType }
}

async function getUploadPreviewImage(
  source: string
): Promise<{ buffer: Buffer; mimeType: string } | { redirect: string } | null> {
  const resolved = resolveUploadPath(source)
  if (!resolved) return null
  const stats = await getFileStatsIfExists(resolved)
  if (!stats) return null

  const ext = resolved.split('.').at(-1)?.toLowerCase() ?? ''

  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
    const buffer = await getFile(resolved, 'buffer')
    if (!buffer) return null
    return { buffer, mimeType: mimeForExt(ext) }
  }

  if (ext === 'pdf') {
    const buffer = await getFile(resolved, 'buffer')
    if (!buffer) return null
    try {
      const converted = await fromBuffer(buffer, {
        quality: 70,
        density: 150,
        format: 'png',
      }).bulk(1, { responseType: 'buffer' })
      const first = converted.find((res) => res.buffer)
      if (!first || !first.buffer) return null
      return { buffer: first.buffer, mimeType: 'image/png' }
    } catch (error) {
      logger.warn({ err: error, source }, '[RagService.getSourcePreviewImage] PDF render failed')
      return null
    }
  }

  if (['md', 'markdown', 'html', 'htm'].includes(ext)) {
    const text = await getFile(resolved, 'string')
    if (!text) return null
    const ref = findFirstImageRef(text)
    if (!ref) return null
    if (/^https?:\/\//i.test(ref)) return { redirect: ref }

    const fileDir = resolved.includes('/') ? resolved.slice(0, resolved.lastIndexOf('/') + 1) : ''
    const target = resolve(fileDir + ref)
    const uploadsRoot = resolve(join(process.cwd(), UPLOADS_STORAGE_PATH))
    if (!target.startsWith(uploadsRoot + sep)) return null
    const targetStats = await getFileStatsIfExists(target)
    if (!targetStats) return null
    const targetExt = target.split('.').at(-1)?.toLowerCase() ?? ''
    if (!['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(targetExt)) return null
    const buffer = await getFile(target, 'buffer')
    if (!buffer) return null
    return { buffer, mimeType: mimeForExt(targetExt) }
  }

  if (ext === 'docx') {
    const buffer = await getFile(resolved, 'buffer')
    if (!buffer) return null
    return await firstZipImage(buffer, /^word\/media\//i)
  }

  if (ext === 'epub') {
    const buffer = await getFile(resolved, 'buffer')
    if (!buffer) return null
    return await firstEpubCoverImage(buffer)
  }

  return null
}

export async function getSourcePreviewImage(
  source: string,
  kiwixPath?: string,
  index?: number
): Promise<{ buffer: Buffer; mimeType: string } | { redirect: string } | null> {
  try {
    if (kiwixPath && kiwixPath.trim().length > 0) {
      return await getZimArticlePreviewImage(source, kiwixPath, index ?? 0)
    }
    if (/^https?:\/\//i.test(source)) {
      return await getWebPreviewImage(source, index ?? 0)
    }
    if ((index ?? 0) > 0) return null
    logger.debug(`[RagService.getSourcePreviewImage] non-ZIM source, trying upload path: ${source}`)
    return await getUploadPreviewImage(source)
  } catch (error) {
    logger.warn({ err: error, source, kiwixPath }, '[RagService.getSourcePreviewImage] failed')
    return null
  }
}
