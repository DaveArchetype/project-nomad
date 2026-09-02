import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import { z } from 'zod'
import logger from '@adonisjs/core/services/logger'
import { SearxngService } from './searxng_service.js'
import { ComfyuiService } from './comfyui_service.js'
import { ChatImageService } from './chat_image_service.js'

export type AutomationToolContext = {
  signal?: AbortSignal
}

export type AutomationToolDefinition = {
  name: string
  description: string
  inputSchema: z.ZodObject<any, any>
  handler: (input: any, ctx: AutomationToolContext) => Promise<string>
}

const safeEvaluate = (expression: string): number => {
  if (!/^[-+/*%().,\d\s^]+$/.test(expression)) {
    throw new Error('Expression contains disallowed characters.')
  }
  const sanitized = expression.replace(/\^/g, '**').replace(/,/g, '.')
  const result = new Function(`"use strict"; return (${sanitized});`)()
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error('Expression did not evaluate to a finite number.')
  }
  return result
}

@inject()
export class AutomationToolRegistry {
  private tools: Map<string, AutomationToolDefinition> = new Map()

  constructor(
    private searxngService: SearxngService,
    private comfyuiService: ComfyuiService
  ) {
    this.register({
      name: 'web_search',
      description:
        'Search the web for current information. Returns a list of results with titles, URLs, and snippets.',
      inputSchema: z.object({ query: z.string().describe('The search query') }),
      handler: async (input) => {
        const results = await this.searxngService.search(input.query, {
          maxResults: 5,
          signal: input.signal,
        })
        if (results.length === 0) return 'No results found.'
        const topUrls = results
          .slice(0, 3)
          .map((r) => r.url)
          .filter(Boolean)
        const fetched: string[] = []
        for (const url of topUrls) {
          try {
            const page = await this.searxngService.fetchPage(url)
            if (page.text) {
              fetched.push(`--- ${page.title} (${url}) ---\n${page.text.slice(0, 4000)}`)
            }
          } catch {}
        }
        const formatted = results
          .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet || ''}`)
          .join('\n\n')
        return fetched.length > 0
          ? `${formatted}\n\n=== FULL PAGE CONTENT ===\n${fetched.join('\n\n')}`
          : formatted
      },
    })

    this.register({
      name: 'web_fetch',
      description: 'Fetch the text content of a specific web page URL.',
      inputSchema: z.object({
        url: z.string().url().describe('The full URL of the page to fetch'),
      }),
      handler: async (input) => {
        const result = await this.searxngService.fetchPage(input.url)
        return result.text
      },
    })

    this.register({
      name: 'calculator',
      description:
        'Evaluate a mathematical expression. Supports +, -, *, /, %, ^ (power), parentheses, and decimal numbers.',
      inputSchema: z.object({
        expression: z.string().describe('The arithmetic expression to evaluate, e.g. "2 + 3 * 4"'),
      }),
      handler: async (input) => {
        try {
          return String(safeEvaluate(input.expression))
        } catch (err) {
          return `Calculation failed: ${err instanceof Error ? err.message : 'invalid expression'}`
        }
      },
    })

    this.register({
      name: 'current_time',
      description:
        'Get the current date and time. Use this when the user asks about the current time, date, or day of the week.',
      inputSchema: z.object({}),
      handler: async () => {
        const now = DateTime.now()
        return `Current date and time: ${now.toFormat('yyyy-MM-dd HH:mm:ss ZZZZ')} (${now.toISO()})`
      },
    })

    this.register({
      name: 'generate_image',
      description:
        'Generate an image from a text prompt. Returns a relative path to the persisted image.',
      inputSchema: z.object({
        prompt: z.string().describe('A detailed English prompt describing the image to generate'),
        negative_prompt: z.string().optional().describe('Things to avoid in the image'),
        width: z.number().optional(),
        height: z.number().optional(),
        steps: z.number().optional(),
        seed: z.number().optional(),
      }),
      handler: async (input, ctx) => {
        try {
          const result = await this.comfyuiService.generate({
            prompt: input.prompt,
            negativePrompt: input.negative_prompt,
            width: input.width,
            height: input.height,
            steps: input.steps,
            seed: input.seed,
            signal: ctx.signal,
          })
          const chatImageService = new ChatImageService()
          const dataUrl = `data:${result.mimeType};base64,${result.buffer.toString('base64')}`
          const relPath = await chatImageService.saveImage(dataUrl)
          if (!relPath) throw new Error('Failed to persist the generated image.')
          return `Image generated successfully (file: ${result.filename}, model: ${result.checkpoint}). Image path: ${relPath}`
        } catch (err) {
          return `Image generation failed: ${err instanceof Error ? err.message : String(err)}`
        }
      },
    })
  }

  register(def: AutomationToolDefinition): void {
    this.tools.set(def.name, def)
  }

  list(): AutomationToolDefinition[] {
    return Array.from(this.tools.values())
  }

  get(name: string): AutomationToolDefinition | null {
    return this.tools.get(name) ?? null
  }

  async run(name: string, input: any, ctx: AutomationToolContext): Promise<string> {
    const def = this.get(name)
    if (!def) {
      throw new Error(`Unknown automation tool: ${name}`)
    }
    const parsed = def.inputSchema.safeParse(input)
    if (!parsed.success) {
      throw new Error(`Invalid input for tool "${name}": ${parsed.error.message}`)
    }
    logger.debug(`[AutomationToolRegistry] Running tool "${name}"`)
    return def.handler(parsed.data, ctx)
  }
}
