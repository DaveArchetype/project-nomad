import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '~/lib/api'
import { useModals } from '~/context/ModalContext'
import StyledModal from '../../StyledModal'
import { ChatMessage } from '../../../../types/chat'

interface UseChatSessionsResult {
  sessions: Array<{ id: string; title: string; model?: string; timestamp: Date; lastMessage?: string }>
  handleNewChat: () => void
  handleClearHistory: () => void
  handleDeleteSession: (session: { id: string; title: string }) => void
  handleSessionSelect: (sessionId: string) => Promise<void>
}

interface UseChatSessionsArgs {
  enabled: boolean
  selectedModel: string
  activeSessionId: string | null
  setActiveSessionId: (id: string | null) => void
  setMessages: (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  setSelectedModel: (model: string) => void
  abortStream: () => void
}

export function useChatSessions({
  enabled,
  selectedModel,
  activeSessionId,
  setActiveSessionId,
  setMessages,
  setSelectedModel,
  abortStream,
}: UseChatSessionsArgs): UseChatSessionsResult {
  const queryClient = useQueryClient()
  const { openModal, closeAllModals } = useModals()

  const { data: sessions = [] } = useQuery({
    queryKey: ['chatSessions'],
    queryFn: () => api.getChatSessions(),
    enabled,
    select: (data) =>
      data?.map((s) => ({
        id: s.id,
        title: s.title,
        model: s.model || undefined,
        timestamp: new Date(s.timestamp),
        lastMessage: s.lastMessage || undefined,
      })) || [],
  })

  const deleteAllSessionsMutation = useMutation({
    mutationFn: () => api.deleteAllChatSessions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] })
      abortStream()
      setActiveSessionId(null)
      setMessages([])
      closeAllModals()
    },
  })

  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => api.deleteChatSession(sessionId),
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] })
      if (activeSessionId === sessionId) {
        abortStream()
        setActiveSessionId(null)
        setMessages([])
      }
      closeAllModals()
    },
  })

  const handleNewChat = useCallback(() => {
    abortStream()
    setActiveSessionId(null)
    setMessages([])
  }, [abortStream, setActiveSessionId, setMessages])

  const handleClearHistory = useCallback(() => {
    openModal(
      <StyledModal
        title="Clear All Chat History?"
        onConfirm={() => deleteAllSessionsMutation.mutate()}
        onCancel={closeAllModals}
        open={true}
        confirmText="Clear All"
        cancelText="Cancel"
        confirmVariant="danger"
      >
        <p className="text-text-primary">
          Are you sure you want to delete all chat sessions? This action cannot be undone and all
          conversations will be permanently deleted.
        </p>
      </StyledModal>,
      'confirm-clear-history-modal'
    )
  }, [openModal, closeAllModals, deleteAllSessionsMutation])

  const handleDeleteSession = useCallback(
    (session: { id: string; title: string }) => {
      openModal(
        <StyledModal
          title="Delete Conversation?"
          onConfirm={() => deleteSessionMutation.mutate(session.id)}
          onCancel={closeAllModals}
          open={true}
          confirmText="Delete"
          cancelText="Cancel"
          confirmVariant="danger"
        >
          <p className="text-text-primary">
            Are you sure you want to delete "{session.title}"? This action cannot be undone and the
            conversation will be permanently deleted.
          </p>
        </StyledModal>,
        'confirm-delete-session-modal'
      )
    },
    [openModal, closeAllModals, deleteSessionMutation]
  )

  const handleSessionSelect = useCallback(
    async (sessionId: string) => {
      queryClient.cancelQueries({ queryKey: ['chatSuggestions'] })
      abortStream()

      setActiveSessionId(sessionId)
      const sessionData = await api.getChatSession(sessionId)
      if (sessionData?.messages) {
        setMessages(
          sessionData.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(m.timestamp),
          }))
        )
      } else {
        setMessages([])
      }

      if (sessionData?.model) {
        setSelectedModel(sessionData.model)
      }

      const targetModel = sessionData?.model ?? selectedModel ?? null
      api.unloadChatModels(targetModel).catch((err) => {
        console.warn('Failed to unload non-target chat models on session switch:', err)
      })
    },
    [queryClient, abortStream, setActiveSessionId, setMessages, setSelectedModel, selectedModel]
  )

  return {
    sessions,
    handleNewChat,
    handleClearHistory,
    handleDeleteSession,
    handleSessionSelect,
  }
}
