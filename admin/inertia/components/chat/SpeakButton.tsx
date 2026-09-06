import { useEffect, useRef, useState } from 'react'
import { IconVolume, IconPlayerStop, IconLoader2 } from '@tabler/icons-react'
import api from '~/lib/api'
import { useNotifications } from '~/context/NotificationContext'
import { useVoice } from '~/context/VoiceContext'

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
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const { addNotification } = useNotifications()
  const { mute, unmute } = useVoice()

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
        unmute()
      }
    }
  }, [unmute])

  const stop = () => {
    audioRef.current?.pause()
    audioRef.current = null
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
      const blob = await api.synthesizeSpeech(text, voice, undefined, engine, language)
      if (!blob || blob.size === 0) {
        throw new Error('No audio returned')
      }
      const typedBlob = blob.type ? blob : new Blob([blob], { type: 'audio/wav' })
      const url = URL.createObjectURL(typedBlob)
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => {
        setState('idle')
        unmute()
      }
      audio.onerror = (e) => {
        console.error(
          '[SpeakButton] Audio playback error:',
          e,
          'blob type:',
          typedBlob.type,
          'size:',
          typedBlob.size
        )
        addNotification({
          message: `Audio playback failed (${typedBlob.type || 'unknown type'}, ${typedBlob.size} bytes)`,
          type: 'error',
        })
        setState('idle')
        unmute()
      }
      await audio.play()
      setState('playing')
    } catch (err) {
      addNotification({
        message: 'Failed to synthesize speech. Is the Text-to-Speech service installed?',
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
