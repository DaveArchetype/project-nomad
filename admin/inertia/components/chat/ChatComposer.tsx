import { useState, useRef, useCallback } from 'react'
import { IconSend, IconPhotoPlus, IconX } from '@tabler/icons-react'
import classNames from '~/lib/classNames'
import { usePage } from '@inertiajs/react'
import { useNotifications } from '~/context/NotificationContext'
import { useIsMobileViewport } from '~/hooks/useIsMobileViewport'
import StyledModal from '../StyledModal'
import ImageViewerModal from './ImageViewerModal'
import api from '~/lib/api'
import { DEFAULT_QUERY_REWRITE_MODEL } from '../../../constants/ollama'

interface ChatComposerProps {
  isLoading: boolean
  onSendMessage: (message: string, images?: string[]) => void
  rewriteModelAvailable: boolean
  isCheckingModels: boolean
  selectedModelSupportsVision: boolean
}

const MAX_IMAGE_DIM = 1024
const JPEG_QUALITY = 0.85
const MAX_ATTACHMENTS = 4

export default function ChatComposer({
  isLoading,
  onSendMessage,
  rewriteModelAvailable,
  isCheckingModels,
  selectedModelSupportsVision,
}: ChatComposerProps) {
  const { aiAssistantName } = usePage<{ aiAssistantName: string }>().props
  const { addNotification } = useNotifications()
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const isMobile = useIsMobileViewport()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const downscaleImage = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.onload = () => {
        const img = new Image()
        img.onerror = () => reject(new Error('Failed to load image'))
        img.onload = () => {
          let { width, height } = img
          if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
            const scale = MAX_IMAGE_DIM / Math.max(width, height)
            width = Math.round(width * scale)
            height = Math.round(height * scale)
          }
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            reject(new Error('Canvas not supported'))
            return
          }
          ctx.drawImage(img, 0, 0, width, height)
          // Keep PNG for transparency; everything else becomes JPEG for size.
          const isPng = file.type === 'image/png'
          const dataUrl = isPng
            ? canvas.toDataURL('image/png')
            : canvas.toDataURL('image/jpeg', JPEG_QUALITY)
          resolve(dataUrl)
        }
        img.src = reader.result as string
      }
      reader.readAsDataURL(file)
    })
  }, [])

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (imageFiles.length === 0) return
      setAttachments((prev) => {
        const remaining = MAX_ATTACHMENTS - prev.length
        if (remaining <= 0) {
          addNotification({
            type: 'info',
            message: `You can attach up to ${MAX_ATTACHMENTS} images per message.`,
          })
          return prev
        }
        return prev
      })
      const toProcess = imageFiles.slice(0, Math.max(0, MAX_ATTACHMENTS - attachments.length))
      const results: string[] = []
      for (const file of toProcess) {
        try {
          const dataUrl = await downscaleImage(file)
          results.push(dataUrl)
        } catch {
          addNotification({ type: 'error', message: `Failed to process image: ${file.name}` })
        }
      }
      if (results.length > 0) {
        setAttachments((prev) => [...prev, ...results].slice(0, MAX_ATTACHMENTS))
      }
    },
    [attachments.length, addNotification, downscaleImage]
  )

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const hasText = input.trim().length > 0
    const hasImages = attachments.length > 0
    if ((hasText || hasImages) && !isLoading) {
      onSendMessage(hasText ? input.trim() : '', attachments.length > 0 ? attachments : undefined)
      setInput('')
      setAttachments([])
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

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!selectedModelSupportsVision) return
    const items = e.clipboardData?.items
    if (!items) return
    const imageItems: DataTransferItem[] = []
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) imageItems.push(item)
    }
    if (imageItems.length === 0) return
    e.preventDefault()
    const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null)
    if (files.length > 0) {
      handleFiles(files)
    }
  }

  const hasText = input.trim().length > 0
  const hasImages = attachments.length > 0
  const canSend = (hasText || hasImages) && !isLoading

  return (
    <div className="border-t border-border-subtle bg-surface-primary px-3 sm:px-6 py-3 sm:py-4 shrink-0">
      {hasImages && (
        <div className="flex gap-2 mb-2 overflow-x-auto sm:flex-wrap sm:overflow-visible">
          {attachments.map((dataUrl, idx) => (
            <div key={`${dataUrl.slice(0, 32)}-${idx}`} className="relative group shrink-0">
              <button
                type="button"
                onClick={() => setPreviewIndex(idx)}
                className="block rounded-md overflow-hidden border border-border-default hover:opacity-90 transition-opacity"
              >
                <img
                  src={dataUrl}
                  alt={`Attachment ${idx + 1}`}
                  className="h-14 w-14 object-cover"
                />
              </button>
              <button
                type="button"
                onClick={() => removeAttachment(idx)}
                aria-label={`Remove attachment ${idx + 1}`}
                className="absolute -top-1.5 -right-1.5 flex items-center justify-center h-5 w-5 rounded-full bg-surface-secondary border border-border-default text-text-primary hover:bg-surface-tertiary shadow-sm"
              >
                <IconX className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex gap-3 items-center">
        {selectedModelSupportsVision && (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || attachments.length >= MAX_ATTACHMENTS}
              aria-label="Attach images"
              title="Attach images"
              className={classNames(
                'flex items-center justify-center rounded-lg transition-all duration-200 shrink-0 border',
                isLoading || attachments.length >= MAX_ATTACHMENTS
                  ? 'bg-surface-secondary text-text-muted border-border-default cursor-not-allowed'
                  : 'bg-surface-secondary text-text-secondary border-border-default hover:text-desert-green hover:border-desert-green'
              )}
              style={{ height: '50px', width: '50px' }}
            >
              <IconPhotoPlus className="h-6 w-6" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </>
        )}
        <div className="flex-1 relative min-w-0">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={`Type here...${isMobile ? '' : ' (Shift+Enter for new line)'}`}
            className="block w-full resize-none rounded-lg border border-border-default px-4 py-3 leading-6 focus:outline-none focus:ring-2 focus:ring-desert-green focus:border-transparent disabled:bg-surface-secondary disabled:text-text-muted"
            rows={1}
            disabled={isLoading}
            style={{ minHeight: '50px', maxHeight: '200px' }}
          />
        </div>
        <button
          type="submit"
          disabled={!canSend}
          className={classNames(
            'flex items-center justify-center rounded-lg transition-all duration-200 shrink-0',
            !canSend
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
      {previewIndex !== null && (
        <ImageViewerModal
          images={attachments.map((url) => ({ url }))}
          startIndex={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  )
}
