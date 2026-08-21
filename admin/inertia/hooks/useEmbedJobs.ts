import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '~/lib/api'

const useEmbedJobs = (props: { enabled?: boolean; pollIntervalMs?: number } = {}) => {
  const queryClient = useQueryClient()
  const prevCountRef = useRef<number>(0)
  const MIN_POLL_MS = 1000
  const pollIntervalMs = Math.max(props.pollIntervalMs ?? 60_000, MIN_POLL_MS)

  const queryData = useQuery({
    queryKey: ['embed-jobs'],
    queryFn: () => api.getActiveEmbedJobs().then((data) => data ?? []),
    refetchInterval: (query) => {
      const data = query.state.data
      if (data && data.length > 0) {
        return pollIntervalMs
      }
      return Math.max(pollIntervalMs, 30_000)
    },
    enabled: props.enabled ?? true,
  })

  useEffect(() => {
    const currentCount = queryData.data?.length ?? 0
    if (prevCountRef.current > 0 && currentCount === 0) {
      queryClient.invalidateQueries({ queryKey: ['storedFiles'] })
    }
    prevCountRef.current = currentCount
  }, [queryData.data, queryClient])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['embed-jobs'] })
  }

  return { ...queryData, invalidate }
}

export default useEmbedJobs
