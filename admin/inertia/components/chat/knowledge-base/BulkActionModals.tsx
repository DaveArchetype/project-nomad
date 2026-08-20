import StyledModal from '../../StyledModal'
import type { UseMutationResult } from '@tanstack/react-query'

interface BulkActionModalsProps {
  bulkMode: null | 'reembed' | 'reset'
  setBulkMode: (m: null | 'reembed' | 'reset') => void
  resetTyped: string
  setResetTyped: (s: string) => void
  reembedMutation: UseMutationResult<unknown, Error, void>
  resetMutation: UseMutationResult<unknown, Error, void>
  embedMutation: UseMutationResult<unknown, Error, { source: string; force: boolean }>
  confirmReembed: { source: string; displayName: string } | null
  setConfirmReembed: (r: { source: string; displayName: string } | null) => void
  storedFilesCount: number
}

export default function BulkActionModals({
  bulkMode,
  setBulkMode,
  resetTyped,
  setResetTyped,
  reembedMutation,
  resetMutation,
  embedMutation,
  confirmReembed,
  setConfirmReembed,
  storedFilesCount,
}: BulkActionModalsProps) {
  return (
    <>
      {bulkMode === 'reembed' && (
        <StyledModal
          title="Re-embed All Documents?"
          open={true}
          confirmText={reembedMutation.isPending ? 'Re-embedding…' : 'Re-embed All'}
          cancelText="Cancel"
          confirmVariant="primary"
          confirmLoading={reembedMutation.isPending}
          onConfirm={() => reembedMutation.mutate()}
          onCancel={() => setBulkMode(null)}
        >
          <div className="text-text-primary text-sm space-y-3 text-left">
            <p>
              This will re-process every document currently in your knowledge base — about
              <strong>
                {' '}
                {storedFilesCount} file{storedFilesCount === 1 ? '' : 's'}
              </strong>
              . For each file, NOMAD will delete the existing embeddings from Qdrant and queue a
              fresh embedding job using the current chunking and embedding model.
            </p>
            <div className="rounded border border-border-subtle bg-surface-secondary p-3">
              <p className="font-semibold mb-1">What this is for</p>
              <p className="text-text-secondary">
                Use this when the embedding model or chunking logic has changed, or when you suspect
                stored vectors are stale. Files on disk are <em>not</em> deleted, and any orphan
                points whose source file is no longer present will be preserved untouched (see
                <em> Reset &amp; Rebuild </em>if you want a fully clean slate).
              </p>
            </div>
            <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 p-3 text-amber-900 dark:text-amber-200">
              <p className="font-semibold mb-1">Heads up</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  Embedding {storedFilesCount} file{storedFilesCount === 1 ? '' : 's'} may take
                  a long time, especially for large PDFs or ZIM archives.
                </li>
                <li>
                  On systems without GPU acceleration, expect sustained high CPU usage for the
                  duration.
                </li>
                <li>
                  Knowledge Base search results may be incomplete until every file finishes
                  re-embedding.
                </li>
                <li>
                  If embed jobs are already in progress, this action will be refused — wait for the
                  queue to drain first.
                </li>
              </ul>
            </div>
          </div>
        </StyledModal>
      )}

      {bulkMode === 'reset' && (
        <StyledModal
          title="Reset & Rebuild Knowledge Base?"
          open={true}
          confirmText={resetMutation.isPending ? 'Resetting…' : 'Wipe & Rebuild'}
          cancelText="Cancel"
          confirmVariant="danger"
          confirmLoading={resetMutation.isPending}
          onConfirm={() => {
            if (resetTyped === 'RESET') resetMutation.mutate()
          }}
          onCancel={() => {
            setBulkMode(null)
            setResetTyped('')
          }}
        >
          <div className="text-text-primary text-sm space-y-3 text-left">
            <p>
              This will <strong>permanently delete every point</strong> in the
              <code> nomad_knowledge_base </code>Qdrant collection and rebuild from the
              <strong>
                {' '}
                {storedFilesCount} file{storedFilesCount === 1 ? '' : 's'}
              </strong>{' '}
              currently on disk. The collection is dropped, recreated, and every file is re-queued
              for embedding.
            </p>
            <div className="rounded border border-border-subtle bg-surface-secondary p-3">
              <p className="font-semibold mb-1">How this differs from Re-embed All</p>
              <ul className="list-disc pl-5 space-y-1 text-text-secondary">
                <li>
                  <strong>Re-embed All</strong> replaces vectors file-by-file. Any orphan points
                  (vectors whose source file was deleted from disk at some point) are preserved.
                </li>
                <li>
                  <strong>Reset &amp; Rebuild</strong> drops the entire collection. Orphan points
                  are <strong>gone forever</strong>. Only files currently on disk will exist in
                  Qdrant afterwards.
                </li>
              </ul>
            </div>
            <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-800 p-3 text-red-900 dark:text-red-200">
              <p className="font-semibold mb-1">This action is destructive and cannot be undone</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  Knowledge Base search will be empty until embedding finishes (potentially hours on
                  CPU-only systems).
                </li>
                <li>
                  For a few seconds during the reset, the Qdrant collection does not exist — any
                  chat-with-RAG queries in that window may return a "collection not found" error.
                  Avoid using chat until the rebuild has begun.
                </li>
                <li>
                  If embed jobs are already in progress, this action will be refused — wait for the
                  queue to drain first.
                </li>
              </ul>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Type <code>RESET</code> to confirm:
              </label>
              <input
                type="text"
                value={resetTyped}
                onChange={(e) => setResetTyped(e.target.value)}
                placeholder="RESET"
                autoFocus
                className="w-full rounded border border-border-subtle bg-surface-primary px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              {resetTyped.length > 0 && resetTyped !== 'RESET' && (
                <p className="text-xs text-red-600 mt-1">
                  Type RESET exactly (uppercase, no spaces) to enable the confirm button.
                </p>
              )}
            </div>
          </div>
        </StyledModal>
      )}

      {confirmReembed && (
        <StyledModal
          title="Re-embed this file?"
          open={true}
          confirmText={embedMutation.isPending ? 'Queuing…' : 'Re-embed'}
          cancelText="Cancel"
          confirmVariant="primary"
          confirmLoading={embedMutation.isPending}
          onConfirm={() => embedMutation.mutate({ source: confirmReembed.source, force: true })}
          onCancel={() => setConfirmReembed(null)}
        >
          <div className="text-text-primary text-sm space-y-3 text-left">
            <p>
              This will delete the existing embeddings for{' '}
              <strong>{confirmReembed.displayName}</strong> and queue a fresh embedding job. The
              file on disk is not touched.
            </p>
            <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 p-3 text-amber-900 dark:text-amber-200">
              <p className="font-semibold mb-1">Heads up</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  For large ZIM archives this can take a long time, especially on CPU-only systems.
                </li>
                <li>
                  Search results that referenced this file will be incomplete until the new
                  embedding finishes.
                </li>
                <li>
                  If a job for this file is already running, the re-embed will be refused — wait for
                  it to finish first.
                </li>
              </ul>
            </div>
          </div>
        </StyledModal>
      )}
    </>
  )
}
