import { useQuery } from '@tanstack/react-query'
import StyledModal from '../../StyledModal'
import api from '~/lib/api'

interface FileViewerModalProps {
  source: string
  onClose: () => void
}

export default function FileViewerModal({ source, onClose }: FileViewerModalProps) {
  const { data, isLoading, isFetched } = useQuery({
    queryKey: ['rag', 'file-content', source],
    queryFn: () => api.getFileContent(source),
    staleTime: 60_000,
  })

  const fallbackName = source.split(/[/\\]/).at(-1) ?? source
  const title = data?.fileName ?? fallbackName
  const showError = isFetched && !data

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
        {showError && (
          <div className="text-amber-700 dark:text-amber-300">
            Couldn't load file. It may have been moved or its type isn't viewable.
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
