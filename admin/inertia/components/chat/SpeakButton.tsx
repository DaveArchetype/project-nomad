import { useEffect, useRef, useState } from 'react'
import { IconVolume, IconPlayerStop, IconLoader2 } from '@tabler/icons-react'
import api from '~/lib/api'
import { useNotifications } from '~/context/NotificationContext'
import { useVoice } from '~/context/VoiceContext'
import {
  createSpeechSource,
  getSentencesWithOffsets,
  stripMarkdownForHighlighting,
  unlockAudioPlayback,
} from '~/lib/voice'

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
  const abortRef = useRef<AbortController | null>(null)
  const finishPlaybackRef = useRef<(() => void) | null>(null)
  const playbackIdRef = useRef(0)
  const isBusyRef = useRef(false)
  const { addNotification } = useNotifications()
  const { mute, unmute } = useVoice()

  useEffect(() => {
    return () => {
      playbackIdRef.current++
      const wasBusy = isBusyRef.current
      isBusyRef.current = false
      abortRef.current?.abort()
      abortRef.current = null
      const finishPlayback = finishPlaybackRef.current
      finishPlaybackRef.current = null
      if (sourceRef.current) {
        sourceRef.current.onended = null
        try {
          sourceRef.current.stop()
        } catch {}
        sourceRef.current.disconnect()
        sourceRef.current = null
      }
      finishPlayback?.()
      if (wasBusy) unmute()
    }
  }, [unmute])

  const stop = () => {
    playbackIdRef.current++
    isBusyRef.current = false
    abortRef.current?.abort()
    abortRef.current = null
    const finishPlayback = finishPlaybackRef.current
    finishPlaybackRef.current = null
    if (sourceRef.current) {
      sourceRef.current.onended = null
      try {
        sourceRef.current.stop()
      } catch {}
      sourceRef.current.disconnect()
    }
    sourceRef.current = null
    finishPlayback?.()
    setState('idle')
    unmute()
  }

  const play = async () => {
    if (isAutoReading) {
      onStopAutoReading?.()
      return
    }
    if (isBusyRef.current) {
      stop()
      return
    }
    const playbackId = ++playbackIdRef.current
    const abortController = new AbortController()
    abortRef.current = abortController
    isBusyRef.current = true
    setState('loading')
    mute()
    try {
      await unlockAudioPlayback()
      if (playbackIdRef.current !== playbackId) return
      const spokenText = stripMarkdownForHighlighting(text)
      const chunks = getSentencesWithOffsets(spokenText)
      if (chunks.length === 0) throw new Error('No readable text to speak')

      for (const chunk of chunks) {
        if (playbackIdRef.current !== playbackId) return
        setState('loading')
        const blob = await api.synthesizeSpeech(
          chunk.text,
          voice,
          undefined,
          engine,
          language,
          abortController.signal
        )
        if (playbackIdRef.current !== playbackId) return
        if (!blob || blob.size === 0) throw new Error('No audio returned')

        const { source } = await createSpeechSource(blob)
        if (playbackIdRef.current !== playbackId) {
          source.disconnect()
          return
        }
        await new Promise<void>((resolve) => {
          finishPlaybackRef.current = resolve
          sourceRef.current = source
          source.onended = () => {
            if (sourceRef.current === source) sourceRef.current = null
            source.disconnect()
            const finishPlayback = finishPlaybackRef.current
            finishPlaybackRef.current = null
            finishPlayback?.()
          }
          source.start()
          setState('playing')
        })
      }

      if (playbackIdRef.current !== playbackId) return
      abortRef.current = null
      isBusyRef.current = false
      setState('idle')
      unmute()
    } catch (err) {
      if (playbackIdRef.current !== playbackId) return
      console.error('[SpeakButton] Playback failed:', err)
      abortRef.current = null
      if (sourceRef.current) {
        sourceRef.current.onended = null
        try {
          sourceRef.current.stop()
        } catch {}
        sourceRef.current.disconnect()
        sourceRef.current = null
      }
      finishPlaybackRef.current = null
      isBusyRef.current = false
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
