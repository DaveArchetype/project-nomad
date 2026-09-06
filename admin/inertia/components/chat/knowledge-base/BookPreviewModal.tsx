import { IconExternalLink } from '@tabler/icons-react'
import StyledModal from '../../StyledModal'

interface BookPreviewModalProps {
  calibreWebUrl: string
  bookId: number
  format: string
  title: string
  onClose: () => void
}

export default function BookPreviewModal({
  calibreWebUrl,
  bookId,
  format,
  title,
  onClose,
}: BookPreviewModalProps) {
  const readerUrl = `${calibreWebUrl.replace(/\/+$/, '')}/read/${bookId}/${format}`

  return (
    <StyledModal
      title={title}
      open={true}
      onClose={onClose}
      onCancel={onClose}
      cancelText="Close"
      large
    >
      <div className="space-y-2">
        <a
          href={readerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-desert-green underline hover:text-desert-green/80"
        >
          <IconExternalLink className="h-3.5 w-3.5" />
          Open in new tab
        </a>
        <iframe
          src={readerUrl}
          title={title}
          className="w-full rounded border border-border-subtle bg-white"
          style={{ height: '60vh' }}
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
        />
      </div>
    </StyledModal>
  )
}
