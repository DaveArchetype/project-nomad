import StyledButton from '~/components/StyledButton'
import StyledTable from '~/components/StyledTable'
import CollectionCombobox from '../CollectionCombobox'
import { formatBytes } from '~/lib/util'
import type { KbFileGroup } from '~/lib/kb_file_grouping'
import { renderSortHeader, renderStatePill, renderNoContentPill, pickRowAction } from './helpers'
import { isViewableExtension } from './constants'
import type { KbFileTableProps } from './types'

export default function KbFileTable({
  records,
  loading,
  fileWarnings,
  comboboxOptions,
  sort,
  setSort,
  confirmDeleteSource,
  setConfirmDeleteSource,
  setConfirmReembed,
  setViewerSource,
  deleteMutation,
  embedMutation,
  updateCollectionMutation,
  qdrantOffline,
  inflightSources,
  verifyMutation,
  resumeMutation,
  repairMutation,
  verifyResult,
  setVerifyResult,
}: KbFileTableProps) {
  return (
    <StyledTable<KbFileGroup>
      className="font-semibold"
      rowLines={true}
      columns={[
        {
          accessor: 'source',
          title: renderSortHeader('File Name', 'name', sort, setSort),
          className: '!whitespace-normal !max-w-xs !overflow-visible',
          render(record) {
            const warnings = fileWarnings[record.source] ?? []
            const hasZeroChunks = warnings.some((w) => w.kind === 'zero_chunks')
            const pill = hasZeroChunks ? renderNoContentPill() : renderStatePill(record)
            const visibleWarnings = warnings.filter((w) => w.kind !== 'zero_chunks')
            return (
              <div className="flex flex-col gap-1.5 min-w-0">
                <span className="text-text-primary break-words">{record.displayName}</span>
                {(pill || visibleWarnings.length > 0) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {pill}
                    {visibleWarnings.map((w, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 self-start text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5 whitespace-normal"
                      >
                        <span aria-hidden="true" className="shrink-0">
                          ⚠
                        </span>
                        {w.kind === 'partial_stall' && (
                          <span>
                            {w.chunksEmbedded.toLocaleString()}/~{w.chunksExpected.toLocaleString()}{' '}
                            chunks
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          },
        },
        {
          accessor: 'size',
          title: renderSortHeader('Size', 'size', sort, setSort),
          className: 'whitespace-nowrap',
          render(record) {
            if (record.bucket === 'admin_docs' || record.size === null) {
              return <span className="text-text-muted">—</span>
            }
            return <span className="text-text-secondary">{formatBytes(record.size)}</span>
          },
        },
        {
          accessor: 'uploadedAt',
          title: renderSortHeader('Uploaded', 'uploadedAt', sort, setSort),
          className: 'whitespace-nowrap',
          render(record) {
            if (record.bucket === 'admin_docs' || !record.uploadedAt) {
              return <span className="text-text-muted">—</span>
            }
            const d = new Date(record.uploadedAt)
            return (
              <span className="text-text-secondary" title={d.toISOString()}>
                {d.toLocaleDateString()}
              </span>
            )
          },
        },
        {
          accessor: 'collection',
          title: 'Collection',
          className: 'whitespace-nowrap',
          render(record) {
            if (record.bucket === 'admin_docs') {
              return <span className="text-text-muted">—</span>
            }
            const isSaving =
              updateCollectionMutation.isPending &&
              updateCollectionMutation.variables?.source === record.source
            return (
              <CollectionCombobox
                value={record.collection ?? ''}
                onChange={(val) =>
                  updateCollectionMutation.mutate({
                    source: record.source,
                    collection: val,
                  })
                }
                options={comboboxOptions}
                disabled={isSaving}
                className="w-40"
              />
            )
          },
        },
        {
          accessor: 'source',
          title: '',
          className: '!max-w-[260px] !overflow-visible !whitespace-normal',
          render(record) {
            if (record.bucket === 'admin_docs') {
              return (
                <div className="flex justify-end">
                  <span className="text-sm text-text-muted italic">Managed by NOMAD</span>
                </div>
              )
            }

            const isConfirming = confirmDeleteSource === record.source
            const isDeleting = deleteMutation.isPending && confirmDeleteSource === record.source
            if (isConfirming) {
              return (
                <div className="flex items-center gap-2 justify-end">
                  <span className="text-sm text-text-secondary">Remove from knowledge base?</span>
                  <StyledButton
                    variant="danger"
                    size="sm"
                    onClick={() => deleteMutation.mutate(record.source)}
                    disabled={isDeleting}
                  >
                    {isDeleting ? 'Deleting…' : 'Confirm'}
                  </StyledButton>
                  <StyledButton
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDeleteSource(null)}
                    disabled={isDeleting}
                  >
                    Cancel
                  </StyledButton>
                </div>
              )
            }

            const warnings = fileWarnings[record.source] ?? []
            const action = pickRowAction(
              record,
              warnings.filter((w) => w.kind !== 'zero_chunks').length > 0
            )
            const actionPendingForThisRow =
              embedMutation.isPending && embedMutation.variables?.source === record.source
            const isInflight = inflightSources.has(record.source)
            const isVerifying =
              verifyMutation.isPending && verifyMutation.variables === record.source
            const isResuming =
              resumeMutation.isPending && resumeMutation.variables === record.source
            const rowVerifyResult = verifyResult?.source === record.source ? verifyResult : null
            const canVerify =
              !isInflight &&
              (record.state === 'indexed' || record.state === 'stalled' || record.state === null)

            const canView =
              record.isUserUpload && isViewableExtension(record.displayName) && record.size !== null
            const canDownload = record.isUserUpload && record.size !== null

            return (
              <div className="flex flex-col items-end gap-2">
                <div className="flex flex-wrap justify-end items-center gap-2">
                  {isInflight ? (
                    <StyledButton variant="secondary" size="sm" disabled loading>
                      Indexing…
                    </StyledButton>
                  ) : action ? (
                    <StyledButton
                      variant={action.variant}
                      size="sm"
                      icon={action.icon}
                      title={action.label}
                      onClick={() => {
                        if (action.kind === 'reembed') {
                          setConfirmReembed({
                            source: record.source,
                            displayName: record.displayName,
                          })
                        } else {
                          embedMutation.mutate({
                            source: record.source,
                            force: action.force,
                          })
                        }
                      }}
                      disabled={
                        qdrantOffline || deleteMutation.isPending || embedMutation.isPending
                      }
                      loading={actionPendingForThisRow}
                    >
                      {''}
                    </StyledButton>
                  ) : null}
                  {canVerify && (
                    <StyledButton
                      variant="ghost"
                      size="sm"
                      icon="IconShieldCheck"
                      title="Verify"
                      onClick={() => {
                        setVerifyResult(null)
                        verifyMutation.mutate(record.source)
                      }}
                      disabled={qdrantOffline || isVerifying || isResuming}
                      loading={isVerifying}
                    >
                      {''}
                    </StyledButton>
                  )}
                  {canView && (
                    <StyledButton
                      variant="ghost"
                      size="sm"
                      icon="IconEye"
                      title="View"
                      onClick={() => setViewerSource(record.source)}
                    >
                      {''}
                    </StyledButton>
                  )}
                  {canDownload && (
                    <StyledButton
                      variant="ghost"
                      size="sm"
                      icon="IconDownload"
                      title="Download"
                      onClick={() => {
                        window.location.href = `/api/rag/files/download?source=${encodeURIComponent(record.source)}`
                      }}
                    >
                      {''}
                    </StyledButton>
                  )}
                  <StyledButton
                    variant="danger"
                    size="sm"
                    icon="IconTrash"
                    title="Delete"
                    onClick={() => setConfirmDeleteSource(record.source)}
                    disabled={deleteMutation.isPending || embedMutation.isPending}
                    loading={deleteMutation.isPending && confirmDeleteSource === record.source}
                  >
                    {''}
                  </StyledButton>
                </div>
                {rowVerifyResult && (
                  <div
                    className={`flex flex-wrap items-center gap-2 text-xs rounded px-3 py-2 border ${
                      rowVerifyResult.ok
                        ? 'text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-950/40 dark:border-green-800'
                        : 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800'
                    }`}
                  >
                    <span>{rowVerifyResult.message}</span>
                    {!rowVerifyResult.ok && rowVerifyResult.resumeOffset !== null && (
                      <StyledButton
                        variant="secondary"
                        size="sm"
                        icon="IconPlayerPlay"
                        onClick={() => resumeMutation.mutate(record.source)}
                        disabled={isResuming || qdrantOffline}
                        loading={isResuming}
                      >
                        Resume from article {rowVerifyResult.resumeOffset.toLocaleString()}
                      </StyledButton>
                    )}
                    {!rowVerifyResult.ok && (
                      <StyledButton
                        variant="success"
                        size="sm"
                        icon="IconStethoscope"
                        onClick={() => repairMutation.mutate(record.source)}
                        disabled={
                          repairMutation.isPending && repairMutation.variables === record.source
                        }
                        loading={
                          repairMutation.isPending && repairMutation.variables === record.source
                        }
                        title="Scan Qdrant for missing articles and re-embed only the gaps"
                      >
                        Repair
                      </StyledButton>
                    )}
                    <button
                      type="button"
                      className="text-text-muted hover:text-text-primary transition-colors"
                      onClick={() => setVerifyResult(null)}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            )
          },
        },
      ]}
      data={records}
      loading={loading}
    />
  )
}
