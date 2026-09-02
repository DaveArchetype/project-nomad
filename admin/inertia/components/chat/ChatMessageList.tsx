import { IconWand } from '@tabler/icons-react'
import classNames from '~/lib/classNames'
import { ChatMessage } from '../../../types/chat'
import ChatMessageBubble from './ChatMessageBubble'
import ChatAssistantAvatar from './ChatAssistantAvatar'
import BouncingDots from '../BouncingDots'
import { useAutoScroll } from './hooks/useAutoScroll'

interface ChatMessageListProps {
  messages: ChatMessage[]
  resetKey: string | null
  isLoading: boolean
  chatSuggestions?: string[]
  chatSuggestionsEnabled?: boolean
  chatSuggestionsLoading?: boolean
  onSuggestionClick: (suggestion: string) => void
  speakingMessageId?: string | null
  speakingWordIndex?: number
  onStopSpeaking?: () => void
}

export default function ChatMessageList({
  messages,
  resetKey,
  isLoading,
  chatSuggestions = [],
  chatSuggestionsEnabled = false,
  chatSuggestionsLoading = false,
  onSuggestionClick,
  speakingMessageId,
  speakingWordIndex,
  onStopSpeaking,
}: ChatMessageListProps) {
  const { containerRef, setMessageRef } = useAutoScroll(messages, resetKey)

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4">
        <div className="h-full flex items-center justify-center">
          <div className="text-center max-w-md">
            <IconWand className="h-16 w-16 text-desert-green mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-text-primary mb-2">Start a conversation</h3>
            <p className="text-text-muted text-sm">
              Interact with your installed language models directly in the Command Center.
            </p>
            {chatSuggestionsEnabled &&
              chatSuggestions &&
              chatSuggestions.length > 0 &&
              !chatSuggestionsLoading && (
                <div className="mt-8">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-text-secondary">Try one of these:</h4>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {chatSuggestions.map((suggestion, index) => (
                      <button
                        key={index}
                        onClick={() => onSuggestionClick(suggestion)}
                        className="group flex items-start gap-2.5 px-4 py-3 bg-surface-secondary hover:bg-desert-orange/10 hover:border-desert-orange/40 border border-border-subtle cursor-pointer rounded-lg text-sm text-text-primary transition-all text-left"
                      >
                        <IconWand className="h-4 w-4 shrink-0 mt-0.5 text-text-muted group-hover:text-desert-orange transition-colors" />
                        <span>{suggestion}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            {chatSuggestionsEnabled && chatSuggestionsLoading && (
              <BouncingDots text="Thinking" containerClassName="mt-8" />
            )}
            {!chatSuggestionsEnabled && (
              <div className="mt-8 text-sm text-text-muted">
                Need some inspiration? Enable chat suggestions in settings to get started with
                example prompts.
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-4 space-y-4 sm:space-y-6"
    >
      {messages.map((message) => (
        <div
          key={message.id}
          ref={setMessageRef(message.id)}
          className={classNames(
            'flex gap-2 sm:gap-4 min-w-0',
            message.role === 'user' ? 'justify-end' : 'justify-start'
          )}
        >
          {message.role === 'assistant' && <ChatAssistantAvatar />}
          <ChatMessageBubble
            message={message}
            speakingWordIndex={speakingMessageId === message.id ? (speakingWordIndex ?? -1) : -1}
            isAutoReading={speakingMessageId === message.id}
            onStopAutoReading={onStopSpeaking}
          />
        </div>
      ))}
      {isLoading && (
        <div className="flex gap-2 sm:gap-4 justify-start min-w-0">
          <ChatAssistantAvatar />
          <div className="max-w-[92%] sm:max-w-[90%] min-w-0 rounded-lg px-4 py-3 bg-surface-secondary text-text-primary">
            <BouncingDots text="Thinking" />
          </div>
        </div>
      )}
    </div>
  )
}
