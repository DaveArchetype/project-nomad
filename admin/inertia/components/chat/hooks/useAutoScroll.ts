import { useCallback, useEffect, useRef } from 'react'
import { ChatMessage } from '../../../../types/chat'

interface UseAutoScrollResult {
  containerRef: React.RefObject<HTMLDivElement | null>
  setMessageRef: (id: string) => (el: HTMLDivElement | null) => void
}

export function useAutoScroll(
  messages: ChatMessage[],
  resetKey: string | null
): UseAutoScrollResult {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const prevIdsRef = useRef<Set<string>>(new Set())
  const prevResetKeyRef = useRef<string | null>(null)

  const setMessageRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) {
        messageRefs.current.set(id, el)
      } else {
        messageRefs.current.delete(id)
      }
    },
    []
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const currentIds = new Set(messages.map((m) => m.id))
    const resetKeyChanged = prevResetKeyRef.current !== resetKey
    prevResetKeyRef.current = resetKey

    if (resetKeyChanged) {
      prevIdsRef.current = currentIds
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
      return
    }

    const prevIds = prevIdsRef.current
    let lastNewId: string | null = null
    for (let i = messages.length - 1; i >= 0; i--) {
      const id = messages[i].id
      if (!prevIds.has(id)) {
        lastNewId = id
        break
      }
    }
    prevIdsRef.current = currentIds

    if (lastNewId === null) return

    const el = messageRefs.current.get(lastNewId)
    if (!el) return

    const cRect = container.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    container.scrollBy({ top: eRect.top - cRect.top, behavior: 'smooth' })
  }, [messages, resetKey])

  return { containerRef, setMessageRef }
}
