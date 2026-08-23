import { useQuery } from '@tanstack/react-query'
import StyledModal from '../../StyledModal'
import api from '~/lib/api'

interface FileViewerModalProps {
  source: string
  onClose: () => void
  /** Display title override (e.g. article/file title from RAG metadata). */
  displayTitle?: string
  /** Retrieved passage carried from the RAG result. Shown when the source file
   *  isn't directly viewable (ZIM archives, admin docs, README, etc.) instead of
   *  the generic "couldn't load" error. */
  snippet?: string
}

export default function FileViewerModal({
  source,
  onClose,
  displayTitle,
  snippet,
}: FileViewerModalProps) {
  const { data, isLoading, isFetched } = useQuery({
    queryKey: ['rag', 'file-content', source],
    queryFn: () => api.getFileContent(source),
    staleTime: 60_000,
  })

  const fallbackName = source.split(/[/\\]/).at(-1) ?? source
  const title = data?.fileName ?? displayTitle ?? fallbackName
  const showError = isFetched && !data
  const showSnippet = showError && typeof snippet === 'string' && snippet.length > 0

  return (
    <StyledModal
      title={title}
      open={true}
      onClose={onClose}
      onCancel={onClose}
      cancelText="Close"
      large
    >
      <div className="text-left text-sm">
        {isLoading && <div className="text-text-secondary">Loading…</div>}
        {showError && !showSnippet && (
          <div className="text-amber-700 dark:text-amber-300">
            Couldn't load file. It may have been moved or its type isn't viewable.
          </div>
        )}
        {showSnippet && (
          <div className="space-y-2">
            <div className="text-xs text-text-muted">
              Showing the retrieved passage from the knowledge base. The full source archive isn't
              directly viewable as a file.
            </div>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-border-subtle bg-surface-secondary p-3 font-mono text-xs text-text-primary">
              {snippet}
            </pre>
          </div>
        )}
        {data && (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-border-subtle bg-surface-secondary p-3 font-mono text-xs text-text-primary">
            {data.content}
          </pre>
        )}
      </div>
    </StyledModal>
  )
}
