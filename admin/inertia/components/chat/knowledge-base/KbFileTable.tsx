import StyledButton from '~/components/StyledButton'
import StyledTable from '~/components/StyledTable'
import CollectionCombobox from '../CollectionCombobox'
import { formatBytes } from '~/lib/util'
import type { KbFileGroup } from '~/lib/kb_file_grouping'
import { renderSortHeader, renderStatePill, pickRowAction } from './helpers'
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
}: KbFileTableProps) {
  return (
    <StyledTable<KbFileGroup>
      className="font-semibold"
      rowLines={true}
      columns={[
        {
          accessor: 'source',
          title: renderSortHeader('File Name', 'name', sort, setSort),
          render(record) {
            const warnings = fileWarnings[record.source] ?? []
            const pill = renderStatePill(record)
            return (
              <div className="flex flex-col gap-1.5">
                <span className="text-text-primary">{record.displayName}</span>
                {(pill || warnings.length > 0) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {pill}
                    {warnings.map((w, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 self-start text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded px-2 py-0.5"
                      >
                        <span aria-hidden="true">⚠</span>
                        {w.kind === 'zero_chunks' && (
                          <span>
                            Embedded 0 chunks — this file has no text content. AI
                            Assistant cannot reference it.
                          </span>
                        )}
                        {w.kind === 'partial_stall' && (
                          <span>
                            Only {w.chunksEmbedded.toLocaleString()} of est.{' '}
                            {w.chunksExpected.toLocaleString()} chunks embedded —
                            ingestion may have stalled.
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
          render(record) {
            if (record.bucket === 'admin_docs') {
              return (
                <div className="flex justify-end">
                  <span className="text-sm text-text-muted italic">Managed by NOMAD</span>
                </div>
              )
            }

            const isConfirming = confirmDeleteSource === record.source
            const isDeleting =
              deleteMutation.isPending && confirmDeleteSource === record.source
            if (isConfirming) {
              return (
                <div className="flex items-center gap-2 justify-end">
                  <span className="text-sm text-text-secondary">
                    Remove from knowledge base?
                  </span>
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
            const action = pickRowAction(record, warnings.length > 0)
            const actionPendingForThisRow =
              embedMutation.isPending && embedMutation.variables?.source === record.source

            const canView =
              record.isUserUpload &&
              isViewableExtension(record.displayName) &&
              record.size !== null
            const canDownload = record.isUserUpload && record.size !== null

            return (
              <div className="flex justify-end items-center gap-2">
                {action && (
                  <StyledButton
                    variant={action.variant}
                    size="sm"
                    icon={action.icon}
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
                    {action.label}
                  </StyledButton>
                )}
                {canView && (
                  <StyledButton
                    variant="ghost"
                    size="sm"
                    icon="IconEye"
                    onClick={() => setViewerSource(record.source)}
                  >
                    View
                  </StyledButton>
                )}
                {canDownload && (
                  <StyledButton
                    variant="ghost"
                    size="sm"
                    icon="IconDownload"
                    onClick={() => {
                      window.location.href = `/api/rag/files/download?source=${encodeURIComponent(record.source)}`
                    }}
                  >
                    Download
                  </StyledButton>
                )}
                <StyledButton
                  variant="danger"
                  size="sm"
                  icon="IconTrash"
                  onClick={() => setConfirmDeleteSource(record.source)}
                  disabled={deleteMutation.isPending || embedMutation.isPending}
                  loading={
                    deleteMutation.isPending && confirmDeleteSource === record.source
                  }
                >
                  Delete
                </StyledButton>
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
