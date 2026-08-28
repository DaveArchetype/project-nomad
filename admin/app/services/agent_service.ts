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
  onContentChunk?: (chunk: string) => void
  signal?: AbortSignal
}

const MAX_RECURSION_LIMIT = 25

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
    })

    const collectedSources: WebSource[] = []
    const toolSteps: ToolStep[] = []

    const tools = this._buildTools(enabledTools, collectedSources, toolSteps, callbacks)

    if (tools.length === 0) {
      throw new Error('No tools enabled for agent run.')
    }

    const systemPrompt = params.systemPrompt
      ? params.systemPrompt
      : 'You are a helpful AI assistant with access to tools. Use tools when the user asks about current information that requires live data, calculations, or the current time. For general knowledge questions, answer directly without tools. Always cite web sources by including their URLs in your response when you use web search or web fetch results.'

    const lcMessages = [{ role: 'system' as const, content: systemPrompt }, ...messages]

    const agent = createAgent({
      model: chatModel,
      tools,
    })

    let fullContent = ''

    try {
      const run = await agent.streamEvents({ messages: lcMessages as any }, {
        version: 'v3',
        signal,
        recursionLimit: MAX_RECURSION_LIMIT,
      } as any)

      for await (const msg of run.messages) {
        for await (const token of msg.text) {
          if (typeof token === 'string' && token.length > 0) {
            fullContent += token
            callbacks?.onContentChunk?.(token)
          }
        }
      }

      try {
        for await (const call of run.toolCalls) {
          let input: Record<string, any> = {}
          try {
            input = call.input
              ? typeof call.input === 'string'
                ? JSON.parse(call.input)
                : JSON.parse(JSON.stringify(call.input))
              : {}
          } catch {
            input = { raw: String(call.input) }
          }
          const step: ToolStep = {
            tool: call.name,
            step: 'end',
            input,
          }
          try {
            const output = await call.output
            step.output = typeof output === 'string' ? output : JSON.stringify(output)
          } catch (err) {
            step.step = 'error'
            step.error = err instanceof Error ? err.message : String(err)
          }
          toolSteps.push(step)
          callbacks?.onToolStep?.(step)
        }
      } catch {
        // toolCalls stream may end before messages; ignore
      }
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
    callbacks?: AgentRunCallbacks
  ): any[] {
    const tools: any[] = []

    if (enabledTools.includes('web_search')) {
      tools.push(
        tool(
          async ({ query }: { query: string }) => {
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
            const step: ToolStep = { tool: 'web_fetch', step: 'start', input: { url } }
            callbacks?.onToolStep?.(step)
            try {
              const result = await this.searxngService.fetchPage(url)
              if (!collectedSources.some((s) => s.url === url)) {
                collectedSources.push({ title: result.title, url })
              }
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
