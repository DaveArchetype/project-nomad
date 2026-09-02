import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IconPlayerStop } from '@tabler/icons-react'
import ChatSidebar from './ChatSidebar'
import ChatHeader from './ChatHeader'
import ChatMessageList from './ChatMessageList'
import ChatComposer from './ChatComposer'
import KbPolicyPromptBanner from './KbPolicyPromptBanner'
import StyledModal from '../StyledModal'
import api from '~/lib/api'
import classNames from '~/lib/classNames'
import { ChatMessage } from '../../../types/chat'
import { useChatSessions } from './hooks/useChatSessions'
import { useChatModels } from './hooks/useChatModels'
import { useChatStream } from './hooks/useChatStream'
import { useVoice } from '~/context/VoiceContext'
import {
  stripMarkdownForHighlighting,
  getSentencesWithOffsets,
  type SentenceChunk,
} from '~/lib/voice'

interface ChatProps {
  enabled: boolean
  isInModal?: boolean
  onClose?: () => void
  suggestionsEnabled?: boolean
  streamingEnabled?: boolean
  autoReadReplies?: boolean
}

export default function Chat({
  enabled,
  isInModal,
  onClose,
  suggestionsEnabled = false,
  streamingEnabled = true,
  autoReadReplies = false,
}: ChatProps) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const effectiveThinkingRef = useRef<(model: string) => boolean>(() => false)
  const voice = useVoice()
  const voiceRef = useRef(voice)
  voiceRef.current = voice
  const lastAutoReadMessageIdRef = useRef<string | null>(null)
  const suppressAutoReadRef = useRef(false)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const playingMessageIdRef = useRef<string | null>(null)
  const sentenceQueueRef = useRef<SentenceChunk[]>([])
  const playedSentenceCountRef = useRef(0)
  const isProcessingQueueRef = useRef(false)
  const isStoppedRef = useRef(false)
  const finalFlushDoneRef = useRef<string | null>(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null)
  const [speakingWordIndex, setSpeakingWordIndex] = useState(-1)

  const stopSpeaking = useCallback(() => {
    isStoppedRef.current = true
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current = null
    }
    playingMessageIdRef.current = null
    sentenceQueueRef.current = []
    playedSentenceCountRef.current = 0
    isProcessingQueueRef.current = false
    finalFlushDoneRef.current = null
    setIsSpeaking(false)
    setSpeakingMessageId(null)
    setSpeakingWordIndex(-1)
    voiceRef.current.unmute()
  }, [])

  const processSentenceQueue = useCallback(async (messageId: string) => {
    if (isProcessingQueueRef.current) return
    if (isStoppedRef.current) return
    const next = sentenceQueueRef.current.shift()
    if (!next) {
      isProcessingQueueRef.current = false
      playingMessageIdRef.current = null
      setIsSpeaking(false)
      setSpeakingMessageId(null)
      setSpeakingWordIndex(-1)
      voiceRef.current.unmute()
      return
    }
    isProcessingQueueRef.current = true

    try {
      let blob: Blob | undefined
      for (let attempt = 0; attempt < 3; attempt++) {
        if (isStoppedRef.current || playingMessageIdRef.current !== messageId) break
        try {
          blob = await api.synthesizeSpeech(next.text)
          if (blob) break
        } catch {
          // retry after delay
        }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800))
      }
      if (!blob || isStoppedRef.current || playingMessageIdRef.current !== messageId) {
        playedSentenceCountRef.current++
        isProcessingQueueRef.current = false
        if (sentenceQueueRef.current.length > 0 && !isStoppedRef.current) {
          processSentenceQueue(messageId)
        } else if (sentenceQueueRef.current.length === 0) {
          playingMessageIdRef.current = null
          setIsSpeaking(false)
          setSpeakingMessageId(null)
          setSpeakingWordIndex(-1)
          voiceRef.current.unmute()
        }
        return
      }

      const audio = new Audio(URL.createObjectURL(blob))
      currentAudioRef.current = audio
      const sentenceWords = next.text.split(/\s+/).filter(Boolean)
      const sentenceWordCount = sentenceWords.length

      audio.ontimeupdate = () => {
        if (!audio.duration || sentenceWordCount === 0) return
        const progress = audio.currentTime / audio.duration
        const localIdx = Math.min(sentenceWordCount - 1, Math.floor(progress * sentenceWordCount))
        setSpeakingWordIndex(next.startWordOffset + localIdx)
      }

      audio.onended = () => {
        playedSentenceCountRef.current++
        currentAudioRef.current = null
        isProcessingQueueRef.current = false
        if (!isStoppedRef.current && playingMessageIdRef.current === messageId) {
          processSentenceQueue(messageId)
        }
      }

      audio.onerror = () => {
        currentAudioRef.current = null
        playedSentenceCountRef.current++
        isProcessingQueueRef.current = false
        if (!isStoppedRef.current && playingMessageIdRef.current === messageId) {
          processSentenceQueue(messageId)
        }
      }

      await audio.play().catch(() => {
        currentAudioRef.current = null
        playedSentenceCountRef.current++
        isProcessingQueueRef.current = false
        if (!isStoppedRef.current && playingMessageIdRef.current === messageId) {
          processSentenceQueue(messageId)
        }
      })
    } catch {
      playedSentenceCountRef.current++
      isProcessingQueueRef.current = false
      if (!isStoppedRef.current && playingMessageIdRef.current === messageId) {
        processSentenceQueue(messageId)
      }
    }
  }, [])

  useEffect(() => {
    if (!isMobileSidebarOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMobileSidebarOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isMobileSidebarOpen])

  useEffect(() => {
    api.ensureTeiStarted().catch((err) => {
      console.warn('Failed to ensure TEI started on chat mount:', err)
    })
  }, [])

  useEffect(() => {
    stopSpeaking()
    suppressAutoReadRef.current = true
  }, [activeSessionId, stopSpeaking])

  useEffect(() => {
    if (!autoReadReplies) return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || !last.content.trim()) {
      if (suppressAutoReadRef.current) suppressAutoReadRef.current = false
      return
    }

    if (suppressAutoReadRef.current) {
      suppressAutoReadRef.current = false
      lastAutoReadMessageIdRef.current = last.id
      return
    }

    if (lastAutoReadMessageIdRef.current !== last.id) {
      lastAutoReadMessageIdRef.current = last.id
      playingMessageIdRef.current = last.id
      isStoppedRef.current = false
      sentenceQueueRef.current = []
      playedSentenceCountRef.current = 0
      isProcessingQueueRef.current = false
      finalFlushDoneRef.current = null
      setIsSpeaking(true)
      setSpeakingMessageId(last.id)
      setSpeakingWordIndex(-1)
      voiceRef.current.mute()
    }

    if (playingMessageIdRef.current !== last.id || isStoppedRef.current) return

    if (!last.isStreaming && finalFlushDoneRef.current === last.id) return

    const plainText = stripMarkdownForHighlighting(last.content)
    const allSentences = getSentencesWithOffsets(plainText)
    const alreadyQueuedOrPlayed = playedSentenceCountRef.current + sentenceQueueRef.current.length
    const newSentences = allSentences.slice(alreadyQueuedOrPlayed)

    if (newSentences.length === 0 && !last.isStreaming) {
      finalFlushDoneRef.current = last.id
      return
    }

    if (newSentences.length === 0) return

    if (last.isStreaming && newSentences.length > 0) {
      const complete = newSentences.slice(0, -1)
      for (const s of complete) {
        sentenceQueueRef.current.push(s)
      }
    } else {
      for (const s of newSentences) {
        sentenceQueueRef.current.push(s)
      }
      finalFlushDoneRef.current = last.id
    }

    if (!isProcessingQueueRef.current && sentenceQueueRef.current.length > 0) {
      processSentenceQueue(last.id)
    }
  }, [messages, autoReadReplies, processSentenceQueue])

  useEffect(() => {
    if (!playingMessageIdRef.current) return
    const stillExists = messages.some((m) => m.id === playingMessageIdRef.current)
    if (!stillExists) {
      stopSpeaking()
    }
  }, [messages, stopSpeaking])

  const { data: knownCollections = [] } = useQuery({
    queryKey: ['kbCollections'],
    queryFn: () => api.getKnowledgeCollections(),
    select: (data) => (data as { collections?: string[] } | undefined)?.collections ?? [],
  })

  const stream = useChatStream({
    streamingEnabled,
    selectedModel,
    activeSessionId,
    setActiveSessionId,
    messages,
    setMessages,
    effectiveThinkingRef,
  })

  const models = useChatModels({
    enabled,
    activeSessionId,
    selectedModel,
    setSelectedModel,
    abortStream: stream.abort,
  })

  effectiveThinkingRef.current = models.effectiveThinking

  const sessions = useChatSessions({
    enabled,
    selectedModel,
    activeSessionId,
    setActiveSessionId,
    setMessages,
    setSelectedModel,
    abortStream: stream.abort,
  })

  const { data: chatSuggestions, isLoading: chatSuggestionsLoading } = useQuery<string[]>({
    queryKey: ['chatSuggestions'],
    queryFn: async ({ signal }) => {
      const res = await api.getChatSuggestions(signal)
      return res ?? []
    },
    enabled: suggestionsEnabled && !activeSessionId,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    staleTime: 0,
  })

  const activeSession = sessions.sessions.find((s) => s.id === activeSessionId)
  const isLoading = stream.isStreamingResponse || stream.isPending

  return (
    <>
      {models.pendingModelSwitch && (
        <StyledModal
          title={`Switch to ${models.pendingModelSwitch}?`}
          onConfirm={models.handleConfirmModelSwitch}
          onCancel={models.handleCancelModelSwitch}
          open={true}
          confirmText="Switch Model"
          cancelText="Cancel"
          confirmVariant="primary"
        >
          <p className="text-text-primary">
            Switching to <strong>{models.pendingModelSwitch}</strong> will continue this
            conversation with the new model. Your chat history stays intact.
          </p>
        </StyledModal>
      )}
      <div
        className={classNames(
          'flex border border-border-subtle overflow-hidden shadow-sm w-full',
          isInModal ? 'h-full rounded-lg' : 'h-dvh'
        )}
      >
        <ChatSidebar
          sessions={sessions.sessions}
          activeSessionId={activeSessionId}
          onSessionSelect={sessions.handleSessionSelect}
          onNewChat={sessions.handleNewChat}
          onClearHistory={sessions.handleClearHistory}
          onDeleteSession={sessions.handleDeleteSession}
          isInModal={isInModal}
          isMobileOpen={isMobileSidebarOpen}
          onMobileClose={() => setIsMobileSidebarOpen(false)}
        />
        {isMobileSidebarOpen && (
          <button
            type="button"
            aria-label="Close conversation sidebar"
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
        )}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <KbPolicyPromptBanner />
          <ChatHeader
            activeSessionTitle={activeSession?.title || ''}
            isMobileSidebarOpen={isMobileSidebarOpen}
            onOpenSidebar={() => setIsMobileSidebarOpen(true)}
            isInModal={!!isInModal}
            onClose={() => onClose?.()}
            installedModels={models.installedModels}
            isLoadingModels={models.isLoadingModels}
            selectedModel={selectedModel}
            pendingModelSwitch={models.pendingModelSwitch}
            onUserSelectedModel={models.handleUserSelectedModel}
            selectedModelSupportsThinking={models.selectedModelSupportsThinking}
            effectiveThinking={models.effectiveThinking}
            onSetModelThinking={models.setModelThinking}
            collectionFilter={stream.collectionFilter}
            onCollectionFilterChange={stream.setCollectionFilter}
            knownCollections={knownCollections}
            remoteOllamaUrl={models.remoteOllamaUrlSetting?.value}
            remoteStatus={models.remoteStatus}
          />
          <ChatMessageList
            messages={messages}
            resetKey={activeSessionId}
            isLoading={isLoading}
            chatSuggestions={chatSuggestions}
            chatSuggestionsEnabled={suggestionsEnabled}
            chatSuggestionsLoading={chatSuggestionsLoading}
            onSuggestionClick={(suggestion) => stream.handleSendMessage(suggestion)}
            speakingMessageId={speakingMessageId}
            speakingWordIndex={speakingWordIndex}
            onStopSpeaking={stopSpeaking}
          />
          {isSpeaking && (
            <div className="flex items-center justify-between gap-3 px-4 py-2 bg-desert-green/10 border-t border-desert-green/30">
              <span className="text-sm text-desert-green font-medium animate-pulse">
                Speaking...
              </span>
              <button
                type="button"
                onClick={stopSpeaking}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-desert-green text-white hover:bg-desert-green/90 transition-colors cursor-pointer"
              >
                <IconPlayerStop className="size-4" />
                Stop
              </button>
            </div>
          )}
          <ChatComposer
            isLoading={isLoading}
            onSendMessage={stream.handleSendMessage}
            rewriteModelAvailable={models.rewriteModelAvailable}
            isCheckingModels={models.isLoadingModels}
            selectedModelSupportsVision={models.selectedModelSupportsVision}
            selectedModelSupportsTools={models.selectedModelSupportsTools}
            voiceCommand={voice.lastWakeCommand}
          />
        </div>
      </div>
    </>
  )
}
