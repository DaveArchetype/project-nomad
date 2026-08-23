import StyledButton from '~/components/StyledButton'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import { groupAndSortKbFiles } from '~/lib/kb_file_grouping'
import KbFileCardList from './KbFileCardList'
import KbFileTable from './KbFileTable'
import type { StoredFilesSectionProps } from './types'

export default function StoredFilesSection({
  isMobile,
  storedFiles,
  isLoadingFiles,
  knownCollections,
  collectionFilter,
  setCollectionFilter,
  comboboxOptions,
  sort,
  setSort,
  warningsUnavailable,
  isUploading,
  qdrantOffline,
  bulkBusy,
  resetMutationPending,
  reembedMutationPending,
  syncMutationPending,
  onManageCollectionsOpen,
  onResetRebuild,
  onReembedAll,
  onSyncStorage,
  fileWarnings,
  inflightSources,
  confirmDeleteSource,
  setConfirmDeleteSource,
  setConfirmReembed,
  setViewerSource,
  deleteMutation,
  embedMutation,
  updateCollectionMutation,
  verifyMutation,
  resumeMutation,
  verifyResult,
  setVerifyResult,
}: StoredFilesSectionProps) {
  const records = groupAndSortKbFiles(
    collectionFilter === 'All'
      ? storedFiles
      : storedFiles.filter((f) => f.collection === collectionFilter),
    sort
  )

  return (
    <section className="rounded-lg border border-border-subtle bg-surface-primary p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <StyledSectionHeader title="Stored Knowledge Base Files" className="mb-0!" />
        <div className="flex flex-col md:flex-wrap md:items-center gap-2 w-full md:w-auto">
          <label className="flex flex-col md:flex-row md:items-center gap-1 md:gap-2 text-sm text-text-secondary w-full md:w-auto shrink-0">
            <span className="shrink-0">Search in:</span>
            <select
              value={collectionFilter}
              onChange={(e) => setCollectionFilter(e.target.value)}
              className="rounded border border-border-subtle bg-surface-primary px-3 py-2 text-text-primary w-full md:w-auto"
            >
              <option value="All">All</option>
              {knownCollections.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col md:flex-wrap md:items-center gap-2 w-full md:w-auto">
            <StyledButton
              variant="secondary"
              size="md"
              icon="IconSettings"
              onClick={onManageCollectionsOpen}
              className="w-full md:w-auto md:!px-3"
            >
              Manage Collections
            </StyledButton>
            <StyledButton
              variant="danger"
              size="md"
              icon="IconAlertTriangle"
              onClick={onResetRebuild}
              disabled={isUploading || qdrantOffline || bulkBusy}
              loading={resetMutationPending}
              title="Drop the entire embeddings collection and re-embed everything from scratch. Permanently removes vectors for files no longer on disk. Destructive: requires typing RESET to confirm."
              className="w-full md:w-auto md:!px-3"
            >
              Reset & Rebuild
            </StyledButton>
            <StyledButton
              variant="secondary"
              size="md"
              icon="IconRefreshAlert"
              onClick={onReembedAll}
              disabled={isUploading || qdrantOffline || bulkBusy || storedFiles.length === 0}
              loading={reembedMutationPending}
              title="Re-embed every file on disk, replacing existing vectors file-by-file. Vectors for files no longer on disk are preserved. Use this if the chunker or embedding model has changed."
              className="w-full md:w-auto md:!px-3"
            >
              Re-embed All
            </StyledButton>
            <StyledButton
              variant="secondary"
              size="md"
              icon="IconRefresh"
              onClick={onSyncStorage}
              disabled={syncMutationPending || isUploading || qdrantOffline || bulkBusy}
              loading={syncMutationPending || isUploading}
              title="Scan storage for new files and queue any that haven't been embedded yet. Safe to run anytime; won't touch already-embedded content."
              className="w-full md:w-auto md:!px-3"
            >
              Sync Storage
            </StyledButton>
          </div>
        </div>
      </div>
      {warningsUnavailable && (
        <div className="inline-flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded px-3 py-2">
          <span aria-hidden="true">⚠</span>
          <span>File warnings unavailable — couldn't read storage state. Retrying…</span>
        </div>
      )}
      {isMobile ? (
        <KbFileCardList
          records={records}
          loading={isLoadingFiles}
          fileWarnings={fileWarnings}
          comboboxOptions={comboboxOptions}
          sort={sort}
          setSort={setSort}
          confirmDeleteSource={confirmDeleteSource}
          setConfirmDeleteSource={setConfirmDeleteSource}
          setConfirmReembed={setConfirmReembed}
          setViewerSource={setViewerSource}
          deleteMutation={deleteMutation}
          embedMutation={embedMutation}
          updateCollectionMutation={updateCollectionMutation}
          qdrantOffline={qdrantOffline}
          inflightSources={inflightSources}
          verifyMutation={verifyMutation}
          resumeMutation={resumeMutation}
          verifyResult={verifyResult}
          setVerifyResult={setVerifyResult}
        />
      ) : (
        <KbFileTable
          records={records}
          loading={isLoadingFiles}
          fileWarnings={fileWarnings}
          comboboxOptions={comboboxOptions}
          sort={sort}
          setSort={setSort}
          confirmDeleteSource={confirmDeleteSource}
          setConfirmDeleteSource={setConfirmDeleteSource}
          setConfirmReembed={setConfirmReembed}
          setViewerSource={setViewerSource}
          deleteMutation={deleteMutation}
          embedMutation={embedMutation}
          updateCollectionMutation={updateCollectionMutation}
          qdrantOffline={qdrantOffline}
          inflightSources={inflightSources}
          verifyMutation={verifyMutation}
          resumeMutation={resumeMutation}
          verifyResult={verifyResult}
          setVerifyResult={setVerifyResult}
        />
      )}
    </section>
  )
}
