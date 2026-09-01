import { AxiosInstance } from 'axios'
import { EmbedJobWithProgress, FileWarningsResult, StoredFileInfo } from '../../../types/rag'
import { catchInternal } from '../util'

export function getActiveEmbedJobs(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<EmbedJobWithProgress[]>('/rag/active-jobs')
    return response.data
  })()
}

export function getFailedEmbedJobs(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<EmbedJobWithProgress[]>('/rag/failed-jobs')
    return response.data
  })()
}

export function cleanupFailedEmbedJobs(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.delete<{
      message: string
      cleaned: number
      filesDeleted: number
    }>('/rag/failed-jobs')
    return response.data
  })()
}

export function cancelAllEmbedJobs(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.delete<{
      message: string
      cancelled: number
      filesDeleted: number
    }>('/rag/jobs')
    return response.data
  })()
}

export function resumeEmbedJob(client: AxiosInstance, jobId: string) {
  return catchInternal(async () => {
    const response = await client.post<{ message: string }>(
      `/rag/jobs/${encodeURIComponent(jobId)}/resume`
    )
    return response.data
  })()
}

export function pauseAllEmbedJobs(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<{ message: string; paused: number }>(
      '/rag/jobs/pause-all'
    )
    return response.data
  })()
}

export function resumeAllEmbedJobs(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<{ message: string; resumed: number }>(
      '/rag/jobs/resume-all'
    )
    return response.data
  })()
}

export function pauseEmbedJob(client: AxiosInstance, jobId: string) {
  return catchInternal(async () => {
    const response = await client.post<{ message: string }>(
      `/rag/jobs/${encodeURIComponent(jobId)}/pause`
    )
    return response.data
  })()
}

export function resumePausedEmbedJob(client: AxiosInstance, jobId: string) {
  return catchInternal(async () => {
    const response = await client.post<{ message: string }>(
      `/rag/jobs/${encodeURIComponent(jobId)}/resume-paused`
    )
    return response.data
  })()
}

export function checkRAGHealth(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ online: boolean; message?: string }>('/rag/health')
    return response.data
  })()
}

export function getStoredRAGFiles(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ files: StoredFileInfo[] }>('/rag/files')
    return response.data.files
  })()
}

export function embedSingleRAGFile(client: AxiosInstance, source: string, force: boolean = false) {
  return catchInternal(async () => {
    const response = await client.post<{ message: string }>('/rag/files/embed', {
      source,
      force,
    })
    return response.data
  })()
}

export function verifyRAGFile(client: AxiosInstance, source: string) {
  return catchInternal(async () => {
    const response = await client.post<{
      ok: boolean
      state: string | null
      chunksInQdrant: number
      chunksEmbeddedRecorded: number
      isZim: boolean
      totalArticles: number | null
      resumeOffset: number | null
      message: string
    }>('/rag/files/verify', { source })
    return response.data
  })()
}

export function resumeRAGFile(client: AxiosInstance, source: string) {
  return catchInternal(async () => {
    const response = await client.post<{ message: string }>('/rag/files/resume', {
      source,
    })
    return response.data
  })()
}

export function repairRAGFile(client: AxiosInstance, source: string) {
  return catchInternal(async () => {
    const response = await client.post<{ message: string }>('/rag/files/repair', {
      source,
    })
    return response.data
  })()
}

export function repairAllRAGFiles(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<{
      synced: string[]
      scanning: string[]
      skipped: string[]
      errors: Array<{ source: string; error: string }>
    }>('/rag/files/repair-all')
    return response.data
  })()
}

export function getKbFileWarnings(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<FileWarningsResult>('/rag/file-warnings')
    return response.data
  })()
}

export function deleteRAGFile(client: AxiosInstance, source: string) {
  return catchInternal(async () => {
    const response = await client.delete<{ message: string }>('/rag/files', {
      data: { source },
    })
    return response.data
  })()
}

export function getFileContent(client: AxiosInstance, source: string) {
  return catchInternal(async () => {
    const response = await client.get<{
      content: string
      extension: string
      fileName: string
    }>('/rag/files/content', { params: { source } })
    return response.data
  })()
}

export function getSourcePreviewImageUrl(source: string, kiwixPath?: string, index?: number): string {
  const params = new URLSearchParams({ source })
  if (kiwixPath && kiwixPath.length > 0) params.set('kiwixPath', kiwixPath)
  if (index !== undefined) params.set('index', String(index))
  return `/api/rag/files/preview-image?${params.toString()}`
}

export function syncRAGStorage(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<{
      success: boolean
      message: string
      filesScanned?: number
      filesQueued?: number
    }>('/rag/sync')
    return response.data
  })()
}

export function reembedAllRAG(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<{
      success: boolean
      message: string
      filesScanned?: number
      filesQueued?: number
    }>('/rag/re-embed-all')
    return response.data
  })()
}

export function resetAndRebuildRAG(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<{
      success: boolean
      message: string
      filesScanned?: number
      filesQueued?: number
    }>('/rag/reset-and-rebuild')
    return response.data
  })()
}

export function estimateEmbeddingBatch(
  client: AxiosInstance,
  files: { filename: string; sizeBytes: number }[]
) {
  return catchInternal(async () => {
    const response = await client.post<{
      totalChunks: number
      totalBytes: number
      hasUnknown: boolean
    }>('/rag/estimate-batch', { files })
    return response.data
  })()
}

export function getKbPolicyPromptState(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{
      shouldPrompt: boolean
      hasContent: boolean
      totalFiles: number
    }>('/rag/policy-prompt-state')
    return response.data
  })()
}

export function uploadDocument(client: AxiosInstance, file: File, collection?: string) {
  return catchInternal(async () => {
    const formData = new FormData()
    formData.append('file', file)
    if (collection) formData.append('collection', collection)
    const response = await client.post<{ message: string; file_path: string }>(
      '/rag/upload',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    )
    return response.data
  })()
}

export function getKnowledgeCollections(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ collections: string[] }>('/rag/collections')
    return response.data
  })()
}

export function updateFileCollection(
  client: AxiosInstance,
  source: string,
  collection: string | null
) {
  return catchInternal(async () => {
    const response = await client.post<{ message: string }>('/rag/update-collection', {
      source,
      collection,
    })
    return response.data
  })()
}

export function renameCollection(client: AxiosInstance, oldName: string, newName: string) {
  return catchInternal(async () => {
    const response = await client.post<{ message: string }>('/rag/rename-collection', {
      oldName,
      newName,
    })
    return response.data
  })()
}

export function deleteCollection(client: AxiosInstance, name: string) {
  return catchInternal(async () => {
    const response = await client.post<{ message: string }>('/rag/delete-collection', {
      name,
    })
    return response.data
  })()
}
