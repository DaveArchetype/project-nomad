import { IconArrowsSort, IconSortAscending, IconSortDescending } from '@tabler/icons-react'
import type { DynamicIconName } from '~/lib/icons'
import type { KbFileGroup, KbFileSort, KbFileSortKey } from '~/lib/kb_file_grouping'
import type { KbIngestStateValue } from '../../../../types/kb_ingest_state'

export function renderSortHeader(
  label: string,
  key: KbFileSortKey,
  sort: KbFileSort,
  setSort: (s: KbFileSort) => void
): React.ReactNode {
  const active = sort.key === key
  const Icon = !active
    ? IconArrowsSort
    : sort.direction === 'asc'
      ? IconSortAscending
      : IconSortDescending
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-left hover:text-text-primary transition-colors"
      onClick={() => {
        if (!active) {
          setSort({ key, direction: 'asc' })
        } else {
          setSort({ key, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
        }
      }}
    >
      <span>{label}</span>
      <Icon
        size={14}
        className={active ? 'text-text-primary' : 'text-text-muted'}
        aria-hidden="true"
      />
    </button>
  )
}

export function renderStatePill(record: KbFileGroup): React.ReactNode {
  if (record.bucket === 'admin_docs') return null
  const effective: KbIngestStateValue = record.state ?? 'indexed'

  const base = 'inline-flex items-center text-xs font-medium rounded px-2 py-0.5 border'
  switch (effective) {
    case 'indexed':
      return (
        <span
          className={`${base} text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-950/40 dark:border-green-800`}
        >
          Indexed
        </span>
      )
    case 'pending_decision':
    case 'browse_only':
      return (
        <span className={`${base} text-text-secondary bg-surface-secondary border-border-subtle`}>
          Not Indexed
        </span>
      )
    case 'failed':
      return (
        <span
          className={`${base} text-red-700 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-950/40 dark:border-red-800`}
        >
          Failed
        </span>
      )
    case 'stalled':
      return (
        <span
          className={`${base} text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800`}
        >
          Stalled
        </span>
      )
  }
}

export type RowAction =
  | { kind: 'index'; label: string; force: boolean; variant: 'primary'; icon: DynamicIconName }
  | { kind: 'reembed'; label: string; force: true; variant: 'secondary'; icon: DynamicIconName }

export function pickRowAction(record: KbFileGroup, hasWarnings: boolean): RowAction | null {
  if (record.bucket === 'admin_docs') return null
  const effective: KbIngestStateValue = record.state ?? 'indexed'
  switch (effective) {
    case 'indexed':
      return hasWarnings
        ? {
            kind: 'reembed',
            label: 'Re-embed',
            force: true,
            variant: 'secondary',
            icon: 'IconRefreshAlert',
          }
        : null
    case 'pending_decision':
      return {
        kind: 'index',
        label: 'Index',
        force: false,
        variant: 'primary',
        icon: 'IconDownload',
      }
    case 'browse_only':
      return {
        kind: 'index',
        label: 'Index',
        force: true,
        variant: 'primary',
        icon: 'IconDownload',
      }
    case 'failed':
    case 'stalled':
      return { kind: 'index', label: 'Retry', force: true, variant: 'primary', icon: 'IconRefresh' }
  }
}
