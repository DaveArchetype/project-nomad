import { useCallback, useEffect, useRef, useState } from 'react'
import { VoiceContext, VoiceStatus } from '../context/VoiceContext'
import { useNotifications } from '~/context/NotificationContext'

const WAKE_INDICATOR_DURATION_MS = 2500
// Browsers won't always honor this exactly (Safari in particular), but Chrome/Firefox do — the
// Voice Gateway expects 16kHz mono PCM16, matching what it (and openWakeWord/faster-whisper)
// were built for. A future iteration could resample client-side instead of relying on this.
const TARGET_SAMPLE_RATE = 16000

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}

export default function VoiceProvider({
  children,
  voiceEnabled = false,
}: {
  children: React.ReactNode
  voiceEnabled?: boolean
}) {
  const { addNotification } = useNotifications()

  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<VoiceStatus>('off')
  const [error, setError] = useState<string | null>(null)
  const [lastWakeAt, setLastWakeAt] = useState<number | null>(null)
  const [lastWakeCommand, setLastWakeCommand] = useState<{ text: string; at: number } | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const wakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    processorRef.current?.disconnect()
    processorRef.current = null
    audioContextRef.current?.close().catch(() => {})
    audioContextRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    wsRef.current?.close()
    wsRef.current = null
    setStatus('off')
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setStatus('connecting')

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support microphone access.')
      setStatus('error')
      setEnabled(false)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: TARGET_SAMPLE_RATE, echoCancellation: true },
      })
      streamRef.current = stream

      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${protocol}://${window.location.host}/ws/voice`)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onopen = () => {
        setStatus('listening')
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'wake') {
            setLastWakeAt(Date.now())
            setStatus('wake')
            if (wakeTimeoutRef.current) clearTimeout(wakeTimeoutRef.current)
            wakeTimeoutRef.current = setTimeout(() => {
              setStatus((s) => (s === 'wake' ? 'listening' : s))
            }, WAKE_INDICATOR_DURATION_MS)
          } else if (message.type === 'error') {
            setError(message.message || 'Voice Gateway error.')
            addNotification({ message: message.message || 'Voice Gateway error.', type: 'error' })
          } else if (
            message.type === 'final' &&
            message.isWakeWord &&
            typeof message.text === 'string'
          ) {
            setLastWakeCommand({ text: message.text, at: Date.now() })
          }
        } catch {
          // ignore malformed frames
        }
      }

      ws.onclose = () => {
        if (streamRef.current) {
          // The socket dropped while the mic is still supposed to be on — surface it rather
          // than silently going deaf.
          setStatus('error')
          setError('Lost connection to the Voice Gateway.')
        }
      }

      ws.onerror = () => {
        setStatus('error')
        setError('Failed to connect to the Voice Gateway.')
      }

      const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
      audioContextRef.current = audioContext
      const source = audioContext.createMediaStreamSource(stream)
      // ScriptProcessorNode is deprecated in favor of AudioWorklet, but it needs no separate
      // module file to load/bundle and is still broadly supported — a reasonable trade-off here.
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (event) => {
        if (ws.readyState !== WebSocket.OPEN) return
        const input = event.inputBuffer.getChannelData(0)
        ws.send(floatTo16BitPCM(input))
      }

      source.connect(processor)
      // A ScriptProcessorNode only fires onaudioprocess while connected to a destination.
      processor.connect(audioContext.destination)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access was denied.')
      setStatus('error')
      setEnabled(false)
      stop()
    }
  }, [addNotification, stop])

  const toggle = useCallback(() => {
    setEnabled((prev) => !prev)
  }, [])

  useEffect(() => {
    if (enabled) {
      start()
    } else {
      stop()
    }
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  useEffect(() => {
    return () => {
      if (wakeTimeoutRef.current) clearTimeout(wakeTimeoutRef.current)
    }
  }, [])

  return (
    <VoiceContext.Provider
      value={{
        available: Boolean(voiceEnabled),
        enabled,
        status,
        error,
        lastWakeAt,
        lastWakeCommand,
        toggle,
      }}
    >
      {children}
    </VoiceContext.Provider>
  )
}
