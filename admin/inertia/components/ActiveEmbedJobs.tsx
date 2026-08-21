import { useEffect, useRef, useState } from 'react'
import useEmbedJobs from '~/hooks/useEmbedJobs'
import HorizontalBarChart from './HorizontalBarChart'
import StyledSectionHeader from './StyledSectionHeader'
import { JOB_HEALTH_DISPLAY, computeJobHealth, formatTimeAgo } from '~/lib/kb_job_health_display'

interface ActiveEmbedJobsProps {
  withHeader?: boolean
}

interface ChunkRateSnapshot {
  chunks: number
  timestamp: number
}

const ActiveEmbedJobs = ({ withHeader = false }: ActiveEmbedJobsProps) => {
  const { data: jobs } = useEmbedJobs()

  // Re-render every 5s to keep per-job "last activity Xs ago" timestamps fresh.
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  // Track per-job chunk snapshots to compute chunks/min. We keep the last two
  // snapshots so the rate smooths over a short window rather than jumping on
  // every poll. Snapshots older than 60s are discarded so a pause in flushing
  // doesn't deflate the rate to zero immediately.
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
            return (
              <div
                key={job.jobId}
                className="bg-desert-white rounded-lg p-4 border border-desert-stone-light shadow-sm hover:shadow-lg transition-shadow"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 min-w-0">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${display.dot}`}
                    aria-label={display.ariaLabel}
                    title={display.ariaLabel}
                  />
                  <span className="text-sm font-medium text-text-primary">{display.label}</span>
                  {lastActivityMs !== undefined && (
                    <span className="text-xs text-text-muted">
                      · last activity {formatTimeAgo(lastActivityMs, tick)}
                    </span>
                  )}
                  {chunksPerMin !== null && (
                    <span className="text-xs text-text-muted">
                      · {chunksPerMin.toLocaleString()} chunks/min
                    </span>
                  )}
                </div>
                <HorizontalBarChart
                  items={[
                    {
                      label: job.fileName,
                      value: job.progress,
                      total: hasChunkInfo
                        ? job.chunksEstimated
                          ? `~${job.chunksEstimated.toLocaleString()} chunks`
                          : 'chunks'
                        : '100%',
                      used: hasChunkInfo ? chunksDone.toLocaleString() : `${job.progress}%`,
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
