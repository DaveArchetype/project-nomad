import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import useEmbedJobs from '~/hooks/useEmbedJobs'
import HorizontalBarChart from './HorizontalBarChart'
import StyledSectionHeader from './StyledSectionHeader'
import StyledButton from './StyledButton'
import { useNotifications } from '~/context/NotificationContext'
import { JOB_HEALTH_DISPLAY, computeJobHealth, formatTimeAgo } from '~/lib/kb_job_health_display'
import type { JobHealthStatus } from '../../app/utils/kb_job_health.js'
import api from '~/lib/api'

interface ActiveEmbedJobsProps {
  withHeader?: boolean
}

interface ChunkRateSnapshot {
  chunks: number
  timestamp: number
}

const ActiveEmbedJobs = ({ withHeader = false }: ActiveEmbedJobsProps) => {
  const { data: jobs } = useEmbedJobs()
  const queryClient = useQueryClient()
  const { addNotification } = useNotifications()

  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  const rateRef = useRef<Map<string, ChunkRateSnapshot[]>>(new Map())
  useEffect(() => {
    if (!jobs || jobs.length === 0) {
      rateRef.current.clear()
      return
    }
    const now = Date.now()
    const next = new Map<string, ChunkRateSnapshot[]>()
    for (const job of jobs) {
      const chunks = typeof job.chunks === 'number' ? job.chunks : 0
      const prev = rateRef.current.get(job.jobId) ?? []
      const recent = prev.filter((s) => now - s.timestamp < 60_000)
      const last = recent[recent.length - 1]
      if (!last || last.chunks !== chunks) {
        recent.push({ chunks, timestamp: now })
      }
      next.set(job.jobId, recent)
    }
    rateRef.current = next
  }, [jobs])

  const computeChunksPerMin = (jobId: string): number | null => {
    const snapshots = rateRef.current.get(jobId)
    if (!snapshots || snapshots.length < 2) return null
    const first = snapshots[0]
    const last = snapshots[snapshots.length - 1]
    const deltaChunks = last.chunks - first.chunks
    const deltaMs = last.timestamp - first.timestamp
    if (deltaMs <= 0) return null
    return Math.round((deltaChunks / deltaMs) * 60_000)
  }

  const resumeMutation = useMutation({
    mutationFn: (jobId: string) => api.resumeEmbedJob(jobId),
    onSuccess: (data) => {
      addNotification({ type: 'success', message: data?.message || 'Job resumed.' })
      queryClient.invalidateQueries({ queryKey: ['embed-jobs'] })
    },
    onError: (error: any) => {
      addNotification({ type: 'error', message: error?.message || 'Failed to resume job.' })
    },
  })

  const pauseJobMutation = useMutation({
    mutationFn: (jobId: string) => api.pauseEmbedJob(jobId),
    onSuccess: (data) => {
      addNotification({ type: 'success', message: data?.message || 'Job paused.' })
      queryClient.invalidateQueries({ queryKey: ['embed-jobs'] })
    },
    onError: (error: any) => {
      addNotification({ type: 'error', message: error?.message || 'Failed to pause job.' })
    },
  })

  const resumePausedJobMutation = useMutation({
    mutationFn: (jobId: string) => api.resumePausedEmbedJob(jobId),
    onSuccess: (data) => {
      addNotification({ type: 'success', message: data?.message || 'Job resumed.' })
      queryClient.invalidateQueries({ queryKey: ['embed-jobs'] })
    },
    onError: (error: any) => {
      addNotification({ type: 'error', message: error?.message || 'Failed to resume job.' })
    },
  })

  const canResume = (health: JobHealthStatus): boolean => health === 'stalled' || health === 'slow'

  return (
    <>
      {withHeader && <StyledSectionHeader title="Processing Queue" className="mt-12 mb-4" />}

      <div className="space-y-4">
        {jobs && jobs.length > 0 ? (
          jobs.map((job) => {
            const health = computeJobHealth({
              status: job.status,
              progress: job.progress,
              lastBatchAt: job.lastBatchAt,
              startedAt: job.startedAt,
              now: tick,
            })
            const display = JOB_HEALTH_DISPLAY[health]
            const lastActivityMs = job.lastBatchAt ?? job.startedAt
            const chunksDone = typeof job.chunks === 'number' ? job.chunks : 0
            const hasChunkInfo = chunksDone > 0 || (job.chunksEstimated ?? 0) > 0
            const chunksPerMin = computeChunksPerMin(job.jobId)
            const isPaused = job.paused === true
            const showResume = canResume(health) && !isPaused
            return (
              <div
                key={job.jobId}
                className="bg-desert-white rounded-lg p-4 border border-desert-stone-light shadow-sm hover:shadow-lg transition-shadow"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1 min-w-0">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${display.dot}`}
                    aria-label={display.ariaLabel}
                    title={display.ariaLabel}
                  />
                  <span className="text-sm font-medium text-text-primary">
                    {isPaused ? 'Paused' : display.label}
                  </span>
                  {lastActivityMs !== undefined && (
                    <span className="text-xs text-text-muted">
                      · last activity {formatTimeAgo(lastActivityMs, tick)}
                    </span>
                  )}
                  {chunksPerMin !== null && !isPaused && (
                    <span className="text-xs text-text-muted">
                      · {chunksPerMin.toLocaleString()} chunks/min
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    {isPaused ? (
                      <StyledButton
                        variant="primary"
                        size="sm"
                        icon="IconPlayerPlay"
                        onClick={() => resumePausedJobMutation.mutate(job.jobId)}
                        loading={
                          resumePausedJobMutation.isPending &&
                          resumePausedJobMutation.variables === job.jobId
                        }
                      >
                        Resume
                      </StyledButton>
                    ) : (
                      <StyledButton
                        variant="secondary"
                        size="sm"
                        icon="IconPlayerPause"
                        onClick={() => pauseJobMutation.mutate(job.jobId)}
                        loading={
                          pauseJobMutation.isPending && pauseJobMutation.variables === job.jobId
                        }
                      >
                        Pause
                      </StyledButton>
                    )}
                    {showResume && (
                      <StyledButton
                        variant="secondary"
                        size="sm"
                        icon="IconRefresh"
                        onClick={() => resumeMutation.mutate(job.jobId)}
                        loading={resumeMutation.isPending && resumeMutation.variables === job.jobId}
                      >
                        Retry
                      </StyledButton>
                    )}
                  </div>
                </div>
                {hasChunkInfo && (
                  <div className="text-xs text-text-muted mb-2">
                    {chunksDone.toLocaleString()}
                    {job.chunksEstimated
                      ? ` / ~${job.chunksEstimated.toLocaleString()} chunks`
                      : ' chunks'}
                  </div>
                )}
                <HorizontalBarChart
                  items={[
                    {
                      label: job.fileName,
                      value: job.progress,
                      total: '100%',
                      used: `${job.progress}%`,
                      type: job.status,
                    },
                  ]}
                />
              </div>
            )
          })
        ) : (
          <p className="text-text-muted">No files are currently being processed</p>
        )}
      </div>
    </>
  )
}

export default ActiveEmbedJobs
