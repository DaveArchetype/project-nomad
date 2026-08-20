import type { UseMutationResult } from '@tanstack/react-query'
import type { KbFileGroup, KbFileSort } from '~/lib/kb_file_grouping'
import type { FileWarning, StoredFileInfo } from '../../../../types/rag'

export interface KbFileActions {
  confirmDeleteSource: string | null
  setConfirmDeleteSource: (s: string | null) => void
  setConfirmReembed: (r: { source: string; displayName: string } | null) => void
  setViewerSource: (s: string | null) => void
  deleteMutation: UseMutationResult<void, Error, string>
  embedMutation: UseMutationResult<unknown, Error, { source: string; force: boolean }>
  updateCollectionMutation: UseMutationResult<
    unknown,
    Error,
    { source: string; collection: string }
  >
  qdrantOffline: boolean
}

export interface KbFileCardProps extends KbFileActions {
  record: KbFileGroup
  fileWarnings: Record<string, FileWarning[]>
  comboboxOptions: string[]
}

export interface KbFileCardListProps extends KbFileActions {
  records: KbFileGroup[]
  loading: boolean
  fileWarnings: Record<string, FileWarning[]>
  comboboxOptions: string[]
  sort: KbFileSort
  setSort: (s: KbFileSort) => void
}

export interface KbFileTableProps extends KbFileActions {
  records: KbFileGroup[]
  loading: boolean
  fileWarnings: Record<string, FileWarning[]>
  comboboxOptions: string[]
  sort: KbFileSort
  setSort: (s: KbFileSort) => void
}

export interface StoredFilesSectionProps {
  isMobile: boolean
  storedFiles: StoredFileInfo[]
  isLoadingFiles: boolean
  knownCollections: string[]
  collectionFilter: string
  setCollectionFilter: (s: string) => void
  comboboxOptions: string[]
  sort: KbFileSort
  setSort: (s: KbFileSort) => void
  warningsUnavailable: boolean
  isUploading: boolean
  qdrantOffline: boolean
  bulkBusy: boolean
  resetMutationPending: boolean
  reembedMutationPending: boolean
  syncMutationPending: boolean
  onManageCollectionsOpen: () => void
  onResetRebuild: () => void
  onReembedAll: () => void
  onSyncStorage: () => void
  fileWarnings: Record<string, FileWarning[]>
  confirmDeleteSource: string | null
  setConfirmDeleteSource: (s: string | null) => void
  setConfirmReembed: (r: { source: string; displayName: string } | null) => void
  setViewerSource: (s: string | null) => void
  deleteMutation: UseMutationResult<void, Error, string>
  embedMutation: UseMutationResult<unknown, Error, { source: string; force: boolean }>
  updateCollectionMutation: UseMutationResult<
    unknown,
    Error,
    { source: string; collection: string }
  >
}
