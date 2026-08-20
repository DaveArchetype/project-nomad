import StyledButton from '~/components/StyledButton'
import CollectionCombobox from '../CollectionCombobox'
import { formatBytes } from '~/lib/util'
import { renderStatePill, pickRowAction } from './helpers'
import { isViewableExtension } from './constants'
import type { KbFileCardProps } from './types'

export default function KbFileCard({
  record,
  fileWarnings,
  comboboxOptions,
  confirmDeleteSource,
  setConfirmDeleteSource,
  setConfirmReembed,
  setViewerSource,
  deleteMutation,
  embedMutation,
  updateCollectionMutation,
  qdrantOffline,
}: KbFileCardProps) {
  const warnings = fileWarnings[record.source] ?? []
  const pill = renderStatePill(record)
  const isConfirming = confirmDeleteSource === record.source
  const isDeleting = deleteMutation.isPending && confirmDeleteSource === record.source
  const action = pickRowAction(record, warnings.length > 0)
  const actionPendingForThisRow =
    embedMutation.isPending && embedMutation.variables?.source === record.source
  const canView =
    record.isUserUpload && isViewableExtension(record.displayName) && record.size !== null
  const canDownload = record.isUserUpload && record.size !== null
  const isSavingCollection =
    updateCollectionMutation.isPending &&
    updateCollectionMutation.variables?.source === record.source

  if (record.bucket === 'admin_docs') {
    return (
      <div
        key={record.source}
        className="rounded-lg border border-border-subtle bg-surface-primary p-4 space-y-2"
      >
        <p className="font-medium text-text-primary wrap-break-word">
          {record.displayName}
        </p>
        <p className="text-sm text-text-muted italic">Managed by NOMAD</p>
      </div>
    )
  }

  return (
    <div
      key={record.source}
      className="rounded-lg border border-border-subtle bg-surface-primary p-4 space-y-3"
    >
      <div className="min-w-0">
        <p className="font-medium text-text-primary wrap-break-word">
          {record.displayName}
        </p>
        {(pill || warnings.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {pill}
            {warnings.map((w, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 self-start text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded px-2 py-0.5"
              >
                <span aria-hidden="true">⚠</span>
                {w.kind === 'zero_chunks' && (
                  <span>Embedded 0 chunks — no text content.</span>
                )}
                {w.kind === 'partial_stall' && (
                  <span>
                    Only {w.chunksEmbedded.toLocaleString()} of est.{' '}
                    {w.chunksExpected.toLocaleString()} chunks embedded — may have stalled.
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-text-muted">Size</dt>
        <dd className="text-text-secondary text-right">
          {record.size === null ? '—' : formatBytes(record.size)}
        </dd>
        <dt className="text-text-muted">Uploaded</dt>
        <dd className="text-text-secondary text-right">
          {record.uploadedAt ? new Date(record.uploadedAt).toLocaleDateString() : '—'}
        </dd>
      </dl>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-text-muted">Collection</span>
        <CollectionCombobox
          value={record.collection ?? ''}
          onChange={(val) => updateCollectionMutation.mutate({ source: record.source, collection: val })}
          options={comboboxOptions}
          disabled={isSavingCollection}
          className="w-full"
        />
      </div>

      {isConfirming ? (
        <div className="flex flex-col gap-2 pt-1 border-t border-border-subtle">
          <span className="text-sm text-text-secondary pt-2">
            Remove from knowledge base?
          </span>
          <div className="flex flex-col gap-2">
            <StyledButton
              variant="danger"
              size="sm"
              onClick={() => deleteMutation.mutate(record.source)}
              disabled={isDeleting}
              fullWidth
            >
              {isDeleting ? 'Deleting…' : 'Confirm'}
            </StyledButton>
            <StyledButton
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDeleteSource(null)}
              disabled={isDeleting}
              fullWidth
            >
              Cancel
            </StyledButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border-subtle">
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
                  embedMutation.mutate({ source: record.source, force: action.force })
                }
              }}
              disabled={qdrantOffline || deleteMutation.isPending || embedMutation.isPending}
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
            loading={deleteMutation.isPending && confirmDeleteSource === record.source}
          >
            Delete
          </StyledButton>
        </div>
      )}
    </div>
  )
}
