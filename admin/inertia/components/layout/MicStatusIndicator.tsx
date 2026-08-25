import { IconMicrophone, IconMicrophoneOff } from '@tabler/icons-react'
import clsx from 'clsx'
import { useVoice } from '~/context/VoiceContext'

const STATUS_STYLES: Record<string, string> = {
  off: 'text-desert-stone hover:text-desert-green-darker',
  connecting: 'text-amber-500 animate-pulse',
  listening: 'text-green-600',
  wake: 'text-amber-500 animate-pulse',
  error: 'text-red-500',
}

const STATUS_LABELS: Record<string, string> = {
  off: 'Voice Assistant is off — click to start ambient listening',
  connecting: 'Connecting to Voice Gateway…',
  listening: 'Listening (ambient) — click to stop',
  wake: 'Wake word detected!',
  error: 'Voice Assistant error — click to retry',
}

/**
 * Discreet, color-coded microphone toggle shown in the shared app header on
 * every root page (Home, Settings, Chat). Deliberately small/muted — this is
 * the moment-to-moment on/off control for ambient listening, distinct from
 * the AI Settings > Voice master switch that gates whether it appears at all.
 */
export default function MicStatusIndicator() {
  const { available, enabled, status, toggle } = useVoice()

  if (!available) return null

  const Icon = enabled ? IconMicrophone : IconMicrophoneOff

  return (
    <button
      type="button"
      onClick={toggle}
      className={clsx(
        'flex items-center justify-center rounded-md p-1.5 transition-colors cursor-pointer',
        STATUS_STYLES[status] ?? STATUS_STYLES.off
      )}
      aria-label={STATUS_LABELS[status] ?? STATUS_LABELS.off}
      title={STATUS_LABELS[status] ?? STATUS_LABELS.off}
    >
      <Icon className="size-4" />
    </button>
  )
}
