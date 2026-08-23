import { useState } from 'react'
import { IconFileText } from '@tabler/icons-react'
import classNames from '~/lib/classNames'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChatMessage } from '../../../types/chat'
import FileViewerModal from './knowledge-base/FileViewerModal'
import KiwixPreviewModal from './knowledge-base/KiwixPreviewModal'

export interface ChatMessageBubbleProps {
  message: ChatMessage
}

type SelectedSource = {
  source: string
  title?: string
  snippet?: string
  kiwixUrl?: string
}

export default function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const [viewingSource, setViewingSource] = useState<SelectedSource | null>(null)
  return (
    <div
      className={classNames(
        'max-w-[85%] sm:max-w-[70%] min-w-0 overflow-hidden rounded-lg px-4 py-3',
        message.role === 'user'
          ? 'bg-desert-green text-white'
          : 'bg-surface-secondary text-text-primary'
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
      <div
        className={classNames(
          'break-words',
          message.role === 'assistant' ? 'prose prose-sm max-w-none' : 'whitespace-pre-wrap'
        )}
      >
        {message.role === 'assistant' ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
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
          'text-xs mt-2',
          message.role === 'user' ? 'text-white/70' : 'text-text-muted'
        )}
      >
        {message.timestamp.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}
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
                    kiwixUrl: src.kiwixUrl,
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
        (viewingSource.kiwixUrl ? (
          <KiwixPreviewModal
            kiwixUrl={viewingSource.kiwixUrl}
            title={viewingSource.title ?? 'Kiwix article'}
            onClose={() => setViewingSource(null)}
          />
        ) : (
          <FileViewerModal
            source={viewingSource.source}
            displayTitle={viewingSource.title}
            snippet={viewingSource.snippet}
            onClose={() => setViewingSource(null)}
          />
        ))}
    </div>
  )
}
