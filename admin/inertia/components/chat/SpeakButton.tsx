import { useEffect, useRef, useState } from 'react'
import { IconVolume, IconPlayerStop, IconLoader2 } from '@tabler/icons-react'
import api from '~/lib/api'
import { useNotifications } from '~/context/NotificationContext'
import { useVoice } from '~/context/VoiceContext'
import { createSpeechSource, stripMarkdownForHighlighting, unlockAudioPlayback } from '~/lib/voice'

interface SpeakButtonProps {
  text: string
  voice?: string
  engine?: string
  language?: string
  className?: string
  isAutoReading?: boolean
  onStopAutoReading?: () => void
}

/**
 * Speaker button used on assistant chat messages and daily recap summaries.
 * Synthesizes speech via the Piper-backed `/api/voice/tts/synthesize`
 * endpoint and plays it back with a plain `<audio>` element. Mutes the mic
 * while playing to prevent the TTS audio from being picked up and re-transcribed.
 *
 * When `isAutoReading` is true, the button reflects the auto-read state from
 * the parent Chat component — showing a stop icon that calls `onStopAutoReading`
 * instead of managing its own audio playback.
 */
export default function SpeakButton({
  text,
  voice,
  engine,
  language,
  className,
  isAutoReading = false,
  onStopAutoReading,
}: SpeakButtonProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const { addNotification } = useNotifications()
  const { mute, unmute } = useVoice()

  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        sourceRef.current.onended = null
        try {
          sourceRef.current.stop()
        } catch {}
        sourceRef.current.disconnect()
        sourceRef.current = null
        unmute()
      }
    }
  }, [unmute])

  const stop = () => {
    if (sourceRef.current) {
      sourceRef.current.onended = null
      try {
        sourceRef.current.stop()
      } catch {}
      sourceRef.current.disconnect()
    }
    sourceRef.current = null
    setState('idle')
    unmute()
  }

  const play = async () => {
    if (isAutoReading) {
      onStopAutoReading?.()
      return
    }
    if (state === 'playing') {
      stop()
      return
    }
    setState('loading')
    mute()
    try {
      await unlockAudioPlayback()
      const spokenText = stripMarkdownForHighlighting(text)
      if (!spokenText) throw new Error('No readable text to speak')

      const blob = await api.synthesizeSpeech(spokenText, voice, undefined, engine, language)
      if (!blob || blob.size === 0) throw new Error('No audio returned')

      const { source } = await createSpeechSource(blob)
      sourceRef.current = source
      source.onended = () => {
        if (sourceRef.current !== source) return
        source.disconnect()
        sourceRef.current = null
        setState('idle')
        unmute()
      }
      source.start()
      setState('playing')
    } catch (err) {
      console.error('[SpeakButton] Playback failed:', err)
      if (sourceRef.current) {
        sourceRef.current.onended = null
        sourceRef.current.disconnect()
        sourceRef.current = null
      }
      addNotification({
        message: `Failed to play audio: ${err instanceof Error ? err.message : 'unknown error'}`,
        type: 'error',
      })
      setState('idle')
      unmute()
    }
  }

  const displayState = isAutoReading ? 'playing' : state

  return (
    <button
      type="button"
      onClick={play}
      className={className ?? 'hover:text-desert-green transition-colors cursor-pointer'}
      aria-label={displayState === 'playing' ? 'Stop speaking' : 'Read aloud'}
      title={displayState === 'playing' ? 'Stop speaking' : 'Read aloud'}
    >
      {displayState === 'loading' ? (
        <IconLoader2 className="size-3.5 animate-spin" />
      ) : displayState === 'playing' ? (
        <IconPlayerStop className="size-3.5" />
      ) : (
        <IconVolume className="size-3.5" />
      )}
    </button>
  )
}
