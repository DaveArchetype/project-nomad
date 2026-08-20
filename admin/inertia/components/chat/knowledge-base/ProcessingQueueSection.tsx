import StyledButton from '~/components/StyledButton'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import ActiveEmbedJobs from '~/components/ActiveEmbedJobs'

interface ProcessingQueueSectionProps {
  qdrantOffline: boolean
  cleanupFailedPending: boolean
  onCleanupFailed: () => void
  cancelAllPending: boolean
  onCancelAll: () => void
}

export default function ProcessingQueueSection({
  qdrantOffline,
  cleanupFailedPending,
  onCleanupFailed,
  cancelAllPending,
  onCancelAll,
}: ProcessingQueueSectionProps) {
  return (
    <section className="rounded-lg border border-border-subtle bg-surface-primary p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <StyledSectionHeader title="Processing Queue" className="!mb-0" />
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 w-full md:w-auto">
          <StyledButton
            variant="danger"
            size="md"
            icon="IconTrash"
            onClick={onCleanupFailed}
            loading={cleanupFailedPending}
            disabled={cleanupFailedPending || qdrantOffline}
            className="w-full md:w-auto"
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
            className="w-full md:w-auto"
          >
            Cancel All Jobs
          </StyledButton>
        </div>
      </div>
      <ActiveEmbedJobs withHeader={false} />
    </section>
  )
}
