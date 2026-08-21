import type { KbFileSortKey } from '~/lib/kb_file_grouping'
import KbFileCard from './KbFileCard'
import type { KbFileCardListProps } from './types'

export default function KbFileCardList({
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
}: KbFileCardListProps) {
  const sortOptions: { label: string; key: KbFileSortKey }[] = [
    { label: 'Name', key: 'name' },
    { label: 'Size', key: 'size' },
    { label: 'Uploaded', key: 'uploadedAt' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <span className="shrink-0">Sort by:</span>
        <div className="inline-flex rounded-md overflow-hidden border border-border-subtle flex-1">
          {sortOptions.map((opt) => {
            const isActive = sort.key === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  if (!isActive) {
                    setSort({ key: opt.key, direction: 'asc' })
                  } else {
                    setSort({ key: opt.key, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
                  }
                }}
                className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-desert-green text-white'
                    : 'bg-surface-primary text-text-secondary hover:bg-surface-tertiary'
                }`}
              >
                {opt.label}
                {isActive && (sort.direction === 'asc' ? ' ↑' : ' ↓')}
              </button>
            )
          })}
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center text-text-muted">Loading…</div>
      ) : records.length === 0 ? (
        <div className="py-8 text-center text-text-muted">No records found</div>
      ) : (
        records.map((record) => (
          <KbFileCard
            key={record.source}
            record={record}
            fileWarnings={fileWarnings}
            comboboxOptions={comboboxOptions}
            confirmDeleteSource={confirmDeleteSource}
            setConfirmDeleteSource={setConfirmDeleteSource}
            setConfirmReembed={setConfirmReembed}
            setViewerSource={setViewerSource}
            deleteMutation={deleteMutation}
            embedMutation={embedMutation}
            updateCollectionMutation={updateCollectionMutation}
            qdrantOffline={qdrantOffline}
            inflightSources={inflightSources}
          />
        ))
      )}
    </div>
  )
}
