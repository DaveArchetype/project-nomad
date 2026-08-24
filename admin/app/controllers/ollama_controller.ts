import { ChatService } from '#services/chat_service'
import { ChatImageService } from '#services/chat_image_service'
import { DockerService } from '#services/docker_service'
import { NomadMdService } from '#services/nomad_md_service'
import { OllamaService } from '#services/ollama_service'
import { RagService } from '#services/rag_service'
import Service from '#models/service'
import KVStore from '#models/kv_store'
import { modelNameSchema } from '#validators/download'
import { chatSchema, getAvailableModelsSchema, unloadChatModelsSchema } from '#validators/ollama'
import { assertNotCloudMetadataUrl } from '#validators/common'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { RAG_CONTEXT_LIMITS, SYSTEM_PROMPTS } from '../../constants/ollama.js'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import logger from '@adonisjs/core/services/logger'

const DEFAULT_EMBED_PAUSE_AFTER_CHAT_MINUTES = 15

type Message = { role: 'system' | 'user' | 'assistant'; content: string; images?: string[] }

export type RagSource = {
  source: string
  title: string
  contentType?: string
  score?: number
  snippet: string
  /** Kiwix-serve content path for ZIM article sources (e.g.
   *  `/wikipedia_en_all_maxi_2026-02/A/Article_Title`). Present only for
   *  `content_type: 'zim_article'` sources that have both a resolvable ZIM slug
   *  and an article path. The frontend resolves the full URL using the Kiwix
   *  service's ui_path + the reverse-proxy base domain setting, so this works
   *  with both path-based (`/kiwix/...`) and subdomain (`kiwix.domain/...`)
   *  routing. */
  kiwixPath?: string
}

@inject()
export default class OllamaController {
  constructor(
    private chatService: ChatService,
    private dockerService: DockerService,
    private ollamaService: OllamaService,
    private ragService: RagService,
    private nomadMdService: NomadMdService
  ) {}

  async availableModels({ request }: HttpContext) {
    const reqData = await request.validateUsing(getAvailableModelsSchema)
    return await this.ollamaService.getAvailableModels({
      sort: reqData.sort,
      recommendedOnly: reqData.recommendedOnly,
      query: reqData.query || null,
      limit: reqData.limit || 15,
      force: reqData.force,
    })
  }

  /**
   * Send Ollama `keep_alive: 0` hints to every currently-loaded chat model
   * except the embedding model and (optionally) a target model to preserve.
   * Used by the chat UI to enforce the "one chat model at a time" invariant
   * on model-switch, session-switch, and page-load. Best-effort: a failure
   * here should not block the calling flow.
   */
  async unloadChatModels({ request, response }: HttpContext) {
    const { targetModel, vramAware } = await request.validateUsing(unloadChatModelsSchema)
    const unloaded = await this.ollamaService.unloadAllChatModelsExcept(
      targetModel ?? null,
      vramAware === true
    )
    return response.status(200).json({ unloaded })
  }

  async ensureTeiStarted({ response }: HttpContext) {
    const { TeiLifecycleService } = await import('#services/tei_lifecycle_service')
    const teiLifecycle = new TeiLifecycleService()
    const result = await teiLifecycle.ensureStarted()
    return response.status(200).json(result)
  }

  async chat({ request, response }: HttpContext) {
    const reqData = await request.validateUsing(chatSchema)

    // Pause background embedding so the chat's query embedding and inference
    // don't compete with the embed job for GPU/Ollama time. Each new chat
    // request extends the window (sliding); the embed job's batch loop checks
    // this flag between batches and sleeps until it expires. Duration is
    // configurable via the `rag.embedPauseAfterChatMinutes` KV setting
    // (AI Settings page); 0 disables the pause entirely.
    const pauseMinutesRaw = await KVStore.getValue('rag.embedPauseAfterChatMinutes')
    const pauseMinutes =
      pauseMinutesRaw != null && pauseMinutesRaw !== ''
        ? Number.parseInt(pauseMinutesRaw, 10)
        : DEFAULT_EMBED_PAUSE_AFTER_CHAT_MINUTES
    if (Number.isFinite(pauseMinutes) && pauseMinutes > 0) {
      await KVStore.setValue('rag.embedPausedUntil', String(Date.now() + pauseMinutes * 60 * 1000))
    }

    const { TeiLifecycleService } = await import('#services/tei_lifecycle_service')
    await new TeiLifecycleService().stampActivity()

    // Flush SSE headers immediately so the client connection is open while
    // pre-processing (query rewriting, RAG lookup) runs in the background.
    if (reqData.stream) {
      response.response.setHeader('Content-Type', 'text/event-stream')
      response.response.setHeader('Cache-Control', 'no-cache')
      response.response.setHeader('Connection', 'keep-alive')
      response.response.flushHeaders()
    }

    try {
      // If there are no system messages in the chat inject system prompts
      const hasSystemMessage = reqData.messages.some((msg) => msg.role === 'system')
      if (!hasSystemMessage) {
        const systemPrompt = {
          role: 'system' as const,
          content: SYSTEM_PROMPTS.default,
        }
        logger.debug('[OllamaController] Injecting system prompt')
        reqData.messages.unshift(systemPrompt)
      }

      // Inject the user-managed NOMAD.md as its own leading system message so the
      // user's persistent instructions take precedence, while the default
      // formatting prompt and any RAG context below remain intact. A missing or
      // blank file yields null and changes nothing.
      const nomadPrompt = await this.nomadMdService.getSystemPrompt()
      if (nomadPrompt) {
        logger.debug('[OllamaController] Injecting NOMAD.md system prompt')
        reqData.messages.unshift({ role: 'system' as const, content: nomadPrompt })
      }

      // Query rewriting for better RAG retrieval with manageable context
      // Will return user's latest message if no rewriting is needed
      const rewrittenQuery = await this.rewriteQueryWithContext(reqData.messages, reqData.model)

      logger.debug(`[OllamaController] Rewritten query for RAG: "${rewrittenQuery}"`)
      let ragSources: RagSource[] = []
      if (rewrittenQuery) {
        const collectionFilter: string | null = request.input('collection', null)
        const relevantDocs = await this.ragService.searchSimilarDocuments(
          rewrittenQuery,
          5, // Top 5 most relevant chunks
          0.3, // Minimum similarity score of 0.3
          collectionFilter ?? undefined
        )

        logger.debug(
          `[RAG] Retrieved ${relevantDocs.length} relevant documents for query: "${rewrittenQuery}"`
        )

        // If relevant context is found, inject as a system message with adaptive limits
        if (relevantDocs.length > 0) {
          // Determine context budget based on model size
          const { maxResults, maxTokens } = this.getContextLimitsForModel(reqData.model)
          let trimmedDocs = relevantDocs.slice(0, maxResults)

          // Apply token cap if set (estimate ~3.5 chars per token)
          // Always include the first (most relevant) result — the cap only gates subsequent results
          if (maxTokens > 0) {
            const charCap = maxTokens * 3.5
            let totalChars = 0
            trimmedDocs = trimmedDocs.filter((doc, idx) => {
              totalChars += doc.text.length
              return idx === 0 || totalChars <= charCap
            })
          }

          logger.debug(
            `[RAG] Injecting ${trimmedDocs.length}/${relevantDocs.length} results (model: ${reqData.model}, maxResults: ${maxResults}, maxTokens: ${maxTokens || 'unlimited'})`
          )

          // Label each context block with its source title when available (a neutral,
          // honest provenance signal) but never the raw relevance score — nomic cosine
          // scores for genuinely relevant passages sit ~0.4-0.6, and surfacing e.g.
          // "42%" primes the model to distrust correct context. Scores stay in the logs
          // above for debugging.
          const contextText = trimmedDocs
            .map((doc, idx) => {
              const title = doc.metadata?.full_title || doc.metadata?.article_title
              const label = title ? `[Context ${idx + 1} — ${title}]` : `[Context ${idx + 1}]`
              return `${label}\n${doc.text}`
            })
            .join('\n\n')

          const systemMessage = {
            role: 'system' as const,
            content: SYSTEM_PROMPTS.rag_context(contextText),
          }

          // Insert system message at the beginning (after any existing system messages)
          const firstNonSystemIndex = reqData.messages.findIndex((msg) => msg.role !== 'system')
          const insertIndex = firstNonSystemIndex === -1 ? 0 : firstNonSystemIndex
          reqData.messages.splice(insertIndex, 0, systemMessage)

          // Build a deduplicated list of source files backing the injected RAG
          // context, so the client can surface provenance (clickable "Sources"
          // chips under the answer). One entry per distinct source, keeping the
          // highest semantic score observed. Reflects only what was actually
          // injected (trimmedDocs), not every retrieved candidate.
          ragSources = this._collectRagSources(trimmedDocs)
        }
      }

      // If system messages are large (e.g. due to RAG context), request a context window big
      // enough to fit them. Ollama respects num_ctx per-request; LM Studio ignores it gracefully.
      const systemChars = reqData.messages
        .filter((m) => m.role === 'system')
        .reduce((sum, m) => sum + m.content.length, 0)
      const estimatedSystemTokens = Math.ceil(systemChars / 3.5)
      let numCtx: number | undefined
      if (estimatedSystemTokens > 3000) {
        const needed = estimatedSystemTokens + 2048 // leave room for conversation + response
        numCtx = [8192, 16384, 32768, 65536].find((n) => n >= needed) ?? 65536
        logger.debug(
          `[OllamaController] Large system prompt (~${estimatedSystemTokens} tokens), requesting num_ctx: ${numCtx}`
        )
      }

      // Check if the model supports "thinking" capability for enhanced response generation.
      // Thinking is only enabled when the model supports it AND the user wants it: the explicit
      // per-request preference wins, otherwise the global default (ai.autoThinking, default OFF).
      // If gpt-oss model, it requires a text param for "think" https://docs.ollama.com/api/chat
      const thinkingCapability = await this.ollamaService.checkModelHasThinking(reqData.model)
      let thinkingEnabled = false
      if (thinkingCapability) {
        thinkingEnabled = reqData.think ?? (await KVStore.getValue('ai.autoThinking')) ?? false
      }
      const think: boolean | 'medium' = thinkingEnabled
        ? reqData.model.startsWith('gpt-oss')
          ? 'medium'
          : true
        : false

      // Separate sessionId and the resolved thinking preference from the Ollama request payload —
      // Ollama rejects unknown fields, and `think` is re-derived above (not forwarded raw).
      const { sessionId, think: _thinkPref, ...ollamaRequest } = reqData

      // Persist any image attachments on user messages to disk and build a separate messages
      // array for OllamaService. We must NOT mutate reqData.messages here: query rewriting and
      // RAG (above) treat `content` as a string (.slice / concatenation), so the multimodal
      // content-parts array is built only in `ollamaMessages`, which is what the model receives.
      // `images` (base64 data URLs) is also stripped from every message since Ollama rejects
      // unknown fields. Stored relative paths are kept for the DB row.
      const chatImageService = new ChatImageService()
      const savedImagePathsByMsgIndex: Map<number, string[]> = new Map()
      const ollamaMessages = await Promise.all(
        ollamaRequest.messages.map(async (msg, idx) => {
          if (!msg.images || msg.images.length === 0) {
            return { role: msg.role, content: msg.content }
          }
          const savedPaths: string[] = []
          for (const dataUrl of msg.images) {
            const rel = await chatImageService.saveImage(dataUrl)
            if (rel) savedPaths.push(rel)
          }
          savedImagePathsByMsgIndex.set(idx, savedPaths)
          // OpenAI multimodal content: a text part (even if empty) followed by image parts.
          // An empty text part is valid and lets image-only turns through.
          const content: any[] = [{ type: 'text', text: msg.content || '' }]
          for (const dataUrl of msg.images) {
            content.push({ type: 'image_url', image_url: { url: dataUrl } })
          }
          return { role: msg.role, content }
        })
      )

      // Save user message to DB before streaming if sessionId provided
      let userContent: string | null = null
      if (sessionId) {
        const lastUserMsgIdx = [...reqData.messages]
          .map((m, i) => ({ m, i }))
          .reverse()
          .find((x) => x.m.role === 'user')
        if (lastUserMsgIdx) {
          userContent = lastUserMsgIdx.m.content
          const savedPaths = savedImagePathsByMsgIndex.get(lastUserMsgIdx.i) ?? null
          await this.chatService.addMessage(sessionId, 'user', userContent, savedPaths)
        }
      }

      if (reqData.stream) {
        logger.debug(
          `[OllamaController] Initiating streaming response for model: "${reqData.model}" with think: ${think}`
        )
        // Headers already flushed above.
        // Emit RAG provenance as a leading SSE event before the first Ollama chunk,
        // so the client can render "Sources" chips while generation streams in.
        if (ragSources.length > 0) {
          response.response.write(`data: ${JSON.stringify({ sources: ragSources })}\n\n`)
        }
        // Abort the upstream generation if the client disconnects — otherwise an abandoned
        // request keeps decoding server-side and, with Ollama's default OLLAMA_NUM_PARALLEL=1,
        // blocks every later chat/RAG request until the model is manually stopped (#1065).
        const abortController = new AbortController()
        response.response.on('close', () => abortController.abort())
        const stream = await this.ollamaService.chatStream({
          ...ollamaRequest,
          messages: ollamaMessages,
          think,
          thinkingCapable: thinkingCapability,
          numCtx,
          signal: abortController.signal,
        })
        let fullContent = ''
        try {
          for await (const chunk of stream) {
            if (chunk.message?.content) {
              fullContent += chunk.message.content
            }
            response.response.write(`data: ${JSON.stringify(chunk)}\n\n`)
          }
        } catch (err) {
          if (abortController.signal.aborted) {
            logger.debug(
              '[OllamaController] Client disconnected; aborted upstream Ollama generation'
            )
            return
          }
          throw err
        }
        response.response.end()

        // Save assistant message and optionally generate title
        if (sessionId && fullContent) {
          await this.chatService.addMessage(
            sessionId,
            'assistant',
            fullContent,
            null,
            ragSources.length > 0 ? ragSources : null
          )
          const messageCount = await this.chatService.getMessageCount(sessionId)
          if (messageCount <= 2 && userContent) {
            this.chatService
              .generateTitle(sessionId, userContent, fullContent, reqData.model)
              .catch((err) => {
                logger.error(
                  `[OllamaController] Title generation failed: ${err instanceof Error ? err.message : err}`
                )
              })
          }
        }
        return
      }

      // Non-streaming (legacy) path
      const result = await this.ollamaService.chat({
        ...ollamaRequest,
        messages: ollamaMessages,
        think,
        thinkingCapable: thinkingCapability,
        numCtx,
      })

      if (sessionId && result?.message?.content) {
        await this.chatService.addMessage(
          sessionId,
          'assistant',
          result.message.content,
          null,
          ragSources.length > 0 ? ragSources : null
        )
        const messageCount = await this.chatService.getMessageCount(sessionId)
        if (messageCount <= 2 && userContent) {
          this.chatService
            .generateTitle(sessionId, userContent, result.message.content, reqData.model)
            .catch((err) => {
              logger.error(
                `[OllamaController] Title generation failed: ${err instanceof Error ? err.message : err}`
              )
            })
        }
      }

      return ragSources.length > 0 ? { ...result, sources: ragSources } : result
    } catch (error) {
      if (reqData.stream) {
        response.response.write(`data: ${JSON.stringify({ error: true })}\n\n`)
        response.response.end()
        return
      }
      throw error
    }
  }

  async remoteStatus() {
    const remoteUrl = await KVStore.getValue('ai.remoteOllamaUrl')
    if (!remoteUrl) {
      return { configured: false, connected: false }
    }
    try {
      const testResponse = await fetch(`${remoteUrl.replace(/\/$/, '')}/v1/models`, {
        signal: AbortSignal.timeout(3000),
      })
      return { configured: true, connected: testResponse.ok }
    } catch {
      return { configured: true, connected: false }
    }
  }

  async configureRemote({ request, response }: HttpContext) {
    const remoteUrl: string | null = request.input('remoteUrl', null)

    const ollamaService = await Service.query().where('service_name', SERVICE_NAMES.OLLAMA).first()
    if (!ollamaService) {
      return response
        .status(404)
        .send({ success: false, message: 'Ollama service record not found.' })
    }

    // Clear path: null or empty URL removes remote config. If a local nomad_ollama container
    // still exists (user had previously installed AI Assistant locally), restart it and keep
    // the service marked installed. Otherwise fall back to uninstalled.
    if (!remoteUrl || remoteUrl.trim() === '') {
      await KVStore.clearValue('ai.remoteOllamaUrl')
      const hasLocalContainer = await this._startLocalOllamaContainerIfExists()
      ollamaService.installed = hasLocalContainer
      ollamaService.installation_status = 'idle'
      await ollamaService.save()
      return {
        success: true,
        message: hasLocalContainer
          ? 'Remote Ollama cleared. Local Ollama container restored.'
          : 'Remote Ollama configuration cleared.',
      }
    }

    try {
      assertNotCloudMetadataUrl(remoteUrl)
    } catch (err) {
      return response.status(400).send({
        success: false,
        message: err instanceof Error ? err.message : 'Invalid URL.',
      })
    }

    // Test connectivity via OpenAI-compatible /v1/models endpoint (works with Ollama, LM Studio, llama.cpp, etc.)
    try {
      const testResponse = await fetch(`${remoteUrl.replace(/\/$/, '')}/v1/models`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!testResponse.ok) {
        return response.status(400).send({
          success: false,
          message: `Could not connect to ${remoteUrl} (HTTP ${testResponse.status}). Make sure the server is running and accessible. For Ollama, start it with OLLAMA_HOST=0.0.0.0.`,
        })
      }
    } catch (error) {
      return response.status(400).send({
        success: false,
        message: `Could not connect to ${remoteUrl}. Make sure the server is running and reachable. For Ollama, start it with OLLAMA_HOST=0.0.0.0.`,
      })
    }

    // Save remote URL and mark service as installed
    await KVStore.setValue('ai.remoteOllamaUrl', remoteUrl.trim())
    ollamaService.installed = true
    ollamaService.installation_status = 'idle'
    await ollamaService.save()

    // Stop the local nomad_ollama container (if running) so it doesn't compete with the
    // remote host for GPU / port 11434. Preserves the container and its models volume.
    await this._stopLocalOllamaContainer()

    // Install Qdrant if not already installed (fire-and-forget)
    const qdrantService = await Service.query().where('service_name', SERVICE_NAMES.QDRANT).first()
    if (qdrantService && !qdrantService.installed) {
      this.dockerService.createContainerPreflight(SERVICE_NAMES.QDRANT).catch((error) => {
        logger.error('[OllamaController] Failed to start Qdrant preflight:', error)
      })
    }

    // Mirror post-install side effects: disable suggestions, trigger docs discovery
    await KVStore.setValue('chat.suggestionsEnabled', false)
    this.ragService.discoverNomadDocs().catch((error) => {
      logger.error('[OllamaController] Failed to discover Nomad docs:', error)
    })

    return { success: true, message: 'Remote Ollama configured.' }
  }

  private async _stopLocalOllamaContainer(): Promise<void> {
    try {
      const containers = await this.dockerService.docker.listContainers({ all: true })
      const ollamaContainer = containers.find((c) => c.Names.includes(`/${SERVICE_NAMES.OLLAMA}`))
      if (!ollamaContainer || ollamaContainer.State !== 'running') {
        return
      }
      await this.dockerService.docker.getContainer(ollamaContainer.Id).stop()
      this.dockerService.invalidateServicesStatusCache()
      logger.info('[OllamaController] Stopped local nomad_ollama (remote Ollama configured)')
    } catch (error: any) {
      logger.error(
        { err: error },
        '[OllamaController] Failed to stop local nomad_ollama; remote Ollama is still active'
      )
    }
  }

  private async _startLocalOllamaContainerIfExists(): Promise<boolean> {
    try {
      const containers = await this.dockerService.docker.listContainers({ all: true })
      const ollamaContainer = containers.find((c) => c.Names.includes(`/${SERVICE_NAMES.OLLAMA}`))
      if (!ollamaContainer) {
        return false
      }
      if (ollamaContainer.State !== 'running') {
        await this.dockerService.docker.getContainer(ollamaContainer.Id).start()
        this.dockerService.invalidateServicesStatusCache()
        logger.info('[OllamaController] Started local nomad_ollama (remote Ollama cleared)')
      }
      return true
    } catch (error: any) {
      logger.error(
        { err: error },
        '[OllamaController] Failed to start local nomad_ollama on remote clear'
      )
      return false
    }
  }

  async deleteModel({ request }: HttpContext) {
    const reqData = await request.validateUsing(modelNameSchema)
    await this.ollamaService.deleteModel(reqData.model)
    return {
      success: true,
      message: `Model deleted: ${reqData.model}`,
    }
  }

  async dispatchModelDownload({ request }: HttpContext) {
    const reqData = await request.validateUsing(modelNameSchema)
    await this.ollamaService.dispatchModelDownload(reqData.model)
    return {
      success: true,
      message: `Download job dispatched for model: ${reqData.model}`,
    }
  }

  async installedModels({}: HttpContext) {
    const models = await this.ollamaService.getModels()
    // Enrich each model with its thinking + vision capabilities so the chat picker knows which
    // models to show the per-model thinking toggle and image-attach UI for. checkModelHasThinking
    // / checkModelHasVision share a memoized /api/show cache, so this stays cheap on repeat loads.
    // Best-effort per model.
    const [thinking, vision] = await Promise.all([
      Promise.all(models.map((m) => this.ollamaService.checkModelHasThinking(m.name))),
      Promise.all(models.map((m) => this.ollamaService.checkModelHasVision(m.name))),
    ])
    return models.map((m, i) => ({ ...m, thinking: thinking[i], vision: vision[i] }))
  }

  /**
   * Determines RAG context limits based on model size extracted from the model name.
   * Parses size indicators like "1b", "3b", "8b", "70b" from model names/tags.
   */
  private getContextLimitsForModel(modelName: string): { maxResults: number; maxTokens: number } {
    // Extract parameter count from model name (e.g., "llama3.2:3b", "qwen2.5:1.5b", "gemma:7b")
    const sizeMatch = modelName.match(/(\d+\.?\d*)[bB]/)
    const paramBillions = sizeMatch ? parseFloat(sizeMatch[1]) : 8 // default to 8B if unknown

    for (const tier of RAG_CONTEXT_LIMITS) {
      if (paramBillions <= tier.maxParams) {
        return { maxResults: tier.maxResults, maxTokens: tier.maxTokens }
      }
    }

    // Fallback: no limits
    return { maxResults: 5, maxTokens: 0 }
  }

  /**
   * Build a deduplicated list of source files backing the RAG context, so the
   * client can surface provenance (clickable "Sources" chips under the answer).
   * One entry per distinct source, keeping the highest semantic score observed.
   * Each entry carries a `snippet` — the retrieved passage that was actually
   * injected as context — so the viewer can display it for sources that aren't
   * directly viewable as files (ZIM archives, admin docs, README, etc.).
   * Sources without a usable path are dropped (e.g. legacy points missing the
   * `source` payload field).
   */
  private _collectRagSources(
    docs: Array<{ text: string; score: number; metadata?: Record<string, any> }>
  ): RagSource[] {
    const bySource = new Map<string, RagSource>()
    for (const doc of docs) {
      const source = doc.metadata?.source
      if (!source || typeof source !== 'string' || source.trim().length === 0) continue

      const title =
        (doc.metadata?.full_title as string | undefined) ||
        (doc.metadata?.article_title as string | undefined) ||
        source.split(/[/\\]/).at(-1) ||
        source

      const score =
        typeof doc.metadata?.semantic_score === 'number' ? doc.metadata.semantic_score : doc.score
      const contentType = doc.metadata?.content_type as string | undefined
      const snippet = doc.text.slice(0, 2500)

      const kiwixPath = this._buildKiwixPath(source, contentType, doc.metadata?.article_path)

      const existing = bySource.get(source)
      if (!existing || (score != null && (existing.score == null || score > existing.score))) {
        bySource.set(source, { source, title, contentType, score, snippet, kiwixPath })
      }
    }
    return [...bySource.values()]
  }

  /**
   * Build a Kiwix-serve content path for a ZIM article source. Returns undefined
   * for non-ZIM sources or when the slug/article path can't be resolved.
   *
   * Returns just the path portion (e.g. `/wikipedia_en_all_maxi_2026-02/A/Article_Title`)
   * — the frontend resolves the full URL using the Kiwix service record and the
   * reverse-proxy base domain, so this works with both path-based and subdomain
   * routing.
   */
  private _buildKiwixPath(
    source: string,
    contentType: string | undefined,
    articlePath: string | undefined
  ): string | undefined {
    if (contentType !== 'zim_article') return undefined
    if (!articlePath || typeof articlePath !== 'string' || articlePath.trim().length === 0) {
      return undefined
    }

    const fileName = source.split(/[/\\]/).at(-1) ?? source
    const slug = fileName.replace(/\.zim$/i, '')
    if (!slug) return undefined

    const cleanPath = articlePath.replace(/^\/+/, '')
    return `/${slug}/${cleanPath}`
  }

  private async rewriteQueryWithContext(
    messages: Message[],
    model: string
  ): Promise<string | null> {
    const lastUserMessage = [...messages].reverse().find((msg) => msg.role === 'user')

    try {
      // Skip the entire RAG pipeline if there are no documents to search
      const hasDocuments = await this.ragService.hasDocuments()
      if (!hasDocuments) {
        return null
      }

      // Get recent conversation history (last 6 messages for 3 turns)
      const recentMessages = messages.slice(-6)

      // Skip rewriting on the very first turn — with only one user message
      // there is no prior context to fold in, so the rewrite would just echo
      // the message back at the cost of an extra LLM round-trip. From the
      // first follow-up onward we need the rewrite so the RAG query carries
      // entities and topics from earlier turns ("the bars" → "Hershey's bars
      // chocolate poisoning dog"); without it, embeddings match nothing and
      // the assistant loses the thread.
      const userMessages = recentMessages.filter((msg) => msg.role === 'user')
      if (userMessages.length < 2) {
        return lastUserMessage?.content || null
      }

      const conversationContext = recentMessages
        .map((msg) => {
          const role = msg.role === 'user' ? 'User' : 'Assistant'
          // Truncate assistant messages to first 200 chars to keep context manageable
          const content =
            msg.role === 'assistant'
              ? msg.content.slice(0, 200) + (msg.content.length > 200 ? '...' : '')
              : msg.content
          return `${role}: "${content}"`
        })
        .join('\n')

      const response = await this.ollamaService.chat({
        model,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPTS.query_rewrite,
          },
          {
            role: 'user',
            content: `Conversation:\n${conversationContext}\n\nRewritten Query:`,
          },
        ],
      })

      const rewrittenQuery = response.message.content.trim()
      logger.info(`[RAG] Query rewritten: "${rewrittenQuery}"`)
      return rewrittenQuery
    } catch (error) {
      logger.error(
        `[RAG] Query rewriting failed: ${error instanceof Error ? error.message : error}`
      )
      // Fallback to last user message if rewriting fails
      return lastUserMessage?.content || null
    }
  }
}
