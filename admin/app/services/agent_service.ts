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
import { AutomationsService, parseSchedule } from './automations_service.js'

export type AgentToolName =
  | 'web_search'
  | 'web_fetch'
  | 'calculator'
  | 'current_time'
  | 'generate_image'
  | 'manage_automations'

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
    private comfyuiService: ComfyuiService,
    private automationsService: AutomationsService
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
          content: `${systemPrompt}\n\nYou just performed a web search and fetched the actual web pages. The results below contain REAL, CURRENT data extracted from live websites — including full page content with actual numbers, temperatures, forecasts, etc. Your job is to answer the user's question using ALL of this data combined with your own knowledge. Compare data from ALL available sources to build the most complete answer. NEVER say you cannot access the internet, cannot pull real-time data, that data is missing, or suggest the user check sources themselves — you already have the real data in the results below. Write a confident, complete answer using the actual numbers and facts from the results. Cite sources inline with their URLs. If the user asks for a table, build a table with the actual data from the results.${isRetry ? `\n\nThe user's original question was: "${firstUserQuestion}" — they asked you to try again, so answer that original question.` : ''}\n\nWeb search results:\n${sourcesContext}\n\n=== FULL PAGE CONTENT FROM FETCHED SOURCES (use this for actual data) ===\n${pageContentContext}`,
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

  buildSystemPrompt(enabledTools: AgentToolName[], nomadPrompt?: string): string {
    const base = this._defaultSystemPrompt(enabledTools)
    const now = DateTime.now().toFormat('yyyy-MM-dd')
    const dateLine = `Current date: ${now}. Always use this current year in search queries — never use hardcoded or guessed years.`
    const sections = [dateLine, base]
    if (nomadPrompt && nomadPrompt.trim()) {
      sections.push(`=== USER INSTRUCTIONS (NOMAD.md) ===\n${nomadPrompt.trim()}`)
    }
    return sections.join('\n\n')
  }

  private _defaultSystemPrompt(enabledTools: AgentToolName[]): string {
    const parts: string[] = [
      'You are a helpful AI assistant with access to tools. Use tools when the user asks about current information that requires live data, calculations, the current time, or asks you to create, generate, draw, or make an image or picture.',
      "Local knowledge base context has already been retrieved and is present in your conversation as system messages labeled [Context N]. You do NOT need to call any tool to access it — it is already there. Before doing anything else, check if [Context N] messages are present in the conversation. If they are, you MUST use them as your primary source of information. Cite local sources with their titles. If context from Calibre-Web books (labeled [Calibre Book]) or user-uploaded files (labeled [PDF], [EPUB], etc.) is available and relevant, PREFER it over web search results — these are curated reference materials. Only use web search if the local knowledge base context does not address the user's question at all.",
    ]
    if (enabledTools.includes('web_search') || enabledTools.includes('web_fetch')) {
      parts.push(
        'WEB SEARCH RULES: (1) The current date is already provided in your system prompt — use it directly when formulating search queries. Do NOT hardcode or guess years. (2) BEFORE calling web_search, check the conversation for [Context N] system messages. If local knowledge base context is present and relevant, use it and SKIP web_search entirely — do not call the tool. (3) Only call web_search if the local context does not address the question. (4) Make exactly ONE web_search call — it automatically fetches the full content of the top results, so you do NOT need to call web_fetch separately. (5) After the search returns, you MUST immediately write your final answer using the provided data — do NOT call any more tools. (6) Never repeat a search. (7) The search results include full page content with real numbers — use that data directly in your answer. (8) Always cite sources with their URLs.'
      )
    }
    if (enabledTools.includes('generate_image')) {
      parts.push(
        'IMAGE GENERATION RULES: (1) When the user asks you to create, generate, draw, paint, or make an image or picture, call generate_image exactly once. (2) Write a single detailed English prompt for the tool: describe the subject, setting, style, lighting, composition, and quality. Honor everything the user asked for; only ask a clarifying question if the request is truly ambiguous. (3) Optionally pass width and height when the user asks for a specific size, and negative_prompt for things to avoid. (4) After the tool returns, briefly describe the image to the user — do not call any more tools. (5) If the tool reports an error, explain what it said and how to fix it (for example, installing an image model in Image Studio).'
      )
    }
    if (enabledTools.includes('manage_automations')) {
      parts.push(
        'AUTOMATION RULES: (1) When the user asks to create, schedule, list, update, or delete an automation (a scheduled AI prompt run), call manage_automations. (2) For create, provide a name, a prompt, and a schedule in natural language (e.g. "every day at 15:00", "Mondays at 9am") or a cron expression prefixed with "cron:". (3) After the tool returns, confirm the result to the user concisely — do not call any more tools. (4) If the tool reports that n8n is not installed, tell the user they can install it from the Supply Depot.'
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

    if (enabledTools.includes('manage_automations')) {
      tools.push(
        tool(
          async (input: {
            action: 'create' | 'list' | 'update' | 'delete'
            name?: string
            prompt?: string
            schedule?: string
            model?: string
            tools?: string[]
            deliverToChat?: boolean
            targetChatSessionId?: string | 'new'
            automationId?: string
          }) => {
            if (guard && !guard()) {
              return 'Tool call limit reached. Answer the user directly.'
            }
            const step: ToolStep = {
              tool: 'manage_automations',
              step: 'start',
              input: { action: input.action, name: input.name },
            }
            callbacks?.onToolStep?.(step)
            try {
              const n8nInstalled = await this.automationsService.isN8nInstalled()
              if (!n8nInstalled) {
                callbacks?.onToolStep?.({
                  tool: 'manage_automations',
                  step: 'end',
                  input: { action: input.action },
                  output: 'n8n not installed',
                })
                return 'The Automations feature is not available because the n8n service is not installed. The user can install it from the Supply Depot.'
              }

              if (input.action === 'list') {
                const automations = await this.automationsService.listAutomations()
                const summary = automations
                  .map(
                    (a) =>
                      `- ${a.name} (id: ${a.id}, schedule: ${a.scheduleCron ?? 'manual'}, model: ${a.model}, active: ${a.active})`
                  )
                  .join('\n')
                callbacks?.onToolStep?.({
                  tool: 'manage_automations',
                  step: 'end',
                  input: { action: 'list' },
                  output: `${automations.length} automations`,
                })
                return `Current automations:\n${summary || '(none)'}`
              }

              if (input.action === 'create') {
                if (!input.name || !input.prompt) {
                  return 'To create an automation, provide both a name and a prompt.'
                }
                const scheduleCron = input.schedule ? parseSchedule(input.schedule) : null
                if (input.schedule && !scheduleCron) {
                  return `Could not parse the schedule "${input.schedule}". Use a format like "every day at 15:00", "Mondays at 9am", or "cron: 0 15 * * *".`
                }
                const automation = await this.automationsService.createAutomation({
                  name: input.name,
                  prompt: input.prompt,
                  scheduleCron,
                  model: input.model,
                  tools: input.tools,
                  deliverToChat: input.deliverToChat !== false,
                  targetChatSessionId: input.targetChatSessionId ?? 'new',
                })
                callbacks?.onToolStep?.({
                  tool: 'manage_automations',
                  step: 'end',
                  input: { action: 'create', name: input.name },
                  output: `created id ${automation.id}`,
                })
                const delivery = automation.deliverToChat
                  ? `deliver output to ${automation.targetChatSessionId === 'new' ? 'a new chat' : `chat ${automation.targetChatSessionId}`}`
                  : 'not deliver to any chat'
                return `Automation "${automation.name}" created successfully (id: ${automation.id}). It will run ${scheduleCron ? `on schedule "${scheduleCron}"` : 'only when manually triggered'} and ${delivery}.`
              }

              if (input.action === 'update') {
                if (!input.automationId) {
                  return 'To update an automation, provide its id.'
                }
                const scheduleCron = input.schedule
                  ? (parseSchedule(input.schedule) ?? undefined)
                  : undefined
                if (input.schedule && scheduleCron === undefined) {
                  return `Could not parse the schedule "${input.schedule}".`
                }
                const automation = await this.automationsService.updateAutomation(
                  input.automationId,
                  {
                    name: input.name,
                    prompt: input.prompt,
                    scheduleCron,
                    model: input.model,
                    tools: input.tools,
                    deliverToChat: input.deliverToChat,
                    targetChatSessionId: input.targetChatSessionId,
                  }
                )
                callbacks?.onToolStep?.({
                  tool: 'manage_automations',
                  step: 'end',
                  input: { action: 'update', id: input.automationId },
                  output: `updated id ${automation.id}`,
                })
                return `Automation "${automation.name}" updated successfully.`
              }

              if (input.action === 'delete') {
                if (!input.automationId) {
                  return 'To delete an automation, provide its id.'
                }
                await this.automationsService.deleteAutomation(input.automationId)
                callbacks?.onToolStep?.({
                  tool: 'manage_automations',
                  step: 'end',
                  input: { action: 'delete', id: input.automationId },
                  output: 'deleted',
                })
                return `Automation ${input.automationId} deleted successfully.`
              }

              return `Unknown action: ${input.action}`
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              callbacks?.onToolStep?.({
                tool: 'manage_automations',
                step: 'error',
                input: { action: input.action },
                error: message,
              })
              return `Automation operation failed: ${message}`
            }
          },
          {
            name: 'manage_automations',
            description:
              'Create, list, update, or delete NOMAD Automations (scheduled AI prompt runs powered by n8n). Use action "create" with a name, prompt, and schedule (e.g. "every day at 15:00", "Mondays at 9am", or "cron: 0 15 * * *"). Use "list" to show all automations. Use "update" with an automationId to modify. Use "delete" with an automationId to remove. By default output is delivered to a new chat; set deliverToChat=false to skip chat delivery (the automation runs but does not post to any chat).',
            schema: z.object({
              action: z.enum(['create', 'list', 'update', 'delete']),
              name: z.string().optional().describe('Automation name (for create/update)'),
              prompt: z
                .string()
                .optional()
                .describe('The prompt to run on schedule (for create/update)'),
              schedule: z
                .string()
                .optional()
                .describe(
                  'Natural-language schedule like "every day at 15:00" or a cron expression prefixed with "cron:"'
                ),
              model: z
                .string()
                .optional()
                .describe('Ollama model name (defaults to the current chat model)'),
              tools: z
                .array(z.string())
                .optional()
                .describe(
                  'Tool names to enable (web_search, web_fetch, calculator, current_time, generate_image)'
                ),
              deliverToChat: z
                .boolean()
                .optional()
                .describe(
                  'Whether to deliver the automation output to a NOMAD chat. Default true. Set false for automations that should run without posting to chat.'
                ),
              targetChatSessionId: z
                .string()
                .optional()
                .describe('Chat session id for output, or "new" for a new chat (default)'),
              automationId: z.string().optional().describe('The automation id (for update/delete)'),
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
