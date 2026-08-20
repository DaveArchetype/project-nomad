import { IconInfoCircle } from '@tabler/icons-react'
import { useLayoutEffect, useRef, useState } from 'react'

interface InfoTooltipProps {
  text: string
  className?: string
  position?: 'top' | 'bottom'
  align?: 'center' | 'right'
}

export default function InfoTooltip({
  text,
  className = '',
  position = 'top',
  align = 'center',
}: InfoTooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState({ top: 0, left: 0 })

  useLayoutEffect(() => {
    if (!isVisible || !buttonRef.current || !tooltipRef.current) return
    const btnRect = buttonRef.current.getBoundingClientRect()
    const tipRect = tooltipRef.current.getBoundingClientRect()
    const margin = 8

    let top: number
    if (position === 'bottom') {
      top = btnRect.bottom + margin
    } else {
      top = btnRect.top - tipRect.height - margin
    }

    let left: number
    if (align === 'right') {
      left = btnRect.right - tipRect.width
    } else {
      left = btnRect.left + btnRect.width / 2 - tipRect.width / 2
    }

    if (left < margin) left = margin
    if (left + tipRect.width > window.innerWidth - margin) {
      left = window.innerWidth - tipRect.width - margin
    }
    if (top < margin) top = btnRect.bottom + margin
    if (top + tipRect.height > window.innerHeight - margin) {
      top = btnRect.top - tipRect.height - margin
    }

    setCoords({ top, left })
  }, [isVisible, position, align, text])

  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        className="text-desert-stone-dark hover:text-desert-green transition-colors p-0.5"
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        aria-label="More information"
      >
        <IconInfoCircle className="w-4 h-4" />
      </button>
      {isVisible && (
        <div
          ref={tooltipRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left }}
          className="z-50"
        >
          <div
            className={`bg-desert-stone-dark text-white text-xs rounded-lg px-3 py-2 whitespace-normal shadow-lg ${
              align === 'right' ? 'w-64' : 'max-w-xs'
            }`}
          >
            {text}
          </div>
        </div>
      )}
    </span>
  )
}
