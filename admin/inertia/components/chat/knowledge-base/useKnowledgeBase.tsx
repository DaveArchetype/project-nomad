import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type FileUploader from '~/components/file-uploader'
import { useNotifications } from '~/context/NotificationContext'
import { useModals } from '~/context/ModalContext'
import api from '~/lib/api'
import type { KbFileSort } from '~/lib/kb_file_grouping'
import { KB_COLLECTIONS } from '../../../../constants/kb_collections'
import { SERVICE_NAMES } from '../../../../constants/service_names'
import StyledModal from '../../StyledModal'

export interface UseKnowledgeBaseResult {
  files: File[]
  setFiles: (f: File[]) => void
  isUploading: boolean
  uploadCollection: string
  setUploadCollection: (s: string) => void
  collectionFilter: string
  setCollectionFilter: (s: string) => void
  manageCollectionsOpen: boolean
  setManageCollectionsOpen: (b: boolean) => void
  confirmDeleteSource: string | null
  setConfirmDeleteSource: (s: string | null) => void
  confirmReembed: { source: string; displayName: string } | null
  setConfirmReembed: (r: { source: string; displayName: string } | null) => void
  bulkMode: null | 'reembed' | 'reset'
  setBulkMode: (m: null | 'reembed' | 'reset') => void
  resetTyped: string
  setResetTyped: (s: string) => void
  sort: KbFileSort
  setSort: (s: KbFileSort) => void
  viewerSource: string | null
  setViewerSource: (s: string | null) => void
  fileUploaderRef: React.RefObject<React.ComponentRef<typeof FileUploader> | null>

  qdrantOffline: boolean
  isStartingQdrant: boolean
  storedFiles: ReturnType<typeof useQuery<any>>['data']
  isLoadingFiles: boolean
  knownCollections: string[]
  comboboxOptions: string[]
  fileWarnings: Record<string, import('../../../../types/rag').FileWarning[]>
  warningsUnavailable: boolean
  ingestPolicy: 'Always' | 'Manual'

  uploadMutation: ReturnType<typeof useMutation<unknown, Error, File>>
  updateIngestPolicyMutation: ReturnType<
    typeof useMutation<unknown, Error, 'Always' | 'Manual'>
  >
  updateCollectionMutation: ReturnType<
    typeof useMutation<unknown, Error, { source: string; collection: string }>
  >
  deleteMutation: ReturnType<typeof useMutation<void, Error, string>>
  embedMutation: ReturnType<
    typeof useMutation<unknown, Error, { source: string; force: boolean }>
  >
  cleanupFailedMutation: ReturnType<typeof useMutation<unknown, Error, void>>
  cancelAllMutation: ReturnType<typeof useMutation<unknown, Error, void>>
  startQdrantMutation: ReturnType<typeof useMutation<unknown, Error, void>>
  syncMutation: ReturnType<typeof useMutation<unknown, Error, void>>
  reembedMutation: ReturnType<typeof useMutation<unknown, Error, void>>
  resetMutation: ReturnType<typeof useMutation<unknown, Error, void>>
  bulkBusy: boolean

  handleUpload: () => Promise<void>
  handleConfirmCancelAll: () => void
  handleConfirmSync: () => void
}

export function useKnowledgeBase(): UseKnowledgeBaseResult {
  const { addNotification } = useNotifications()
  const [files, setFiles] = useState<File[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadCollection, setUploadCollection] = useState<string>('')
  const [collectionFilter, setCollectionFilter] = useState<string>('All')
  const [manageCollectionsOpen, setManageCollectionsOpen] = useState(false)
  const [confirmDeleteSource, setConfirmDeleteSource] = useState<string | null>(null)
  const [confirmReembed, setConfirmReembed] = useState<{
    source: string
    displayName: string
  } | null>(null)
  const [bulkMode, setBulkMode] = useState<null | 'reembed' | 'reset'>(null)
  const [resetTyped, setResetTyped] = useState('')
  const [sort, setSort] = useState<KbFileSort>({ key: 'name', direction: 'asc' })
  const [viewerSource, setViewerSource] = useState<string | null>(null)
  const fileUploaderRef = useRef<React.ComponentRef<typeof FileUploader>>(null)
  const { openModal, closeModal } = useModals()
  const queryClient = useQueryClient()

  const [isStartingQdrant, setIsStartingQdrant] = useState(false)

  const { data: healthStatus } = useQuery({
    queryKey: ['qdrantHealth'],
    queryFn: () => api.checkRAGHealth(),
    refetchInterval: isStartingQdrant ? 3_000 : 30_000,
  })
  const qdrantOffline = healthStatus?.online === false

  useEffect(() => {
    if (!qdrantOffline) setIsStartingQdrant(false)
  }, [qdrantOffline])

  const { data: storedFiles = [], isLoading: isLoadingFiles } = useQuery({
    queryKey: ['storedFiles'],
    queryFn: () => api.getStoredRAGFiles(),
    select: (data) => data || [],
  })

  const { data: knownCollections = [] } = useQuery({
    queryKey: ['kbCollections'],
    queryFn: () => api.getKnowledgeCollections(),
    select: (data) => data?.collections ?? [],
  })

  const comboboxOptions = useMemo(() => {
    return Array.from(new Set([...KB_COLLECTIONS, ...knownCollections])).sort()
  }, [knownCollections])

  const { data: warningsResult } = useQuery({
    queryKey: ['kbFileWarnings'],
    queryFn: () => api.getKbFileWarnings(),
    refetchInterval: 30_000,
  })
  const fileWarnings = warningsResult?.warnings ?? {}
  const warningsUnavailable = warningsResult !== undefined && warningsResult.ok === false

  const { data: ingestPolicySetting } = useQuery({
    queryKey: ['ingestPolicy'],
    queryFn: () => api.getSetting('rag.defaultIngestPolicy'),
  })
  const ingestPolicy: 'Always' | 'Manual' =
    ingestPolicySetting?.value === 'Manual' ? 'Manual' : 'Always'

  const updateIngestPolicyMutation = useMutation({
    mutationFn: (policy: 'Always' | 'Manual') =>
      api.updateSetting('rag.defaultIngestPolicy', policy),
    onSuccess: (_data, policy) => {
      queryClient.invalidateQueries({ queryKey: ['ingestPolicy'] })
      addNotification({
        type: 'success',
        message:
          policy === 'Always'
            ? 'New content will be auto-indexed for AI.'
            : 'New content will wait for you to opt in.',
      })
    },
    onError: (error: any) => {
      addNotification({
        type: 'error',
        message: error?.message || 'Failed to update indexing policy.',
      })
    },
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.uploadDocument(file, uploadCollection || undefined),
  })

  const updateCollectionMutation = useMutation({
    mutationFn: ({ source, collection }: { source: string; collection: string }) =>
      api.updateFileCollection(source, collection || null),
    onSuccess: (data) => {
      addNotification({ type: 'success', message: data?.message || 'Collection updated.' })
      queryClient.invalidateQueries({ queryKey: ['storedFiles'] })
      queryClient.invalidateQueries({ queryKey: ['kbCollections'] })
    },
    onError: (error: any) => {
      addNotification({ type: 'error', message: error?.message || 'Failed to update collection.' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (source: string) => api.deleteRAGFile(source),
    onSuccess: () => {
      addNotification({ type: 'success', message: 'File removed from knowledge base.' })
      setConfirmDeleteSource(null)
      queryClient.invalidateQueries({ queryKey: ['storedFiles'] })
    },
    onError: (error: any) => {
      addNotification({ type: 'error', message: error?.message || 'Failed to delete file.' })
      setConfirmDeleteSource(null)
    },
  })

  const embedMutation = useMutation({
    mutationFn: ({ source, force }: { source: string; force: boolean }) =>
      api.embedSingleRAGFile(source, force),
    onSuccess: (data) => {
      addNotification({
        type: 'success',
        message: data?.message || 'File queued for embedding.',
      })
      setConfirmReembed(null)
      queryClient.invalidateQueries({ queryKey: ['storedFiles'] })
      queryClient.invalidateQueries({ queryKey: ['embed-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['kbFileWarnings'] })
    },
    onError: (error: any) => {
      addNotification({ type: 'error', message: error?.message || 'Failed to queue file.' })
      setConfirmReembed(null)
    },
  })

  const cleanupFailedMutation = useMutation({
    mutationFn: () => api.cleanupFailedEmbedJobs(),
    onSuccess: (data) => {
      addNotification({ type: 'success', message: data?.message || 'Failed jobs cleaned up.' })
      queryClient.invalidateQueries({ queryKey: ['failedEmbedJobs'] })
    },
    onError: (error: any) => {
      addNotification({ type: 'error', message: error?.message || 'Failed to clean up jobs.' })
    },
  })

  const cancelAllMutation = useMutation({
    mutationFn: () => api.cancelAllEmbedJobs(),
    onSuccess: (data) => {
      addNotification({
        type: 'success',
        message: data?.message || 'All embedding jobs cancelled.',
      })
      queryClient.invalidateQueries({ queryKey: ['embed-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['failedEmbedJobs'] })
      queryClient.invalidateQueries({ queryKey: ['storedFiles'] })
      queryClient.invalidateQueries({ queryKey: ['kbFileWarnings'] })
    },
    onError: (error: any) => {
      addNotification({ type: 'error', message: error?.message || 'Failed to cancel jobs.' })
    },
  })

  const startQdrantMutation = useMutation({
    mutationFn: () => api.affectService(SERVICE_NAMES.QDRANT, 'start'),
    onSuccess: () => {
      setIsStartingQdrant(true)
      queryClient.invalidateQueries({ queryKey: ['qdrantHealth'] })
    },
    onError: (error: any) => {
      addNotification({ type: 'error', message: error?.message || 'Failed to start Qdrant.' })
    },
  })

  const syncMutation = useMutation({
    mutationFn: () => api.syncRAGStorage(),
    onSuccess: (data) => {
      addNotification({
        type: 'success',
        message:
          data?.message ||
          'Storage synced successfully. If new files were found, they have been queued for processing.',
      })
    },
    onError: (error: any) => {
      addNotification({
        type: 'error',
        message: error?.message || 'Failed to sync storage',
      })
    },
  })

  const reembedMutation = useMutation({
    mutationFn: () => api.reembedAllRAG(),
    onSuccess: (data) => {
      addNotification({
        type: data?.success ? 'success' : 'error',
        message: data?.message || 'Re-embed completed.',
      })
      queryClient.invalidateQueries({ queryKey: ['storedFiles'] })
      queryClient.invalidateQueries({ queryKey: ['embed-jobs'] })
      setBulkMode(null)
      setResetTyped('')
    },
    onError: () => {
      addNotification({ type: 'error', message: 'Failed to re-embed knowledge base.' })
      setBulkMode(null)
    },
  })

  const resetMutation = useMutation({
    mutationFn: () => api.resetAndRebuildRAG(),
    onSuccess: (data) => {
      addNotification({
        type: data?.success ? 'success' : 'error',
        message: data?.message || 'Reset complete.',
      })
      queryClient.invalidateQueries({ queryKey: ['storedFiles'] })
      queryClient.invalidateQueries({ queryKey: ['embed-jobs'] })
      setBulkMode(null)
      setResetTyped('')
    },
    onError: () => {
      addNotification({ type: 'error', message: 'Failed to reset knowledge base.' })
      setBulkMode(null)
    },
  })

  const bulkBusy = reembedMutation.isPending || resetMutation.isPending

  const handleUpload = async () => {
    if (files.length === 0) return
    setIsUploading(true)
    let successCount = 0
    const failedNames: string[] = []

    for (const file of files) {
      try {
        await uploadMutation.mutateAsync(file)
        successCount++
      } catch (error: any) {
        failedNames.push(file.name)
      }
    }

    setIsUploading(false)
    setFiles([])
    fileUploaderRef.current?.clear()
    queryClient.invalidateQueries({ queryKey: ['embed-jobs'] })

    if (successCount > 0) {
      addNotification({
        type: 'success',
        message: `${successCount} file${successCount > 1 ? 's' : ''} queued for processing.`,
      })
    }
    for (const name of failedNames) {
      addNotification({ type: 'error', message: `Failed to upload: ${name}` })
    }
  }

  const handleConfirmCancelAll = () => {
    openModal(
      <StyledModal
        title="Cancel All Embedding Jobs?"
        onConfirm={() => {
          cancelAllMutation.mutate()
          closeModal('confirm-cancel-all-modal')
        }}
        onCancel={() => closeModal('confirm-cancel-all-modal')}
        open={true}
        confirmText="Cancel All Jobs"
        cancelText="Keep Jobs"
        confirmVariant="danger"
      >
        <p className="text-text-primary">
          This stops <strong>every</strong> embedding job — including ones still in progress or
          stuck — and clears the processing queue. The uploaded source files for those jobs are
          deleted, so you'll need to re-upload anything you still want indexed. Stored files that
          already finished embedding are not affected. Are you sure you want to proceed?
        </p>
      </StyledModal>,
      'confirm-cancel-all-modal'
    )
  }

  const handleConfirmSync = () => {
    openModal(
      <StyledModal
        title="Confirm Sync?"
        onConfirm={() => {
          syncMutation.mutate()
          closeModal('confirm-sync-modal')
        }}
        onCancel={() => closeModal('confirm-sync-modal')}
        open={true}
        confirmText="Confirm Sync"
        cancelText="Cancel"
        confirmVariant="primary"
      >
        <p className="text-text-primary">
          This will scan the NOMAD's storage directories for any new files and queue them for
          processing. This is useful if you've manually added files to the storage or want to ensure
          everything is up to date. This may cause a temporary increase in resource usage if new
          files are found and being processed. Are you sure you want to proceed?
        </p>
      </StyledModal>,
      'confirm-sync-modal'
    )
  }

  return {
    files,
    setFiles,
    isUploading,
    uploadCollection,
    setUploadCollection,
    collectionFilter,
    setCollectionFilter,
    manageCollectionsOpen,
    setManageCollectionsOpen,
    confirmDeleteSource,
    setConfirmDeleteSource,
    confirmReembed,
    setConfirmReembed,
    bulkMode,
    setBulkMode,
    resetTyped,
    setResetTyped,
    sort,
    setSort,
    viewerSource,
    setViewerSource,
    fileUploaderRef,

    qdrantOffline,
    isStartingQdrant,
    storedFiles,
    isLoadingFiles,
    knownCollections,
    comboboxOptions,
    fileWarnings,
    warningsUnavailable,
    ingestPolicy,

    uploadMutation,
    updateIngestPolicyMutation,
    updateCollectionMutation,
    deleteMutation,
    embedMutation,
    cleanupFailedMutation,
    cancelAllMutation,
    startQdrantMutation,
    syncMutation,
    reembedMutation,
    resetMutation,
    bulkBusy,

    handleUpload,
    handleConfirmCancelAll,
    handleConfirmSync,
  }
}
