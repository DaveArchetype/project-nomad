import { inject } from '@adonisjs/core'
import { createAgent, tool } from 'langchain'
import { ChatOllama } from '@langchain/ollama'
import { z } from 'zod'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import { OllamaService } from './ollama_service.js'
import { SearxngService } from './searxng_service.js'
import { ComfyuiService } from './comfyui_service.js'
import { ChatImageService } from './chat_image_service.js'

export type AgentToolName =
  | 'web_search'
  | 'web_fetch'
  | 'calculator'
  | 'current_time'
  | 'generate_image'

export type ToolStep = {
  tool: string
  step: 'start' | 'end' | 'error'
  input?: Record<string, any>
  output?: string
  error?: string
}

export type WebSource = {
  title: string
  url: string
  snippet?: string
}

export type AgentRunResult = {
  content: string
  toolSteps: ToolStep[]
  webSources: WebSource[]
  generatedImages: string[]
}

export type AgentRunCallbacks = {
  onToolStep?: (step: ToolStep) => void
  onContentChunk?: (chunk: string, thinking?: string) => void
  onImage?: (relPath: string) => void
  signal?: AbortSignal
}

const MAX_RECURSION_LIMIT = 40
const MAX_TOOL_CALLS = 3

type LCMessage = { role: 'system' | 'user' | 'assistant'; content: string }

@inject()
export class AgentService {
  constructor(
    private ollamaService: OllamaService,
    private searxngService: SearxngService,
    private comfyuiService: ComfyuiService
  ) {}

  async runAgent(params: {
    model: string
    messages: LCMessage[]
    enabledTools: AgentToolName[]
    systemPrompt?: string
    callbacks?: AgentRunCallbacks
  }): Promise<AgentRunResult> {
    const { model, messages, enabledTools, callbacks } = params
    const signal = params.callbacks?.signal

    const baseUrl = await this.ollamaService.getResolvedBaseUrl()
    if (!baseUrl) {
      throw new Error('AI service is not initialized.')
    }

    const chatModel = new ChatOllama(model, {
      baseUrl,
      think: true,
    })

    const collectedSources: WebSource[] = []
    const collectedPageContent: string[] = []
    const collectedImages: string[] = []
    const toolSteps: ToolStep[] = []
    let toolCallCount = 0
    const toolCallGuard = (): boolean => {
      toolCallCount++
      return toolCallCount <= MAX_TOOL_CALLS
    }

    const tools = this._buildTools(
      enabledTools,
      collectedSources,
      collectedPageContent,
      collectedImages,
      toolSteps,
      callbacks,
      toolCallGuard
    )

    if (tools.length === 0) {
      throw new Error('No tools enabled for agent run.')
    }

    const systemPrompt = params.systemPrompt
      ? params.systemPrompt
      : this._defaultSystemPrompt(enabledTools)

    const lcMessages = [{ role: 'system' as const, content: systemPrompt }, ...messages]

    const agent = createAgent({
      model: chatModel,
      tools,
    })

    let fullContent = ''
    let webSearchCount = 0
    let webFetchCount = 0
    let shouldBreak = false

    try {
      const eventStream = await agent.streamEvents({ messages: lcMessages as any }, {
        version: 'v3',
        signal,
        recursionLimit: MAX_RECURSION_LIMIT,
      } as any)

      for await (const event of eventStream as any) {
        if (toolCallCount > MAX_TOOL_CALLS || shouldBreak) {
          logger.warn(
            `[AgentService] Breaking agent loop: toolCallCount=${toolCallCount}, shouldBreak=${shouldBreak}`
          )
          break
        }

        const method = event.method
        const data = event.params?.data

        if (method === 'messages' && data?.event === 'content-block-delta') {
          const delta = data.delta
          if (delta?.type === 'text-delta' && delta.text) {
            fullContent += delta.text
            callbacks?.onContentChunk?.(delta.text)
          } else if (delta?.type === 'reasoning-delta' && delta.reasoning) {
            callbacks?.onContentChunk?.('', delta.reasoning)
          } else if (delta?.type === 'block-delta' && delta.fields?.text) {
            fullContent += delta.fields.text
            callbacks?.onContentChunk?.(delta.fields.text)
          }
        } else if (method === 'tools' && data?.event === 'tool-started') {
          const toolName = data?.tool_name || ''
          if (toolName === 'web_search') {
            webSearchCount++
            if (webSearchCount > 1) {
              logger.info('[AgentService] Second web_search started, breaking to force synthesis')
              shouldBreak = true
            }
          } else if (toolName === 'web_fetch') {
            webFetchCount++
            if (webFetchCount > 2) {
              logger.info('[AgentService] Too many web_fetch calls, breaking to force synthesis')
              shouldBreak = true
            }
          }
        } else if (method === 'tools' && data?.event === 'tool-finished') {
          if (webFetchCount > 0) {
            shouldBreak = true
          }
        }
      }

      logger.info(
        `[AgentService] Stream finished: fullContent.length=${fullContent.length}, webSearch=${webSearchCount}, webFetch=${webFetchCount}, sources=${collectedSources.length}`
      )
    } catch (error: any) {
      if (signal?.aborted || error?.name === 'AbortError') {
        logger.debug('[AgentService] Agent run aborted by client disconnect')
        return {
          content: fullContent,
          toolSteps,
          webSources: collectedSources,
          generatedImages: collectedImages,
        }
      }
      logger.error(
        `[AgentService] Agent run failed: ${error instanceof Error ? error.message : error}`
      )
      throw error
    }

    if (!fullContent && collectedSources.length > 0) {
      logger.info(
        `[AgentService] Forcing synthesis with ${collectedSources.length} sources and ${collectedPageContent.length} fetched pages`
      )
      const sourcesContext = collectedSources
        .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.snippet || ''}`)
        .join('\n\n')

      const pageContentContext = collectedPageContent.join('\n\n')

      const firstUserQuestion = messages.find((m) => m.role === 'user')?.content || ''
      const lastUserContent = messages[messages.length - 1]?.content || ''
      const isRetry =
        /try again|try once more|again|please retry/i.test(lastUserContent) &&
        firstUserQuestion !== lastUserContent

      const synthesisMessages = [
        {
          role: 'system' as const,
          content: `You are a helpful assistant that just performed a web search and fetched the actual web pages. The results below contain REAL, CURRENT data extracted from live websites — including full page content with actual numbers, temperatures, forecasts, etc. Your job is to answer the user's question using ALL of this data combined with your own knowledge. Compare data from ALL available sources to build the most complete answer. NEVER say you cannot access the internet, cannot pull real-time data, that data is missing, or suggest the user check sources themselves — you already have the real data in the results below. Write a confident, complete answer using the actual numbers and facts from the results. Cite sources inline with their URLs. If the user asks for a table, build a table with the actual data from the results.${isRetry ? `\n\nThe user's original question was: "${firstUserQuestion}" — they asked you to try again, so answer that original question.` : ''}\n\nWeb search results:\n${sourcesContext}\n\n=== FULL PAGE CONTENT FROM FETCHED SOURCES (use this for actual data) ===\n${pageContentContext}`,
        },
        ...messages,
      ]

      try {
        const stream = await chatModel.stream(synthesisMessages as any, { signal } as any)
        for await (const chunk of stream as any) {
          if (signal?.aborted) break
          const text =
            typeof chunk.content === 'string'
              ? chunk.content
              : Array.isArray(chunk.content)
                ? chunk.content.map((c: any) => c?.text || '').join('')
                : ''
          if (text) {
            fullContent += text
            callbacks?.onContentChunk?.(text)
          }
        }
      } catch (synthError: any) {
        if (signal?.aborted || synthError?.name === 'AbortError') {
          return {
            content: fullContent,
            toolSteps,
            webSources: collectedSources,
            generatedImages: collectedImages,
          }
        }
        logger.error(
          `[AgentService] Synthesis call failed: ${synthError instanceof Error ? synthError.message : synthError}`
        )
      }
    }

    if (!fullContent) {
      fullContent =
        collectedImages.length > 0
          ? 'Here is the image you asked for. Let me know if you would like any changes — a different style, size, or details.'
          : 'I searched for information but was unable to synthesize a complete answer. Here is what I found from the web search results above. Please try rephrasing your question.'
      callbacks?.onContentChunk?.(fullContent)
    }

    return {
      content: fullContent,
      toolSteps,
      webSources: collectedSources,
      generatedImages: collectedImages,
    }
  }

  private _defaultSystemPrompt(enabledTools: AgentToolName[]): string {
    const parts: string[] = [
      'You are a helpful AI assistant with access to tools. Use tools when the user asks about current information that requires live data, calculations, the current time, or asks you to create, generate, draw, or make an image or picture. For general knowledge questions, answer directly without tools.',
    ]
    if (enabledTools.includes('web_search') || enabledTools.includes('web_fetch')) {
      parts.push(
        'WEB SEARCH RULES: (1) Make exactly ONE web_search call — it automatically fetches the full content of the top results, so you do NOT need to call web_fetch separately. (2) After the search returns, you MUST immediately write your final answer using the provided data — do NOT call any more tools. (3) Never repeat a search. (4) The search results include full page content with real numbers — use that data directly in your answer. (5) Always cite sources with their URLs.'
      )
    }
    if (enabledTools.includes('generate_image')) {
      parts.push(
        'IMAGE GENERATION RULES: (1) When the user asks you to create, generate, draw, paint, or make an image or picture, call generate_image exactly once. (2) Write a single detailed English prompt for the tool: describe the subject, setting, style, lighting, composition, and quality. Honor everything the user asked for; only ask a clarifying question if the request is truly ambiguous. (3) Optionally pass width and height when the user asks for a specific size, and negative_prompt for things to avoid. (4) After the tool returns, briefly describe the image to the user — do not call any more tools. (5) If the tool reports an error, explain what it said and how to fix it (for example, installing an image model in Image Studio).'
      )
    }
    return parts.join(' ')
  }

  private _buildTools(
    enabledTools: AgentToolName[],
    collectedSources: WebSource[],
    collectedPageContent: string[],
    collectedImages: string[],
    _toolSteps: ToolStep[],
    callbacks?: AgentRunCallbacks,
    guard?: () => boolean
  ): any[] {
    const tools: any[] = []

    if (enabledTools.includes('web_search')) {
      tools.push(
        tool(
          async ({ query }: { query: string }) => {
            if (guard && !guard()) {
              return 'Tool call limit reached. Use the search results you already have to answer the user.'
            }
            const step: ToolStep = { tool: 'web_search', step: 'start', input: { query } }
            callbacks?.onToolStep?.(step)
            try {
              const results = await this.searxngService.search(query, { maxResults: 5 })
              for (const r of results) {
                if (r.url && !collectedSources.some((s) => s.url === r.url)) {
                  collectedSources.push({
                    title: r.title,
                    url: r.url,
                    snippet: r.snippet,
                  })
                }
              }

              const topUrls = results
                .slice(0, 3)
                .map((r) => r.url)
                .filter(Boolean)
              const fetchedContents: string[] = []
              for (const fetchUrl of topUrls) {
                try {
                  const page = await this.searxngService.fetchPage(fetchUrl)
                  if (page.text) {
                    const content = `--- Content from ${page.title} (${fetchUrl}) ---\n${page.text.slice(0, 4000)}`
                    fetchedContents.push(content)
                    collectedPageContent.push(content)
                  }
                } catch {
                  // skip failed fetches
                }
              }

              const formatted = results
                .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet || ''}`)
                .join('\n\n')

              const fullResult =
                fetchedContents.length > 0
                  ? `${formatted}\n\n=== FULL PAGE CONTENT (use this for actual data) ===\n${fetchedContents.join('\n\n')}`
                  : formatted

              callbacks?.onToolStep?.({
                tool: 'web_search',
                step: 'end',
                input: { query },
                output: `${results.length} results, ${fetchedContents.length} pages fetched`,
              })
              return fullResult || 'No results found.'
            } catch (err) {
              const errorStep: ToolStep = {
                tool: 'web_search',
                step: 'error',
                input: { query },
                error: err instanceof Error ? err.message : String(err),
              }
              callbacks?.onToolStep?.(errorStep)
              return `Search failed: ${err instanceof Error ? err.message : 'unknown error'}`
            }
          },
          {
            name: 'web_search',
            description:
              'Search the web for current information. Returns a list of results with titles, URLs, and snippets. Use this when the user asks about recent events, current data, or anything that requires live internet data.',
            schema: z.object({
              query: z.string().describe('The search query'),
            }),
          }
        )
      )
    }

    if (enabledTools.includes('web_fetch')) {
      tools.push(
        tool(
          async ({ url }: { url: string }) => {
            if (guard && !guard()) {
              return 'Tool call limit reached. Use the information you already have to answer the user.'
            }
            const step: ToolStep = { tool: 'web_fetch', step: 'start', input: { url } }
            callbacks?.onToolStep?.(step)
            try {
              const result = await this.searxngService.fetchPage(url)
              if (!collectedSources.some((s) => s.url === url)) {
                collectedSources.push({ title: result.title, url })
              }
              callbacks?.onToolStep?.({
                tool: 'web_fetch',
                step: 'end',
                input: { url },
                output: `${result.text.length} chars fetched`,
              })
              return result.text
            } catch (err) {
              const errorStep: ToolStep = {
                tool: 'web_fetch',
                step: 'error',
                input: { url },
                error: err instanceof Error ? err.message : String(err),
              }
              callbacks?.onToolStep?.(errorStep)
              return `Fetch failed: ${err instanceof Error ? err.message : 'unknown error'}`
            }
          },
          {
            name: 'web_fetch',
            description:
              'Fetch the text content of a specific web page URL. Use this after web_search to read the full content of a promising result. Returns the cleaned text content of the page.',
            schema: z.object({
              url: z.string().url().describe('The full URL of the page to fetch'),
            }),
          }
        )
      )
    }

    if (enabledTools.includes('calculator')) {
      tools.push(
        tool(
          async ({ expression }: { expression: string }) => {
            if (guard && !guard()) {
              return 'Tool call limit reached. Answer the user directly.'
            }
            const step: ToolStep = {
              tool: 'calculator',
              step: 'start',
              input: { expression },
            }
            callbacks?.onToolStep?.(step)
            try {
              const result = safeEvaluate(expression)
              const endStep: ToolStep = {
                tool: 'calculator',
                step: 'end',
                input: { expression },
                output: String(result),
              }
              callbacks?.onToolStep?.(endStep)
              return String(result)
            } catch (err) {
              const errorStep: ToolStep = {
                tool: 'calculator',
                step: 'error',
                input: { expression },
                error: err instanceof Error ? err.message : String(err),
              }
              callbacks?.onToolStep?.(errorStep)
              return `Calculation failed: ${err instanceof Error ? err.message : 'invalid expression'}`
            }
          },
          {
            name: 'calculator',
            description:
              'Evaluate a mathematical expression. Supports +, -, *, /, %, ^ (power), parentheses, and decimal numbers. Use this for precise arithmetic calculations.',
            schema: z.object({
              expression: z
                .string()
                .describe(
                  'The arithmetic expression to evaluate, e.g. "2 + 3 * 4" or "(10 + 5) / 3"'
                ),
            }),
          }
        )
      )
    }

    if (enabledTools.includes('current_time')) {
      tools.push(
        tool(
          async () => {
            if (guard && !guard()) {
              return 'Tool call limit reached. Answer the user directly.'
            }
            const now = DateTime.now()
            const step: ToolStep = {
              tool: 'current_time',
              step: 'end',
              input: {},
              output: now.toISO(),
            }
            callbacks?.onToolStep?.(step)
            return `Current date and time: ${now.toFormat('yyyy-MM-dd HH:mm:ss ZZZZ')} (${now.toISO()})`
          },
          {
            name: 'current_time',
            description:
              'Get the current date and time. Use this when the user asks about the current time, date, or day of the week.',
            schema: z.object({}),
          }
        )
      )
    }

    if (enabledTools.includes('generate_image')) {
      tools.push(
        tool(
          async ({
            prompt,
            negative_prompt,
            width,
            height,
            steps,
            seed,
          }: {
            prompt: string
            negative_prompt?: string
            width?: number
            height?: number
            steps?: number
            seed?: number
          }) => {
            if (guard && !guard()) {
              return 'Tool call limit reached. Answer the user directly.'
            }
            const input: Record<string, any> = { prompt }
            if (negative_prompt) input.negative_prompt = negative_prompt
            if (width) input.width = width
            if (height) input.height = height
            if (steps) input.steps = steps
            if (seed !== undefined) input.seed = seed
            callbacks?.onToolStep?.({ tool: 'generate_image', step: 'start', input })
            try {
              const result = await this.comfyuiService.generate({
                prompt,
                negativePrompt: negative_prompt,
                width,
                height,
                steps,
                seed,
                signal: callbacks?.signal,
              })
              const chatImageService = new ChatImageService()
              const dataUrl = `data:${result.mimeType};base64,${result.buffer.toString('base64')}`
              const relPath = await chatImageService.saveImage(dataUrl)
              if (!relPath) {
                throw new Error('Failed to persist the generated image.')
              }
              collectedImages.push(relPath)
              callbacks?.onImage?.(relPath)
              callbacks?.onToolStep?.({
                tool: 'generate_image',
                step: 'end',
                input,
                output: `${result.filename} (${result.checkpoint})`,
              })
              return `Image generated successfully and displayed to the user (file: ${result.filename}, model: ${result.checkpoint}). Briefly describe the image to the user now — do not call any more tools.`
            } catch (err: any) {
              if (callbacks?.signal?.aborted || err?.name === 'AbortError') {
                throw err
              }
              const message = err instanceof Error ? err.message : String(err)
              callbacks?.onToolStep?.({
                tool: 'generate_image',
                step: 'error',
                input,
                error: message,
              })
              return `Image generation failed: ${message}`
            }
          },
          {
            name: 'generate_image',
            description:
              'Generate an image from a text description using the local Image Studio (ComfyUI) service. Use this whenever the user asks to create, generate, draw, paint, or make an image or picture. Write ONE detailed English prompt describing the desired image: subject, setting, style, lighting, composition, and quality. Optionally set width/height (default 1024x1024), steps (default 25), a negative_prompt listing things to avoid, and a specific seed to reproduce a previous result.',
            schema: z.object({
              prompt: z.string().describe('Detailed description of the image to generate'),
              negative_prompt: z.string().optional().describe('Things to avoid in the image'),
              width: z
                .number()
                .int()
                .min(64)
                .max(2048)
                .optional()
                .describe('Image width in pixels'),
              height: z
                .number()
                .int()
                .min(64)
                .max(2048)
                .optional()
                .describe('Image height in pixels'),
              steps: z.number().int().min(1).max(100).optional().describe('Sampling steps'),
              seed: z.number().int().optional().describe('Fixed seed for reproducible results'),
            }),
          }
        )
      )
    }

    return tools
  }
}

function safeEvaluate(expr: string): number {
  const sanitized = expr.replace(/\s+/g, '')
  if (!/^[-+/*%^().0-9]+$/.test(sanitized)) {
    throw new Error('Expression contains invalid characters')
  }
  let pos = 0
  function parseExpression(): number {
    let left = parseTerm()
    while (pos < sanitized.length && (sanitized[pos] === '+' || sanitized[pos] === '-')) {
      const op = sanitized[pos++]
      const right = parseTerm()
      left = op === '+' ? left + right : left - right
    }
    return left
  }
  function parseTerm(): number {
    let left = parseFactor()
    while (
      pos < sanitized.length &&
      (sanitized[pos] === '*' || sanitized[pos] === '/' || sanitized[pos] === '%')
    ) {
      const op = sanitized[pos++]
      const right = parseFactor()
      if (op === '*') left = left * right
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero')
        left = left / right
      } else left = left % right
    }
    return left
  }
  function parseFactor(): number {
    let left = parseUnary()
    while (pos < sanitized.length && sanitized[pos] === '^') {
      pos++
      const right = parseUnary()
      left = Math.pow(left, right)
    }
    return left
  }
  function parseUnary(): number {
    if (pos < sanitized.length && sanitized[pos] === '-') {
      pos++
      return -parseUnary()
    }
    if (pos < sanitized.length && sanitized[pos] === '+') {
      pos++
      return parseUnary()
    }
    return parsePrimary()
  }
  function parsePrimary(): number {
    if (pos < sanitized.length && sanitized[pos] === '(') {
      pos++
      const result = parseExpression()
      if (pos >= sanitized.length || sanitized[pos] !== ')') {
        throw new Error('Missing closing parenthesis')
      }
      pos++
      return result
    }
    let numStr = ''
    while (pos < sanitized.length && /[0-9.]/.test(sanitized[pos])) {
      numStr += sanitized[pos++]
    }
    if (numStr === '') throw new Error('Expected a number')
    const num = Number.parseFloat(numStr)
    if (Number.isNaN(num)) throw new Error('Invalid number')
    return num
  }
  const result = parseExpression()
  if (pos < sanitized.length) throw new Error('Unexpected characters at end of expression')
  return result
}
