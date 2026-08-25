import { createContext, useContext } from 'react'

export type VoiceStatus = 'off' | 'connecting' | 'listening' | 'wake' | 'error'

export interface VoiceContextType {
  /** Whether the Voice Assistant feature is enabled at all (AI Settings > Voice master switch). */
  available: boolean
  /** Session-level mic on/off — resets to off on every page load by design (privacy). */
  enabled: boolean
  status: VoiceStatus
  error: string | null
  /** Timestamp (ms) of the most recent wake-word detection, for pages (e.g. Chat) to react to. */
  lastWakeAt: number | null
  /**
   * The finalized transcript of the utterance that contained the wake word (may include the wake
   * phrase itself, e.g. "hey jarvis what's the weather"). Chat uses this to prefill the composer.
   */
  lastWakeCommand: { text: string; at: number } | null
  toggle: () => void
}

export const VoiceContext = createContext<VoiceContextType | undefined>(undefined)

export const useVoice = () => {
  const context = useContext(VoiceContext)
  if (!context) {
    throw new Error('useVoice must be used within a VoiceProvider')
  }
  return context
}
