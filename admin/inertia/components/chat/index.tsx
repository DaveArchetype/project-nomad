import { useEffect, useRef, useState } from 'react'
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
  const lastAutoReadMessageIdRef = useRef<string | null>(null)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const playingMessageIdRef = useRef<string | null>(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null)
  const [speakingWordIndex, setSpeakingWordIndex] = useState(-1)

  const stopSpeaking = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current = null
    }
    playingMessageIdRef.current = null
    setIsSpeaking(false)
    setSpeakingMessageId(null)
    setSpeakingWordIndex(-1)
    voice.unmute()
  }

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
    if (!autoReadReplies) return
    const last = messages[messages.length - 1]
    if (
      !last ||
      last.role !== 'assistant' ||
      last.isStreaming ||
      !last.content.trim() ||
      lastAutoReadMessageIdRef.current === last.id
    ) {
      return
    }
    lastAutoReadMessageIdRef.current = last.id
    playingMessageIdRef.current = last.id
    setIsSpeaking(true)
    setSpeakingMessageId(last.id)
    setSpeakingWordIndex(-1)

    const words = last.content.split(/\s+/).filter(Boolean)
    const wordCount = words.length

    voice.mute()

    api
      .synthesizeSpeech(last.content)
      .then((blob) => {
        if (!blob) return
        if (playingMessageIdRef.current !== last.id) return
        if (currentAudioRef.current) {
          currentAudioRef.current.pause()
          currentAudioRef.current = null
        }
        const audio = new Audio(URL.createObjectURL(blob))
        currentAudioRef.current = audio

        audio.ontimeupdate = () => {
          if (!audio.duration || wordCount === 0) return
          const progress = audio.currentTime / audio.duration
          const idx = Math.min(wordCount - 1, Math.floor(progress * wordCount))
          setSpeakingWordIndex(idx)
        }

        audio.onended = () => {
          if (playingMessageIdRef.current === last.id) {
            playingMessageIdRef.current = null
          }
          setIsSpeaking(false)
          setSpeakingMessageId(null)
          setSpeakingWordIndex(-1)
          voice.unmute()
          currentAudioRef.current = null
        }
        audio.onerror = () => {
          if (playingMessageIdRef.current === last.id) {
            playingMessageIdRef.current = null
          }
          setIsSpeaking(false)
          setSpeakingMessageId(null)
          setSpeakingWordIndex(-1)
          voice.unmute()
          currentAudioRef.current = null
        }
        audio.play().catch(() => {
          if (playingMessageIdRef.current === last.id) {
            playingMessageIdRef.current = null
          }
          setIsSpeaking(false)
          setSpeakingMessageId(null)
          setSpeakingWordIndex(-1)
          voice.unmute()
          currentAudioRef.current = null
        })
      })
      .catch(() => {
        playingMessageIdRef.current = null
        setIsSpeaking(false)
        setSpeakingMessageId(null)
        setSpeakingWordIndex(-1)
        voice.unmute()
      })
  }, [messages, autoReadReplies, voice])

  useEffect(() => {
    if (!playingMessageIdRef.current) return
    const stillExists = messages.some((m) => m.id === playingMessageIdRef.current)
    if (!stillExists) {
      stopSpeaking()
    }
  }, [messages])

  const { data: knownCollections = [] } = useQuery({
    queryKey: ['kbCollections'],
    queryFn: () => api.getKnowledgeCollections(),
    select: (data) => data?.collections ?? [],
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
    refetchOnMount: false,
    staleTime: 30 * 60 * 1000,
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
            voiceCommand={voice.lastWakeCommand}
          />
        </div>
      </div>
    </>
  )
}
