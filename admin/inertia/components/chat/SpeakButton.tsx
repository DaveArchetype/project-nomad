import { useEffect, useRef, useState } from 'react'
import { IconVolume, IconPlayerStop, IconLoader2 } from '@tabler/icons-react'
import api from '~/lib/api'
import { useNotifications } from '~/context/NotificationContext'
import { useVoice } from '~/context/VoiceContext'

interface SpeakButtonProps {
  text: string
  voice?: string
  className?: string
}

/**
 * Speaker button used on assistant chat messages and daily recap summaries.
 * Synthesizes speech via the Piper-backed `/api/voice/tts/synthesize`
 * endpoint and plays it back with a plain `<audio>` element. Mutes the mic
 * while playing to prevent the TTS audio from being picked up and re-transcribed.
 */
export default function SpeakButton({ text, voice, className }: SpeakButtonProps) {
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
    if (state === 'playing') {
      stop()
      return
    }
    setState('loading')
    mute()
    try {
      const blob = await api.synthesizeSpeech(text, voice)
      if (!blob) {
        throw new Error('No audio returned')
      }
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => {
        setState('idle')
        unmute()
      }
      audio.onerror = () => {
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

  return (
    <button
      type="button"
      onClick={play}
      className={className ?? 'hover:text-desert-green transition-colors cursor-pointer'}
      aria-label={state === 'playing' ? 'Stop speaking' : 'Read aloud'}
      title={state === 'playing' ? 'Stop speaking' : 'Read aloud'}
    >
      {state === 'loading' ? (
        <IconLoader2 className="size-3.5 animate-spin" />
      ) : state === 'playing' ? (
        <IconPlayerStop className="size-3.5" />
      ) : (
        <IconVolume className="size-3.5" />
      )}
    </button>
  )
}
