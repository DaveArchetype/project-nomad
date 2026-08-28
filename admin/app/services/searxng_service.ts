import { inject } from '@adonisjs/core'
import axios from 'axios'
import * as cheerio from 'cheerio'
import logger from '@adonisjs/core/services/logger'
import { DockerService } from './docker_service.js'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import Service from '#models/service'

export type SearxngSearchResult = {
  title: string
  url: string
  snippet: string
  content?: string
}

export type SearxngFetchResult = {
  url: string
  title: string
  text: string
}

const SEARCH_TIMEOUT_MS = 15000
const FETCH_TIMEOUT_MS = 20000
const FETCH_MAX_BYTES = 2 * 1024 * 1024
const FETCH_TEXT_CHAR_BUDGET = 6000

@inject()
export class SearxngService {
  constructor(private dockerService: DockerService) {}

  async isAvailable(): Promise<boolean> {
    const url = await this._resolveUrl()
    return url !== null
  }

  async search(
    query: string,
    opts?: { signal?: AbortSignal; maxResults?: number }
  ): Promise<SearxngSearchResult[]> {
    const baseUrl = await this._resolveUrl()
    if (!baseUrl) {
      throw new Error('SearXNG service is not installed or running.')
    }

    const maxResults = opts?.maxResults ?? 5
    try {
      const response = await axios.get(`${baseUrl}/search`, {
        params: {
          q: query,
          format: 'json',
          safesearch: 1,
          categories: 'general',
        },
        timeout: SEARCH_TIMEOUT_MS,
        signal: opts?.signal,
        headers: { Accept: 'application/json' },
      })

      const results: any[] = Array.isArray(response.data?.results) ? response.data.results : []
      return results.slice(0, maxResults).map((r) => ({
        title: String(r.title ?? '').trim(),
        url: String(r.url ?? '').trim(),
        snippet: String(r.content ?? '').trim(),
        content: r.content ? String(r.content) : undefined,
      }))
    } catch (error) {
      logger.warn(
        `[SearxngService] Search failed for "${query}": ${
          error instanceof Error ? error.message : error
        }`
      )
      throw new Error(
        `Web search failed: ${error instanceof Error ? error.message : 'unknown error'}`
      )
    }
  }

  async fetchPage(url: string, opts?: { signal?: AbortSignal }): Promise<SearxngFetchResult> {
    try {
      const response = await axios.get(url, {
        timeout: FETCH_TIMEOUT_MS,
        signal: opts?.signal,
        responseType: 'text',
        maxContentLength: FETCH_MAX_BYTES,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; NomadAIAssistant/1.0; +https://github.com/DaveArchetype/project-nomad)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      })

      const contentType = String(response.headers?.['content-type'] ?? '')
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        throw new Error(`Unsupported content type: ${contentType || 'unknown'}`)
      }

      const html = typeof response.data === 'string' ? response.data : String(response.data)
      const $ = cheerio.load(html)

      $('script, style, noscript, svg, iframe, nav, footer, header, aside, form').remove()

      const title = $('title').first().text().trim() || $('h1').first().text().trim() || url
      const mainEl = $('main, article').first().length ? $('main, article').first() : $('body')
      let text = mainEl.text().replace(/\s+/g, ' ').trim()
      if (!text) {
        text = $('body').text().replace(/\s+/g, ' ').trim()
      }
      if (text.length > FETCH_TEXT_CHAR_BUDGET) {
        text = text.slice(0, FETCH_TEXT_CHAR_BUDGET)
      }

      return { url, title, text }
    } catch (error) {
      logger.warn(
        `[SearxngService] Fetch failed for ${url}: ${
          error instanceof Error ? error.message : error
        }`
      )
      throw new Error(
        `Failed to fetch page: ${error instanceof Error ? error.message : 'unknown error'}`
      )
    }
  }

  private async _resolveUrl(): Promise<string | null> {
    const service = await Service.query()
      .where('service_name', SERVICE_NAMES.SEARXNG)
      .andWhere('installed', true)
      .first()
    if (!service) return null

    const hostname = process.env.NODE_ENV === 'production' ? SERVICE_NAMES.SEARXNG : 'localhost'

    let internalPort: string | null = null
    try {
      const parsed = JSON.parse(service.container_config || '{}')
      const exposedPorts = parsed.ExposedPorts || {}
      internalPort = Object.keys(exposedPorts)[0]?.replace('/tcp', '') ?? null
    } catch {}

    if (!internalPort) {
      const portBindings = service.container_config
        ? JSON.parse(service.container_config)?.HostConfig?.PortBindings
        : null
      if (portBindings) {
        internalPort = Object.keys(portBindings)[0]?.replace('/tcp', '') ?? null
      }
    }

    if (!internalPort) {
      return await this.dockerService.getServiceURL(SERVICE_NAMES.SEARXNG)
    }

    const hostPort =
      service.ui_location && parseInt(service.ui_location, 10) ? service.ui_location : internalPort

    const port = hostname === 'localhost' ? hostPort : internalPort
    return `http://${hostname}:${port}`
  }
}
