import { useEffect, useState } from 'react'
import { IconClockPause, IconChevronDown } from '@tabler/icons-react'
import StyledButton from '~/components/StyledButton'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import ActiveEmbedJobs from '~/components/ActiveEmbedJobs'
import PollIntervalControl from './PollIntervalControl'

interface ProcessingQueueSectionProps {
  qdrantOffline: boolean
  cleanupFailedPending: boolean
  onCleanupFailed: () => void
  cancelAllPending: boolean
  onCancelAll: () => void
  pauseAllPending: boolean
  onPauseAll: () => void
  resumeAllPending: boolean
  onResumeAll: () => void
  allPaused: boolean
  chatPausedUntil?: number
  pollIntervalMs: number
  onPollIntervalChange: (ms: number) => void
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

export default function ProcessingQueueSection({
  qdrantOffline,
  cleanupFailedPending,
  onCleanupFailed,
  cancelAllPending,
  onCancelAll,
  pauseAllPending,
  onPauseAll,
  resumeAllPending,
  onResumeAll,
  allPaused,
  chatPausedUntil,
  pollIntervalMs,
  onPollIntervalChange,
}: ProcessingQueueSectionProps) {
  const [now, setNow] = useState(() => Date.now())
  const [showControls, setShowControls] = useState(false)
  useEffect(() => {
    if (!chatPausedUntil) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [chatPausedUntil])

  const chatPaused = chatPausedUntil != null && chatPausedUntil > now
  const chatRemainingMs = chatPaused ? chatPausedUntil! - now : 0
  const showResumeAll = allPaused || chatPaused

  return (
    <section className="rounded-lg border border-border-subtle bg-surface-primary p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <StyledSectionHeader title="Processing Queue" className="mb-0!" />
        <button
          type="button"
          onClick={() => setShowControls(!showControls)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-text-primary rounded-md border border-border-subtle hover:bg-surface-secondary transition-colors shrink-0"
        >
          Controls
          <IconChevronDown
            className={`w-4 h-4 transition-transform ${showControls ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {showControls && (
        <div className="flex flex-col gap-3 rounded-md border border-border-subtle bg-surface-secondary/50 p-3 md:p-4">
          <PollIntervalControl intervalMs={pollIntervalMs} onChange={onPollIntervalChange} />
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {showResumeAll ? (
              <StyledButton
                variant="primary"
                size="md"
                icon="IconPlayerPlay"
                onClick={onResumeAll}
                loading={resumeAllPending}
                disabled={resumeAllPending}
                className="w-full sm:w-auto"
              >
                Resume All
              </StyledButton>
            ) : (
              <StyledButton
                variant="secondary"
                size="md"
                icon="IconPlayerPause"
                onClick={onPauseAll}
                loading={pauseAllPending}
                disabled={pauseAllPending}
                className="w-full sm:w-auto"
              >
                Pause All
              </StyledButton>
            )}
            <StyledButton
              variant="danger"
              size="md"
              icon="IconTrash"
              onClick={onCleanupFailed}
              loading={cleanupFailedPending}
              disabled={cleanupFailedPending || qdrantOffline}
              className="w-full sm:w-auto"
            >
              Clean Up Failed
            </StyledButton>
            <StyledButton
              variant="danger"
              size="md"
              icon="IconPlayerStop"
              onClick={onCancelAll}
              loading={cancelAllPending}
              disabled={cancelAllPending}
              title="Stop and clear every embedding job regardless of state, including stuck or in-progress ones. Deletes the uploaded source files for those jobs."
              className="w-full sm:w-auto"
            >
              Cancel All Jobs
            </StyledButton>
          </div>
        </div>
      )}
      {chatPaused && !allPaused && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-yellow-400/40 bg-yellow-400/10 px-4 py-2.5 text-sm text-text-secondary">
          <IconClockPause className="h-4 w-4 shrink-0 text-yellow-600" />
          <span>
            Embedding paused for chat — resumes in{' '}
            <strong className="text-text-primary">{formatRemaining(chatRemainingMs)}</strong>
          </span>
          <StyledButton
            variant="secondary"
            size="sm"
            icon="IconPlayerPlay"
            onClick={onResumeAll}
            loading={resumeAllPending}
            disabled={resumeAllPending}
            className="ml-auto"
          >
            Resume Now
          </StyledButton>
        </div>
      )}
      <ActiveEmbedJobs withHeader={false} />
    </section>
  )
}
