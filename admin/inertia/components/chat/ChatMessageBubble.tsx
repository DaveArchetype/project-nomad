import { useState } from 'react'
import { IconFileText } from '@tabler/icons-react'
import classNames from '~/lib/classNames'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import api from '~/lib/api'
import { ChatMessage } from '../../../types/chat'
import FileViewerModal from './knowledge-base/FileViewerModal'
import ImageViewerModal, { type ImageViewerImage } from './ImageViewerModal'
import KiwixPreviewModal from './knowledge-base/KiwixPreviewModal'
import { useKiwixBaseUrl } from '../../hooks/useKiwixBaseUrl'
import SpeakButton from './SpeakButton'

function imageUrlFor(path: string): string {
  // Optimistic local messages store base64 data URLs; persisted messages store
  // relative paths served by /api/chat/images/*.
  return path.startsWith('data:') ? path : `/api/chat/images/${path}`
}

function stripHrAfterTable() {
  return (tree: any) => {
    tree.children = tree.children.filter((node: any, i: number, arr: any[]) => {
      if (node.type === 'thematicBreak' && i > 0 && arr[i - 1].type === 'table') {
        return false
      }
      return true
    })
  }
}

export interface ChatMessageBubbleProps {
  message: ChatMessage
  speakingWordIndex?: number
}

type SelectedSource = {
  source: string
  title?: string
  snippet?: string
  kiwixPath?: string
}

function stripMarkdownForHighlighting(text: string): string {
  let s = text
  s = s.replace(/```[\s\S]*?```/g, ' ')
  s = s.replace(/`([^`]+)`/g, '$1')
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  s = s.replace(/#{1,6}\s+/g, '')
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
  s = s.replace(/\*([^*]+)\*/g, '$1')
  s = s.replace(/__([^_]+)__/g, '$1')
  s = s.replace(/_([^_]+)_/g, '$1')
  s = s.replace(/~~([^~]+)~~/g, '$1')
  s = s.replace(/^\s*[-*+]\s+/gm, '')
  s = s.replace(/^\s*\d+\.\s+/gm, '')
  s = s.replace(/^\s*>\s+/gm, '')
  s = s.replace(/\|/g, ' ')
  s = s.replace(/[#*~`]/g, '')
  s = s.replace(/\n{2,}/g, '\n')
  return s.trim()
}

function SpeakingText({ text, currentIndex }: { text: string; currentIndex: number }) {
  const words = text.split(/(\s+)/)
  let wordIdx = -1
  return (
    <span>
      {words.map((token, i) => {
        if (/\s/.test(token)) return <span key={i}>{token}</span>
        wordIdx++
        const isCurrent = wordIdx === currentIndex
        const isPast = wordIdx < currentIndex
        return (
          <span
            key={i}
            className={
              isCurrent
                ? 'bg-desert-green/30 rounded px-0.5 transition-colors'
                : isPast
                  ? 'text-text-muted'
                  : ''
            }
          >
            {token}
          </span>
        )
      })}
    </span>
  )
}

export default function ChatMessageBubble({
  message,
  speakingWordIndex = -1,
}: ChatMessageBubbleProps) {
  const [viewingSource, setViewingSource] = useState<SelectedSource | null>(null)
  const [viewingImageIndex, setViewingImageIndex] = useState<number | null>(null)
  const [viewingSourcePreview, setViewingSourcePreview] = useState<number | null>(null)
  const [failedPreviews, setFailedPreviews] = useState<Set<number>>(new Set())
  const kiwixBaseUrl = useKiwixBaseUrl()

  const sortedSources =
    message.role === 'assistant' && message.sources && message.sources.length > 0
      ? [...message.sources].sort((a, b) => {
          const aWiki = a.source.toLowerCase().includes('wikipedia') ? 0 : 1
          const bWiki = b.source.toLowerCase().includes('wikipedia') ? 0 : 1
          return aWiki - bWiki
        })
      : []

  const MAX_PREVIEW_IMAGES = 3
  const previewSlots: {
    source: string
    title: string
    snippet: string
    kiwixPath?: string
    imageIndex: number
  }[] = []
  for (
    let imgIdx = 0;
    previewSlots.length < MAX_PREVIEW_IMAGES && imgIdx < MAX_PREVIEW_IMAGES;
    imgIdx++
  ) {
    for (const src of sortedSources) {
      if (previewSlots.length >= MAX_PREVIEW_IMAGES) break
      previewSlots.push({
        source: src.source,
        title: src.title,
        snippet: src.snippet,
        kiwixPath: src.kiwixPath,
        imageIndex: imgIdx,
      })
    }
  }

  const buildSourceUrl = (slot: (typeof previewSlots)[number]): string | undefined => {
    if (slot.kiwixPath && kiwixBaseUrl) {
      return `${kiwixBaseUrl.replace(/\/+$/, '')}${slot.kiwixPath}`
    }
    return undefined
  }

  const visiblePreviewSlots = previewSlots.filter((_, idx) => !failedPreviews.has(idx))
  const sourcePreviewImages: ImageViewerImage[] = visiblePreviewSlots.map((slot) => ({
    url: api.getSourcePreviewImageUrl(slot.source, slot.kiwixPath, slot.imageIndex),
    alt: slot.imageIndex === 0 ? slot.title : undefined,
    title: slot.imageIndex === 0 ? slot.title : undefined,
    description: slot.imageIndex === 0 ? slot.snippet.slice(0, 200) : undefined,
    sourceUrl: slot.imageIndex === 0 ? buildSourceUrl(slot) : undefined,
  }))

  const hasTable =
    message.role === 'assistant' && /^\|.*\|[\s\S]*?\n\|[\s-:]+\|/m.test(message.content)

  return (
    <div
      className={classNames(
        'min-w-0 overflow-hidden rounded-lg px-4 py-3',
        message.role === 'user'
          ? 'max-w-[85%] sm:max-w-[70%] bg-desert-green text-white'
          : `max-w-[92%] ${hasTable ? 'sm:max-w-[90%]' : 'sm:max-w-[75%]'} bg-surface-secondary text-text-primary`
      )}
    >
      {message.isThinking && message.thinking && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-amber-700">
            <span>Reasoning</span>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
          </div>
          <div className="prose prose-xs max-w-none text-amber-900/80 max-h-32 overflow-y-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.thinking}</ReactMarkdown>
          </div>
        </div>
      )}
      {!message.isThinking && message.thinking && (
        <details className="mb-3 rounded border border-border-subtle bg-surface-secondary text-xs">
          <summary className="cursor-pointer px-3 py-2 font-medium text-text-muted hover:text-text-primary select-none">
            {message.thinkingDuration !== undefined
              ? `Thought for ${message.thinkingDuration}s`
              : 'Reasoning'}
          </summary>
          <div className="px-3 pb-3 prose prose-xs max-w-none text-text-secondary max-h-48 overflow-y-auto border-t border-border-subtle pt-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.thinking}</ReactMarkdown>
          </div>
        </details>
      )}
      {message.role === 'user' && message.images && message.images.length > 0 && (
        <div className="flex gap-2 mb-2 overflow-x-auto sm:flex-wrap sm:overflow-visible">
          {message.images.map((img, idx) => (
            <button
              key={`${img.slice(0, 24)}-${idx}`}
              type="button"
              onClick={() => setViewingImageIndex(idx)}
              className="block shrink-0 max-w-lg"
            >
              <img
                src={imageUrlFor(img)}
                alt={`Attachment ${idx + 1}`}
                className="max-w-lg max-h-64 rounded-md object-contain border border-white/30 hover:opacity-90 cursor-pointer"
              />
            </button>
          ))}
        </div>
      )}
      {previewSlots.length > 0 && (
        <div className="flex gap-2 mb-3 overflow-x-auto sm:flex-wrap sm:overflow-visible">
          {previewSlots.map((slot, idx) => {
            if (failedPreviews.has(idx)) return null
            const url = api.getSourcePreviewImageUrl(slot.source, slot.kiwixPath, slot.imageIndex)
            const visibleIdx = visiblePreviewSlots.findIndex((s) => s === slot)
            return (
              <button
                key={`${slot.source}-${slot.imageIndex}-${idx}`}
                type="button"
                onClick={() => setViewingSourcePreview(visibleIdx >= 0 ? visibleIdx : 0)}
                className="block max-w-lg shrink-0 rounded-md overflow-hidden border border-border-subtle hover:opacity-90 transition-opacity"
                title={slot.title}
              >
                <img
                  src={url}
                  alt={slot.title}
                  loading="lazy"
                  onError={() =>
                    setFailedPreviews((prev) => {
                      const next = new Set(prev)
                      next.add(idx)
                      return next
                    })
                  }
                  className="max-w-lg max-h-48 w-auto h-auto block bg-surface"
                />
              </button>
            )
          })}
        </div>
      )}
      <div
        className={classNames(
          'break-words',
          message.role === 'assistant' ? 'prose prose-sm max-w-none' : 'whitespace-pre-wrap'
        )}
      >
        {message.role === 'assistant' && speakingWordIndex >= 0 ? (
          <p className="mb-0">
            <SpeakingText
              text={stripMarkdownForHighlighting(message.content)}
              currentIndex={speakingWordIndex}
            />
          </p>
        ) : message.role === 'assistant' ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, stripHrAfterTable]}
            components={{
              code: ({ node, className, children, ...props }: any) => {
                const isInline = !className?.includes('language-')
                if (isInline) {
                  return (
                    <code
                      className="bg-gray-800 text-gray-100 px-2 py-0.5 rounded font-mono text-sm"
                      {...props}
                    >
                      {children}
                    </code>
                  )
                }
                return (
                  <code
                    className="block bg-gray-800 text-gray-100 p-3 rounded-lg overflow-x-auto font-mono text-sm my-2"
                    {...props}
                  >
                    {children}
                  </code>
                )
              },
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="list-disc pl-5 mb-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 mb-2">{children}</ol>,
              li: ({ children }) => <li className="mb-1">{children}</li>,
              h1: ({ children }) => <h1 className="text-xl font-bold mb-2">{children}</h1>,
              h2: ({ children }) => <h2 className="text-lg font-bold mb-2">{children}</h2>,
              h3: ({ children }) => <h3 className="text-base font-bold mb-2">{children}</h3>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-border-default pl-4 italic my-2">
                  {children}
                </blockquote>
              ),
              a: ({ children, href }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-desert-green underline hover:text-desert-green/80"
                >
                  {children}
                </a>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto mb-6">
                  <table className="w-full border-collapse text-sm">{children}</table>
                </div>
              ),
              thead: ({ children }) => (
                <thead className="bg-surface-secondary border-b-2 border-border-default">
                  {children}
                </thead>
              ),
              th: ({ children }) => (
                <th className="px-4 py-2.5 text-left font-semibold border border-border-subtle text-text-primary whitespace-nowrap">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="px-4 py-2 border border-border-subtle text-text-secondary">
                  {children}
                </td>
              ),
              tr: ({ children }) => <tr className="even:bg-surface-secondary/50">{children}</tr>,
              hr: () => <hr className="my-4 border-border-subtle" />,
            }}
          >
            {message.content}
          </ReactMarkdown>
        ) : (
          message.content
        )}
        {message.isStreaming && (
          <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse" />
        )}
      </div>
      <div
        className={classNames(
          'text-xs mt-2 flex items-center gap-2',
          message.role === 'user' ? 'text-white/70' : 'text-text-muted'
        )}
      >
        <span>
          {message.timestamp.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        {message.role === 'assistant' && !message.isStreaming && message.content.trim() && (
          <SpeakButton text={message.content} />
        )}
      </div>
      {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
        <div className="mt-3 border-t border-border-subtle pt-2">
          <div className="mb-1.5 text-xs font-medium text-text-muted">Sources</div>
          <div className="flex flex-wrap gap-1.5">
            {message.sources.map((src, idx) => (
              <button
                key={`${src.source}-${idx}`}
                type="button"
                onClick={() =>
                  setViewingSource({
                    source: src.source,
                    title: src.title,
                    snippet: src.snippet,
                    kiwixPath: src.kiwixPath,
                  })
                }
                title={src.source}
                className="inline-flex items-center gap-1.5 max-w-full rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs text-text-primary hover:border-desert-green hover:text-desert-green transition-colors"
              >
                <IconFileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{src.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {viewingSource &&
        (viewingSource.kiwixPath && kiwixBaseUrl ? (
          (() => {
            const fullUrl = `${kiwixBaseUrl.replace(/\/+$/, '')}${viewingSource.kiwixPath}`
            return (
              <KiwixPreviewModal
                kiwixUrl={fullUrl}
                title={viewingSource.title ?? 'Kiwix article'}
                onClose={() => setViewingSource(null)}
              />
            )
          })()
        ) : (
          <FileViewerModal
            source={viewingSource.source}
            displayTitle={viewingSource.title}
            snippet={viewingSource.snippet}
            onClose={() => setViewingSource(null)}
          />
        ))}
      {viewingImageIndex !== null && message.images && message.images.length > 0 && (
        <ImageViewerModal
          images={message.images.map((img) => ({ url: imageUrlFor(img) }))}
          startIndex={viewingImageIndex}
          onClose={() => setViewingImageIndex(null)}
        />
      )}
      {viewingSourcePreview !== null && sourcePreviewImages.length > 0 && (
        <ImageViewerModal
          images={sourcePreviewImages}
          startIndex={viewingSourcePreview}
          onClose={() => setViewingSourcePreview(null)}
        />
      )}
    </div>
  )
}
