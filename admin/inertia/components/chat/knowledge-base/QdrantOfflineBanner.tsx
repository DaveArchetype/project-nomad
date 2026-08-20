import StyledButton from '~/components/StyledButton'

interface QdrantOfflineBannerProps {
  qdrantOffline: boolean
  isStartingQdrant: boolean
  startQdrantPending: boolean
  onStartQdrant: () => void
}

export default function QdrantOfflineBanner({
  qdrantOffline,
  isStartingQdrant,
  startQdrantPending,
  onStartQdrant,
}: QdrantOfflineBannerProps) {
  if (!qdrantOffline) return null

  return (
    <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm dark:bg-red-950 dark:border-red-800 dark:text-red-300 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4">
      <span>
        <strong>Knowledge Base unavailable:</strong> The Qdrant vector database is offline.
      </span>
      <StyledButton
        variant="danger"
        size="sm"
        onClick={onStartQdrant}
        loading={startQdrantPending || isStartingQdrant}
        disabled={startQdrantPending || isStartingQdrant}
        className="w-full md:w-auto"
      >
        {isStartingQdrant ? 'Starting…' : 'Start Qdrant'}
      </StyledButton>
    </div>
  )
}
