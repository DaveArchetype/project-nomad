import { AxiosInstance } from 'axios'
import { ListRemoteZimFilesResponse, ListZimFilesResponse } from '../../../types/zim'
import { DownloadJobWithProgress, WikipediaState } from '../../../types/downloads'
import { catchInternal } from '../util'

export function downloadRemoteZimFile(
  client: AxiosInstance,
  url: string,
  metadata?: { title: string; summary?: string; author?: string; size_bytes?: number }
) {
  return catchInternal(async () => {
    const response = await client.post<{ message: string; filename: string; url: string }>(
      '/zim/download-remote',
      { url, metadata }
    )
    return response.data
  })()
}

export function downloadCategoryTier(
  client: AxiosInstance,
  categorySlug: string,
  tierSlug: string
) {
  return catchInternal(async () => {
    const response = await client.post('/zim/download-category-tier', {
      categorySlug,
      tierSlug,
    })
    return response.data
  })()
}

export function listRemoteZimFiles(
  client: AxiosInstance,
  { start = 0, count = 12, query }: { start?: number; count?: number; query?: string }
) {
  return catchInternal(async () => {
    return await client.get<ListRemoteZimFilesResponse>('/zim/list-remote', {
      params: {
        start,
        count,
        query,
      },
    })
  })()
}

export function listCustomLibraries(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<
      { id: number; name: string; base_url: string; is_default: boolean }[]
    >('/zim/custom-libraries')
    return response.data
  })()
}

export function addCustomLibrary(client: AxiosInstance, name: string, base_url: string) {
  return catchInternal(async () => {
    const response = await client.post<{
      message: string
      library: { id: number; name: string; base_url: string }
    }>('/zim/custom-libraries', { name, base_url })
    return response.data
  })()
}

export function removeCustomLibrary(client: AxiosInstance, id: number) {
  return catchInternal(async () => {
    const response = await client.delete<{ message: string }>(`/zim/custom-libraries/${id}`)
    return response.data
  })()
}

export function browseLibrary(client: AxiosInstance, url: string) {
  return catchInternal(async () => {
    const response = await client.get<{
      directories: { name: string; url: string }[]
      files: { name: string; url: string; size_bytes: number | null }[]
    }>('/zim/browse-library', { params: { url } })
    return response.data
  })()
}

export function deleteZimFile(client: AxiosInstance, filename: string) {
  return catchInternal(async () => {
    const response = await client.delete<{ message: string }>(`/zim/${filename}`)
    return response.data
  })()
}

export function listZimFiles(client: AxiosInstance) {
  return catchInternal(async () => {
    return await client.get<ListZimFilesResponse>('/zim/list')
  })()
}

export function rescanZimLibrary(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<{
      message: string
      before: number
      after: number
      added: number
    }>('/zim/rescan-library')
    return response.data
  })()
}

export function getWikipediaState(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<WikipediaState>('/zim/wikipedia')
    return response.data
  })()
}

export function selectWikipedia(client: AxiosInstance, optionId: string) {
  return catchInternal(async () => {
    const response = await client.post<{
      success: boolean
      jobId?: string
      message?: string
    }>('/zim/wikipedia/select', { optionId })
    return response.data
  })()
}

export function listDownloadJobs(client: AxiosInstance, filetype?: string) {
  return catchInternal(async () => {
    const endpoint = filetype ? `/downloads/jobs/${filetype}` : '/downloads/jobs'
    const response = await client.get<DownloadJobWithProgress[]>(endpoint)
    return response.data
  })()
}

export function removeDownloadJob(client: AxiosInstance, jobId: string) {
  return catchInternal(async () => {
    await client.delete(`/downloads/jobs/${jobId}`)
  })()
}

export function cancelDownloadJob(client: AxiosInstance, jobId: string) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean; message: string }>(
      `/downloads/jobs/${jobId}/cancel`
    )
    return response.data
  })()
}

export function retryDownloadJob(client: AxiosInstance, jobId: string) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean; message: string }>(
      `/downloads/jobs/${jobId}/retry`
    )
    return response.data
  })()
}
