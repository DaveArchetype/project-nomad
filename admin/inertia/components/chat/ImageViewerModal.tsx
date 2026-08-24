import { useEffect, useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react'
import { IconChevronLeft, IconChevronRight, IconExternalLink, IconX } from '@tabler/icons-react'

export interface ImageViewerImage {
  url: string
  alt?: string
  title?: string
  description?: string
  sourceUrl?: string
}

interface ImageViewerModalProps {
  images: ImageViewerImage[]
  startIndex: number
  onClose: () => void
}

export default function ImageViewerModal({ images, startIndex, onClose }: ImageViewerModalProps) {
  const [currentIndex, setCurrentIndex] = useState(startIndex)

  const goPrev = () => setCurrentIndex((i) => Math.max(0, i - 1))
  const goNext = () => setCurrentIndex((i) => Math.min(images.length - 1, i + 1))

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [images.length])

  if (images.length === 0) return null

  const current = images[currentIndex]

  return (
    <Dialog open={true} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/90" />
      <div className="fixed inset-0 z-10 flex flex-col p-4">
        {images.length > 1 && (
          <div className="absolute top-4 left-4 z-20 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
            {currentIndex + 1} / {images.length}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 z-20 flex items-center justify-center h-9 w-9 rounded-full bg-surface-secondary text-text-primary hover:bg-surface-tertiary shadow-lg"
        >
          <IconX className="h-5 w-5" />
        </button>

        {currentIndex > 0 && (
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous image"
            className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center h-11 w-11 rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <IconChevronLeft className="h-7 w-7" />
          </button>
        )}

        {currentIndex < images.length - 1 && (
          <button
            type="button"
            onClick={goNext}
            aria-label="Next image"
            className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center h-11 w-11 rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <IconChevronRight className="h-7 w-7" />
          </button>
        )}

        <div className="flex-1 flex items-center justify-center min-h-0">
          <DialogPanel className="flex flex-col items-center justify-center max-h-full max-w-full">
            <img
              src={current.url}
              alt={current.alt ?? current.title ?? `Image ${currentIndex + 1}`}
              className="max-h-[70vh] max-w-[90vw] w-auto h-auto rounded-lg"
            />
          </DialogPanel>
        </div>

        {(current.title || current.description || current.sourceUrl) && (
          <div className="shrink-0 pb-2 pt-3 px-4 max-w-[90vw] mx-auto text-center text-white">
            {current.title && <div className="text-sm font-medium truncate">{current.title}</div>}
            {current.description && (
              <div className="mt-1 text-xs text-white/70 line-clamp-2">{current.description}</div>
            )}
            {current.sourceUrl && (
              <a
                href={current.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20 transition-colors"
              >
                <IconExternalLink className="h-3.5 w-3.5" />
                Open source
              </a>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}
