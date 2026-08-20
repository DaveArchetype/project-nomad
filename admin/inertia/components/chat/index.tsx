import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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

interface ChatProps {
  enabled: boolean
  isInModal?: boolean
  onClose?: () => void
  suggestionsEnabled?: boolean
  streamingEnabled?: boolean
}

export default function Chat({
  enabled,
  isInModal,
  onClose,
  suggestionsEnabled = false,
  streamingEnabled = true,
}: ChatProps) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const effectiveThinkingRef = useRef<(model: string) => boolean>(() => false)

  useEffect(() => {
    if (!isMobileSidebarOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMobileSidebarOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isMobileSidebarOpen])

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

  const clearActiveSession = useCallback(() => {
    stream.abort()
    setActiveSessionId(null)
    setMessages([])
  }, [stream.abort])

  const models = useChatModels({
    enabled,
    activeSessionId,
    selectedModel,
    setSelectedModel,
    abortStream: stream.abort,
    clearActiveSession,
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
          confirmText="Switch & New Chat"
          cancelText="Cancel"
          confirmVariant="primary"
        >
          <p className="text-text-primary">
            Switching to <strong>{models.pendingModelSwitch}</strong> will start a new chat. Your
            current conversation stays available in the sidebar.
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
          />
          <ChatComposer
            isLoading={isLoading}
            onSendMessage={stream.handleSendMessage}
            rewriteModelAvailable={models.rewriteModelAvailable}
          />
        </div>
      </div>
    </>
  )
}
