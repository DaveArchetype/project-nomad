import axios from 'axios'
import logger from '@adonisjs/core/services/logger'

const FETCH_TIMEOUT_MS = 20000
const FETCH_MAX_BYTES = 2 * 1024 * 1024

export type WebPreviewResult = {
  html: string
  contentType: string
}

export function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export async function fetchPageForIframe(url: string): Promise<WebPreviewResult | null> {
  if (!isValidHttpUrl(url)) return null

  try {
    const response = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      responseType: 'text',
      maxContentLength: FETCH_MAX_BYTES,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; NomadAIAssistant/1.0; +https://github.com/DaveArchetype/project-nomad)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })

    const contentType = String(response.headers?.['content-type'] ?? 'text/html')
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return null
    }

    let html = typeof response.data === 'string' ? response.data : String(response.data)

    const baseTag = `<base href="${url}">`
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`)
    } else if (/<html[^>]*>/i.test(html)) {
      html = html.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}</head>`)
    } else {
      html = `${baseTag}${html}`
    }

    return { html, contentType }
  } catch (error) {
    logger.warn(
      `[WebPreview] Fetch failed for ${url}: ${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }
}
