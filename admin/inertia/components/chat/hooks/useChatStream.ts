import { useCallback, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '~/lib/api'
import { ChatMessage } from '../../../../types/chat'

interface UseChatStreamResult {
  handleSendMessage: (content: string, images?: string[]) => Promise<void>
  isStreamingResponse: boolean
  isPending: boolean
  collectionFilter: string
  setCollectionFilter: (value: string) => void
  abort: () => void
}

interface UseChatStreamArgs {
  streamingEnabled: boolean
  selectedModel: string
  activeSessionId: string | null
  setActiveSessionId: (id: string | null) => void
  messages: ChatMessage[]
  setMessages: (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  effectiveThinkingRef: React.MutableRefObject<(model: string) => boolean>
}

export function useChatStream({
  streamingEnabled,
  selectedModel,
  activeSessionId,
  setActiveSessionId,
  messages,
  setMessages,
  effectiveThinkingRef,
}: UseChatStreamArgs): UseChatStreamResult {
  const queryClient = useQueryClient()
  const [collectionFilter, setCollectionFilter] = useState<string>('')
  const [isStreamingResponse, setIsStreamingResponse] = useState(false)
  const streamAbortRef = useRef<AbortController | null>(null)
  const isSendingRef = useRef(false)
  const streamingSessionIdRef = useRef<string | null>(null)

  const abort = useCallback(() => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort()
      streamAbortRef.current = null
    }
    setIsStreamingResponse(false)
    isSendingRef.current = false
    streamingSessionIdRef.current = null
  }, [])

  const chatMutation = useMutation({
    mutationFn: (request: {
      model: string
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string; images?: string[] }>
      sessionId?: number
      think?: boolean
      collection?: string
    }) => api.sendChatMessage({ ...request, stream: false }),
    onSuccess: async (data) => {
      if (!data || !activeSessionId) {
        throw new Error('No response from Ollama')
      }

      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        content: data.message?.content || 'Sorry, I could not generate a response.',
        timestamp: new Date(),
        sources: data.sources,
      }

      setMessages((prev) => [...prev, assistantMessage])

      queryClient.invalidateQueries({ queryKey: ['chatSessions'] })
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['chatSessions'] }), 3000)
    },
    onError: (error) => {
      console.error('Error sending message:', error)
      const errorMessage: ChatMessage = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: 'Sorry, there was an error processing your request. Please try again.',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    },
  })

  const { mutate: chatMutate, isPending: chatIsPending } = chatMutation

  const handleSendMessage = useCallback(
    async (content: string, images?: string[]) => {
      if (isSendingRef.current) return
      isSendingRef.current = true

      let sessionId = activeSessionId

      if (!sessionId) {
        const newSession = await api.createChatSession('New Chat', selectedModel)
        if (newSession) {
          sessionId = newSession.id
          setActiveSessionId(sessionId)
          queryClient.invalidateQueries({ queryKey: ['chatSessions'] })
        } else {
          isSendingRef.current = false
          return
        }
      }

      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date(),
        images: images && images.length > 0 ? images : undefined,
      }

      setMessages((prev) => [...prev, userMessage])

      const chatMessages = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        {
          role: 'user' as const,
          content,
          images: images && images.length > 0 ? images : undefined,
        },
      ]

      if (streamingEnabled !== false) {
        const abortController = new AbortController()
        streamAbortRef.current = abortController
        streamingSessionIdRef.current = sessionId

        setIsStreamingResponse(true)

        const assistantMsgId = `msg-${Date.now()}-assistant`
        let isFirstChunk = true
        let fullContent = ''
        let thinkingContent = ''
        let isThinkingPhase = true
        let thinkingStartTime: number | null = null
        let thinkingDuration: number | null = null
        // RAG provenance arrives as a leading SSE event before the first content
        // chunk. Stash it here so the first-chunk message creation can include it;
        // if it arrives after the message exists (rare reordering), apply directly.
        let pendingSources: ChatMessage['sources'] | null = null

        try {
          await api.streamChatMessage(
            {
              model: selectedModel || 'llama3.2',
              messages: chatMessages,
              stream: true,
              sessionId: sessionId ? Number(sessionId) : undefined,
              think: effectiveThinkingRef.current(selectedModel),
              collection: collectionFilter || undefined,
            },
            (chunkContent, chunkThinking, done) => {
              if (streamingSessionIdRef.current !== sessionId) return
              if (chunkThinking.length > 0 && thinkingStartTime === null) {
                thinkingStartTime = Date.now()
              }
              if (isFirstChunk) {
                isFirstChunk = false
                setIsStreamingResponse(false)
                setMessages((prev) => [
                  ...prev,
                  {
                    id: assistantMsgId,
                    role: 'assistant',
                    content: chunkContent,
                    thinking: chunkThinking,
                    timestamp: new Date(),
                    isStreaming: true,
                    isThinking: chunkThinking.length > 0 && chunkContent.length === 0,
                    thinkingDuration: undefined,
                    sources: pendingSources ?? undefined,
                  },
                ])
              } else {
                if (isThinkingPhase && chunkContent.length > 0) {
                  isThinkingPhase = false
                  if (thinkingStartTime !== null) {
                    thinkingDuration = Math.max(
                      1,
                      Math.round((Date.now() - thinkingStartTime) / 1000)
                    )
                  }
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          content: m.content + chunkContent,
                          thinking: (m.thinking ?? '') + chunkThinking,
                          isStreaming: !done,
                          isThinking: isThinkingPhase,
                          thinkingDuration: thinkingDuration ?? undefined,
                        }
                      : m
                  )
                )
              }
              fullContent += chunkContent
              thinkingContent += chunkThinking
            },
            abortController.signal,
            (sources) => {
              if (streamingSessionIdRef.current !== sessionId) return
              if (isFirstChunk) {
                pendingSources = sources
              } else {
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMsgId ? { ...m, sources } : m))
                )
              }
            }
          )
        } catch (error: any) {
          const isAbort =
            error?.name === 'AbortError' ||
            abortController.signal.aborted ||
            (error instanceof TypeError && error.message.includes('fetch'))
          if (!isAbort) {
            setMessages((prev) => {
              const hasAssistantMsg = prev.some((m) => m.id === assistantMsgId)
              if (hasAssistantMsg) {
                return prev.map((m) => (m.id === assistantMsgId ? { ...m, isStreaming: false } : m))
              }
              return [
                ...prev,
                {
                  id: assistantMsgId,
                  role: 'assistant',
                  content: 'Sorry, there was an error processing your request. Please try again.',
                  timestamp: new Date(),
                },
              ]
            })
          }
        } finally {
          setIsStreamingResponse(false)
          streamAbortRef.current = null
          isSendingRef.current = false
          streamingSessionIdRef.current = null
        }

        if (fullContent && sessionId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, isStreaming: false } : m))
          )

          queryClient.invalidateQueries({ queryKey: ['chatSessions'] })
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ['chatSessions'] }), 3000)
        }
      } else {
        chatMutate({
          model: selectedModel || 'llama3.2',
          messages: chatMessages,
          sessionId: sessionId ? Number(sessionId) : undefined,
          think: effectiveThinkingRef.current(selectedModel),
          collection: collectionFilter || undefined,
        })
        isSendingRef.current = false
      }
    },
    [
      activeSessionId,
      messages,
      selectedModel,
      collectionFilter,
      chatMutate,
      queryClient,
      streamingEnabled,
      effectiveThinkingRef,
      setActiveSessionId,
      setMessages,
    ]
  )

  return {
    handleSendMessage,
    isStreamingResponse,
    isPending: chatIsPending,
    collectionFilter,
    setCollectionFilter,
    abort,
  }
}
