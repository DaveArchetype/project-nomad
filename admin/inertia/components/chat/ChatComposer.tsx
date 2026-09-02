import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  IconSend,
  IconPhotoPlus,
  IconX,
  IconPlus,
  IconTools,
  IconWorld,
  IconCalculator,
  IconClock,
  IconPhoto,
  IconAutomation,
} from '@tabler/icons-react'
import classNames from '~/lib/classNames'
import { useNotifications } from '~/context/NotificationContext'
import { useIsMobileViewport } from '~/hooks/useIsMobileViewport'
import StyledModal from '../StyledModal'
import ImageViewerModal from './ImageViewerModal'
import api from '~/lib/api'
import { DEFAULT_QUERY_REWRITE_MODEL } from '../../../constants/ollama'

interface ChatComposerProps {
  isLoading: boolean
  onSendMessage: (message: string, images?: string[], tools?: string[]) => void
  rewriteModelAvailable: boolean
  isCheckingModels: boolean
  selectedModelSupportsVision: boolean
  selectedModelSupportsTools: boolean
  /**
   * Set (with a fresh timestamp) when the Voice Assistant wake word fires while on this page —
   * prefills and focuses the composer with the transcribed utterance instead of auto-sending it,
   * so the user can review/edit before it goes to the model.
   */
  voiceCommand?: { text: string; at: number } | null
}

const MAX_IMAGE_DIM = 1024
const JPEG_QUALITY = 0.85
const MAX_ATTACHMENTS = 4

const TOOL_DEFS = [
  {
    key: 'internet',
    label: 'Internet',
    icon: IconWorld,
    tools: ['web_search', 'web_fetch'],
  },
  {
    key: 'image_gen',
    label: 'Image generation',
    icon: IconPhoto,
    tools: ['generate_image'],
  },
  {
    key: 'current_time',
    label: 'Current time',
    icon: IconClock,
    tools: ['current_time'],
  },
  {
    key: 'calculator',
    label: 'Calculator',
    icon: IconCalculator,
    tools: ['calculator'],
  },
  {
    key: 'manage_automations',
    label: 'Automations',
    icon: IconAutomation,
    tools: ['manage_automations'],
  },
] as const

export default function ChatComposer({
  isLoading,
  onSendMessage,
  rewriteModelAvailable,
  isCheckingModels,
  selectedModelSupportsVision,
  selectedModelSupportsTools,
  voiceCommand,
}: ChatComposerProps) {
  const { addNotification } = useNotifications()
  const [input, setInput] = useState('')
  const lastVoiceCommandAtRef = useRef<number | null>(null)
  const [attachments, setAttachments] = useState<string[]>([])
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [enabledToolKeys, setEnabledToolKeys] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('nomad:agentTools')
      if (stored) return new Set(JSON.parse(stored))
    } catch {}
    return new Set()
  })
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [toolsPopoverOpen, setToolsPopoverOpen] = useState(false)

  const { data: imageGenStatus } = useQuery({
    queryKey: ['imageGenStatus'],
    queryFn: () => api.getImageGenStatus(),
    staleTime: 60_000,
    retry: false,
  })
  const imageGenInstalled =
    (imageGenStatus as { installed?: boolean } | undefined)?.installed ?? false
  const visibleToolDefs = TOOL_DEFS.filter((def) => def.key !== 'image_gen' || imageGenInstalled)
  const isMobile = useIsMobileViewport()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const toolsPopoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!voiceCommand || voiceCommand.at === lastVoiceCommandAtRef.current) return
    lastVoiceCommandAtRef.current = voiceCommand.at
    const text = voiceCommand.text.trim()
    if (!text || isLoading) return
    onSendMessage(text)
  }, [voiceCommand, onSendMessage, isLoading])

  useEffect(() => {
    if (!plusMenuOpen && !toolsPopoverOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (plusMenuOpen && plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false)
      }
      if (
        toolsPopoverOpen &&
        toolsPopoverRef.current &&
        !toolsPopoverRef.current.contains(e.target as Node)
      ) {
        setToolsPopoverOpen(false)
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPlusMenuOpen(false)
        setToolsPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [plusMenuOpen, toolsPopoverOpen])

  const toggleTool = useCallback((toolKey: string) => {
    setEnabledToolKeys((prev) => {
      const next = new Set(prev)
      if (next.has(toolKey)) next.delete(toolKey)
      else next.add(toolKey)
      try {
        localStorage.setItem('nomad:agentTools', JSON.stringify([...next]))
      } catch {}
      return next
    })
  }, [])

  const activeTools = useCallback((): string[] => {
    const tools: string[] = []
    for (const def of TOOL_DEFS) {
      if (def.key === 'image_gen' && !imageGenInstalled) continue
      if (enabledToolKeys.has(def.key)) tools.push(...def.tools)
    }
    return tools
  }, [enabledToolKeys, imageGenInstalled])

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
    const tools = activeTools()
    const hasTools = tools.length > 0
    if ((hasText || hasImages || hasTools) && !isLoading) {
      onSendMessage(
        hasText ? input.trim() : '',
        attachments.length > 0 ? attachments : undefined,
        hasTools ? tools : undefined
      )
      setInput('')
      setAttachments([])
      setPlusMenuOpen(false)
      setToolsPopoverOpen(false)
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
  const hasTools = [...enabledToolKeys].some((key) =>
    visibleToolDefs.some((def) => def.key === key)
  )
  const canSend = (hasText || hasImages || hasTools) && !isLoading

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
        <div className="relative shrink-0" ref={plusMenuRef}>
          <button
            type="button"
            onClick={() => setPlusMenuOpen((v) => !v)}
            disabled={isLoading}
            aria-label="Add attachment"
            title="Add attachment"
            className={classNames(
              'flex items-center justify-center rounded-lg transition-all duration-200 shrink-0 border',
              isLoading
                ? 'bg-surface-secondary text-text-muted border-border-default cursor-not-allowed'
                : plusMenuOpen
                  ? 'bg-desert-orange/10 text-desert-orange border-desert-orange'
                  : 'bg-surface-secondary text-text-secondary border-border-default hover:text-desert-orange hover:border-desert-orange'
            )}
            style={{ height: '50px', width: '50px' }}
          >
            <IconPlus className="h-6 w-6" />
          </button>
          {plusMenuOpen && (
            <div className="absolute bottom-full left-0 mb-2 z-50 rounded-lg border border-border-default bg-surface-primary shadow-lg min-w-50 overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  if (!selectedModelSupportsVision) return
                  setPlusMenuOpen(false)
                  fileInputRef.current?.click()
                }}
                disabled={!selectedModelSupportsVision || attachments.length >= MAX_ATTACHMENTS}
                title={
                  !selectedModelSupportsVision
                    ? 'The current model does not support image input. Switch to a vision-capable model to attach images.'
                    : attachments.length >= MAX_ATTACHMENTS
                      ? `You can attach up to ${MAX_ATTACHMENTS} images per message.`
                      : undefined
                }
                className="flex items-center gap-3 w-full px-4 py-3 text-sm text-text-primary hover:bg-surface-secondary transition-colors disabled:text-text-muted disabled:cursor-not-allowed text-left"
              >
                <IconPhotoPlus className="h-5 w-5 shrink-0" />
                <span>Add image</span>
                {!selectedModelSupportsVision && (
                  <span className="ml-auto text-xs text-text-muted">No vision model</span>
                )}
              </button>
            </div>
          )}
        </div>
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
        {selectedModelSupportsTools && (
          <div className="relative shrink-0" ref={toolsPopoverRef}>
            <button
              type="button"
              onClick={() => setToolsPopoverOpen((v) => !v)}
              disabled={isLoading}
              aria-label="Agent tools"
              title="Agent tools"
              className={classNames(
                'relative flex items-center justify-center rounded-lg transition-all duration-200 shrink-0 border',
                isLoading
                  ? 'bg-surface-secondary text-text-muted border-border-default cursor-not-allowed'
                  : toolsPopoverOpen || hasTools
                    ? 'bg-desert-orange/10 text-desert-orange border-desert-orange'
                    : 'bg-surface-secondary text-text-secondary border-border-default hover:text-desert-orange hover:border-desert-orange'
              )}
              style={{ height: '50px', width: '50px' }}
            >
              <IconTools className="h-6 w-6" />
              {hasTools && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-desert-orange text-white text-[10px] font-bold leading-none">
                  {
                    [...enabledToolKeys].filter((key) =>
                      visibleToolDefs.some((def) => def.key === key)
                    ).length
                  }
                </span>
              )}
            </button>
            {toolsPopoverOpen && (
              <div className="absolute bottom-full left-0 mb-2 z-50 rounded-lg border border-border-default bg-surface-primary shadow-lg min-w-50 overflow-hidden">
                <div className="px-3 py-2 text-xs font-medium text-text-muted border-b border-border-subtle">
                  Agent tools
                </div>
                {visibleToolDefs.map((def) => {
                  const Icon = def.icon
                  const isActive = enabledToolKeys.has(def.key)
                  return (
                    <button
                      key={def.key}
                      type="button"
                      onClick={() => toggleTool(def.key)}
                      className={classNames(
                        'flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors text-left',
                        isActive
                          ? 'text-desert-orange bg-desert-orange/10'
                          : 'text-text-primary hover:bg-surface-secondary'
                      )}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <span className="flex-1">{def.label}</span>
                      <span
                        className={classNames(
                          'flex items-center justify-center h-5 w-5 rounded-full border transition-colors shrink-0',
                          isActive
                            ? 'bg-desert-orange border-desert-orange text-white'
                            : 'border-border-default text-transparent'
                        )}
                      >
                        <svg
                          viewBox="0 0 12 12"
                          className="h-3 w-3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M2 6l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
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
