import { IconX } from '@tabler/icons-react'
import { useIsMobileViewport } from '~/hooks/useIsMobileViewport'
import CollectionsManager from './CollectionsManager'
import { useKnowledgeBase } from './knowledge-base/useKnowledgeBase'
import QdrantOfflineBanner from './knowledge-base/QdrantOfflineBanner'
import UploadSection from './knowledge-base/UploadSection'
import ProcessingQueueSection from './knowledge-base/ProcessingQueueSection'
import StoredFilesSection from './knowledge-base/StoredFilesSection'
import BulkActionModals from './knowledge-base/BulkActionModals'
import FileViewerModal from './knowledge-base/FileViewerModal'

interface KnowledgeBaseModalProps {
  aiAssistantName?: string
  onClose: () => void
}

export default function KnowledgeBaseModal({
  aiAssistantName = 'AI Assistant',
  onClose,
}: KnowledgeBaseModalProps) {
  const isMobile = useIsMobileViewport()
  const kb = useKnowledgeBase()

  return (
    <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center p-0 md:p-4 bg-black/30 backdrop-blur-sm transition-opacity">
      <div className="bg-surface-primary rounded-none md:rounded-lg shadow-xl w-full md:max-w-5xl h-full md:h-auto md:max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-border-subtle shrink-0">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold text-text-primary">Knowledge Base</h2>
            <p className="text-sm text-text-muted mt-1 hidden md:block">
              Manage documents available to {aiAssistantName}.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface-secondary rounded-lg transition-colors shrink-0"
          >
            <IconX className="h-6 w-6 text-text-muted" />
          </button>
        </div>
        <div className="overflow-y-auto overflow-x-hidden flex-1 p-4 md:p-6 space-y-8 md:space-y-10">
          <QdrantOfflineBanner
            qdrantOffline={kb.qdrantOffline}
            isStartingQdrant={kb.isStartingQdrant}
            startQdrantPending={kb.startQdrantMutation.isPending}
            onStartQdrant={() => kb.startQdrantMutation.mutate()}
          />
          <UploadSection
            aiAssistantName={aiAssistantName}
            isMobile={isMobile}
            fileUploaderRef={kb.fileUploaderRef}
            files={kb.files}
            setFiles={kb.setFiles}
            uploadCollection={kb.uploadCollection}
            setUploadCollection={kb.setUploadCollection}
            comboboxOptions={kb.comboboxOptions}
            handleUpload={kb.handleUpload}
            isUploading={kb.isUploading}
            qdrantOffline={kb.qdrantOffline}
            ingestPolicy={kb.ingestPolicy}
            updateIngestPolicyPending={kb.updateIngestPolicyMutation.isPending}
            onUpdateIngestPolicy={(p) => kb.updateIngestPolicyMutation.mutate(p)}
          />
          <ProcessingQueueSection
            qdrantOffline={kb.qdrantOffline}
            cleanupFailedPending={kb.cleanupFailedMutation.isPending}
            onCleanupFailed={() => kb.cleanupFailedMutation.mutate()}
            cancelAllPending={kb.cancelAllMutation.isPending}
            onCancelAll={kb.handleConfirmCancelAll}
            pauseAllPending={kb.pauseAllMutation.isPending}
            onPauseAll={() => kb.pauseAllMutation.mutate()}
            resumeAllPending={kb.resumeAllMutation.isPending}
            onResumeAll={() => kb.resumeAllMutation.mutate()}
            allPaused={kb.allEmbedJobsPaused}
            chatPausedUntil={kb.chatPausedUntil}
            pollIntervalMs={kb.pollIntervalMs}
            onPollIntervalChange={kb.setPollIntervalMs}
          />
          <StoredFilesSection
            isMobile={isMobile}
            storedFiles={kb.storedFiles ?? []}
            isLoadingFiles={kb.isLoadingFiles}
            knownCollections={kb.knownCollections}
            collectionFilter={kb.collectionFilter}
            setCollectionFilter={kb.setCollectionFilter}
            comboboxOptions={kb.comboboxOptions}
            sort={kb.sort}
            setSort={kb.setSort}
            warningsUnavailable={kb.warningsUnavailable}
            isUploading={kb.isUploading}
            qdrantOffline={kb.qdrantOffline}
            bulkBusy={kb.bulkBusy}
            resetMutationPending={kb.resetMutation.isPending}
            reembedMutationPending={kb.reembedMutation.isPending}
            syncMutationPending={kb.syncMutation.isPending}
            onManageCollectionsOpen={() => kb.setManageCollectionsOpen(true)}
            onResetRebuild={() => {
              kb.setResetTyped('')
              kb.setBulkMode('reset')
            }}
            onReembedAll={() => kb.setBulkMode('reembed')}
            onSyncStorage={kb.handleConfirmSync}
            fileWarnings={kb.fileWarnings}
            inflightSources={kb.inflightSources}
            confirmDeleteSource={kb.confirmDeleteSource}
            setConfirmDeleteSource={kb.setConfirmDeleteSource}
            setConfirmReembed={kb.setConfirmReembed}
            setViewerSource={kb.setViewerSource}
            deleteMutation={kb.deleteMutation}
            embedMutation={kb.embedMutation}
            updateCollectionMutation={kb.updateCollectionMutation}
            verifyMutation={kb.verifyMutation}
            resumeMutation={kb.resumeMutation}
            verifyResult={kb.verifyResult}
            setVerifyResult={kb.setVerifyResult}
          />
        </div>
      </div>

      <BulkActionModals
        bulkMode={kb.bulkMode}
        setBulkMode={kb.setBulkMode}
        resetTyped={kb.resetTyped}
        setResetTyped={kb.setResetTyped}
        reembedMutation={kb.reembedMutation}
        resetMutation={kb.resetMutation}
        embedMutation={kb.embedMutation}
        confirmReembed={kb.confirmReembed}
        setConfirmReembed={kb.setConfirmReembed}
        storedFilesCount={kb.storedFiles?.length ?? 0}
      />

      {kb.viewerSource && (
        <FileViewerModal source={kb.viewerSource} onClose={() => kb.setViewerSource(null)} />
      )}

      {kb.manageCollectionsOpen && (
        <CollectionsManager onClose={() => kb.setManageCollectionsOpen(false)} />
      )}
    </div>
  )
}
