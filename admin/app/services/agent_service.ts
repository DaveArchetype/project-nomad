import { inject } from '@adonisjs/core'
import { createAgent, tool } from 'langchain'
import { ChatOllama } from '@langchain/ollama'
import { z } from 'zod'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import { OllamaService } from './ollama_service.js'
import { SearxngService } from './searxng_service.js'

export type AgentToolName = 'web_search' | 'web_fetch' | 'calculator' | 'current_time'

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
}

export type AgentRunCallbacks = {
  onToolStep?: (step: ToolStep) => void
  onContentChunk?: (chunk: string, thinking?: string) => void
  signal?: AbortSignal
}

const MAX_RECURSION_LIMIT = 40
const MAX_TOOL_CALLS = 3

type LCMessage = { role: 'system' | 'user' | 'assistant'; content: string }

@inject()
export class AgentService {
  constructor(
    private ollamaService: OllamaService,
    private searxngService: SearxngService
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
    const toolSteps: ToolStep[] = []
    let toolCallCount = 0
    const toolCallGuard = (): boolean => {
      toolCallCount++
      return toolCallCount <= MAX_TOOL_CALLS
    }

    const tools = this._buildTools(
      enabledTools,
      collectedSources,
      toolSteps,
      callbacks,
      toolCallGuard
    )

    if (tools.length === 0) {
      throw new Error('No tools enabled for agent run.')
    }

    const systemPrompt = params.systemPrompt
      ? params.systemPrompt
      : 'You are a helpful AI assistant with access to tools. Use tools when the user asks about current information that requires live data, calculations, or the current time. For general knowledge questions, answer directly without tools. CRITICAL RULES: (1) Make at most ONE web search per response. (2) After receiving tool results, you MUST immediately write your final answer to the user — do NOT call any tool again. (3) Never repeat a search you already performed. (4) Synthesize the tool results into a clear, complete answer with citations.'

    const lcMessages = [{ role: 'system' as const, content: systemPrompt }, ...messages]

    const agent = createAgent({
      model: chatModel,
      tools,
    })

    let fullContent = ''
    let toolStartedCount = 0
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
          toolStartedCount++
          if (toolStartedCount > 1) {
            logger.info('[AgentService] Second tool call started, breaking to force synthesis')
            shouldBreak = true
          }
        } else if (method === 'tools' && data?.event === 'tool-finished') {
          shouldBreak = true
        }
      }

      logger.info(
        `[AgentService] Stream finished: fullContent.length=${fullContent.length}, toolCallCount=${toolCallCount}, toolStarted=${toolStartedCount}, sources=${collectedSources.length}`
      )
    } catch (error: any) {
      if (signal?.aborted || error?.name === 'AbortError') {
        logger.debug('[AgentService] Agent run aborted by client disconnect')
        return { content: fullContent, toolSteps, webSources: collectedSources }
      }
      logger.error(
        `[AgentService] Agent run failed: ${error instanceof Error ? error.message : error}`
      )
      throw error
    }

    if (!fullContent && collectedSources.length > 0) {
      logger.info('[AgentService] Forcing synthesis with collected sources')
      const sourcesContext = collectedSources
        .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.snippet || ''}`)
        .join('\n\n')

      const firstUserQuestion = messages.find((m) => m.role === 'user')?.content || ''
      const lastUserContent = messages[messages.length - 1]?.content || ''
      const isRetry =
        /try again|try once more|again|please retry/i.test(lastUserContent) &&
        firstUserQuestion !== lastUserContent

      const synthesisMessages = [
        {
          role: 'system' as const,
          content: `You are a helpful assistant that just performed a web search and obtained real, current results. The search results below are REAL and CURRENT — you already searched the web successfully. Your job is to answer the user's question using these results combined with your own knowledge. NEVER say you cannot access the internet, cannot pull real-time data, or suggest the user check sources themselves — you already have the data. Write a confident, complete answer. Cite sources inline with their URLs. If the results are incomplete, supplement with your knowledge and note where to find more detail.${isRetry ? `\n\nThe user's original question was: "${firstUserQuestion}" — they asked you to try again, so answer that original question.` : ''}\n\nYour web search results:\n${sourcesContext}`,
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
          return { content: fullContent, toolSteps, webSources: collectedSources }
        }
        logger.error(
          `[AgentService] Synthesis call failed: ${synthError instanceof Error ? synthError.message : synthError}`
        )
      }
    }

    if (!fullContent) {
      fullContent =
        'I searched for information but was unable to synthesize a complete answer. Here is what I found from the web search results above. Please try rephrasing your question.'
      callbacks?.onContentChunk?.(fullContent)
    }

    return {
      content: fullContent,
      toolSteps,
      webSources: collectedSources,
    }
  }

  private _buildTools(
    enabledTools: AgentToolName[],
    collectedSources: WebSource[],
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
              const formatted = results
                .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet || ''}`)
                .join('\n\n')
              callbacks?.onToolStep?.({
                tool: 'web_search',
                step: 'end',
                input: { query },
                output: `${results.length} results found`,
              })
              return formatted || 'No results found.'
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
