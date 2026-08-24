import { useEffect, useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react'
import { IconChevronLeft, IconChevronRight, IconX } from '@tabler/icons-react'

interface ImageViewerModalProps {
  images: string[]
  startIndex: number
  onClose: () => void
}

function imageUrlFor(path: string): string {
  return path.startsWith('data:') ? path : `/api/chat/images/${path}`
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

  return (
    <Dialog open={true} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/90" />
      <div className="fixed inset-0 z-10 flex items-center justify-center p-4">
        <DialogPanel className="relative flex max-h-[95vh] max-w-[95vw] items-center justify-center">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute -top-2 -right-2 z-20 flex items-center justify-center h-9 w-9 rounded-full bg-surface-secondary text-text-primary hover:bg-surface-tertiary shadow-lg"
          >
            <IconX className="h-5 w-5" />
          </button>

          {images.length > 1 && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
              {currentIndex + 1} / {images.length}
            </div>
          )}

          {currentIndex > 0 && (
            <button
              type="button"
              onClick={goPrev}
              aria-label="Previous image"
              className="absolute left-0 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center h-11 w-11 rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <IconChevronLeft className="h-7 w-7" />
            </button>
          )}

          {currentIndex < images.length - 1 && (
            <button
              type="button"
              onClick={goNext}
              aria-label="Next image"
              className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center h-11 w-11 rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <IconChevronRight className="h-7 w-7" />
            </button>
          )}

          <img
            src={imageUrlFor(images[currentIndex])}
            alt={`Image ${currentIndex + 1}`}
            className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg"
          />
        </DialogPanel>
      </div>
    </Dialog>
  )
}
