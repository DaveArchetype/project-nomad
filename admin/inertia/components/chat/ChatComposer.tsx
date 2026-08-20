import { useState, useRef } from 'react'
import { IconSend } from '@tabler/icons-react'
import classNames from '~/lib/classNames'
import { usePage } from '@inertiajs/react'
import { useNotifications } from '~/context/NotificationContext'
import { useIsMobileViewport } from '~/hooks/useIsMobileViewport'
import StyledModal from '../StyledModal'
import api from '~/lib/api'
import { DEFAULT_QUERY_REWRITE_MODEL } from '../../../constants/ollama'

interface ChatComposerProps {
  isLoading: boolean
  onSendMessage: (message: string) => void
  rewriteModelAvailable: boolean
  isCheckingModels: boolean
}

export default function ChatComposer({
  isLoading,
  onSendMessage,
  rewriteModelAvailable,
  isCheckingModels,
}: ChatComposerProps) {
  const { aiAssistantName } = usePage<{ aiAssistantName: string }>().props
  const { addNotification } = useNotifications()
  const [input, setInput] = useState('')
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const isMobile = useIsMobileViewport()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleDownloadModel = async () => {
    setIsDownloading(true)
    try {
      await api.downloadModel(DEFAULT_QUERY_REWRITE_MODEL)
      addNotification({ type: 'success', message: 'Model download queued' })
    } catch (error) {
      addNotification({ type: 'error', message: 'Failed to queue model download' })
    } finally {
      setIsDownloading(false)
      setDownloadDialogOpen(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim())
      setInput('')
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`
  }

  return (
    <div className="border-t border-border-subtle bg-surface-primary px-3 sm:px-6 py-3 sm:py-4 shrink-0">
      <form onSubmit={handleSubmit} className="flex gap-3 items-center">
        <div className="flex-1 relative min-w-0">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={`Type your message to ${aiAssistantName}...${
              isMobile ? '' : ' (Shift+Enter for new line)'
            }`}
            className="block w-full resize-none rounded-lg border border-border-default px-4 py-3 leading-6 focus:outline-none focus:ring-2 focus:ring-desert-green focus:border-transparent disabled:bg-surface-secondary disabled:text-text-muted"
            rows={1}
            disabled={isLoading}
            style={{ minHeight: '50px', maxHeight: '200px' }}
          />
        </div>
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className={classNames(
            'flex items-center justify-center rounded-lg transition-all duration-200 shrink-0',
            !input.trim() || isLoading
              ? 'bg-border-default text-text-muted cursor-not-allowed'
              : 'bg-desert-green text-white hover:bg-desert-green/90 hover:scale-105'
          )}
          style={{ height: '50px', width: '50px' }}
        >
          {isLoading ? (
            <div className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <IconSend className="h-6 w-6" />
          )}
        </button>
      </form>
      {!isCheckingModels && !rewriteModelAvailable && (
        <div className="text-sm text-text-muted mt-2">
          The {DEFAULT_QUERY_REWRITE_MODEL} model is not installed. Consider{' '}
          <button
            onClick={() => setDownloadDialogOpen(true)}
            className="text-desert-green underline hover:text-desert-green/80 cursor-pointer"
          >
            downloading it
          </button>{' '}
          for improved retrieval-augmented generation (RAG) performance.
        </div>
      )}
      <StyledModal
        open={downloadDialogOpen}
        title={`Download ${DEFAULT_QUERY_REWRITE_MODEL}?`}
        confirmText="Download"
        cancelText="Cancel"
        confirmIcon="IconDownload"
        confirmVariant="primary"
        confirmLoading={isDownloading}
        onConfirm={handleDownloadModel}
        onCancel={() => setDownloadDialogOpen(false)}
        onClose={() => setDownloadDialogOpen(false)}
      >
        <p className="text-text-primary">
          This will dispatch a background download job for{' '}
          <span className="font-mono font-medium">{DEFAULT_QUERY_REWRITE_MODEL}</span> and may take
          some time to complete. The model will be used to rewrite queries for improved RAG
          retrieval performance. Note that download is only supported when using Ollama. If using an
          OpenAI API interface, please download the model with that software.
        </p>
      </StyledModal>
    </div>
  )
}
