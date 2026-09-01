import { AxiosInstance } from 'axios'
import type {
  CategoryWithStatus,
  ContentUpdateCheckResult,
  CreatorPackWithStatus,
  ResourceUpdateInfo,
} from '../../../types/collections'
import { DownloadJobWithProgress } from '../../../types/downloads'
import { catchInternal } from '../util'

export function checkForContentUpdates(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<ContentUpdateCheckResult>('/content-updates/check')
    return response.data
  })()
}

export function applyContentUpdate(client: AxiosInstance, update: ResourceUpdateInfo) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean; jobId?: string; error?: string }>(
      '/content-updates/apply',
      update
    )
    return response.data
  })()
}

export function applyAllContentUpdates(client: AxiosInstance, updates: ResourceUpdateInfo[]) {
  return catchInternal(async () => {
    const response = await client.post<{
      results: Array<{ resource_id: string; success: boolean; jobId?: string; error?: string }>
    }>('/content-updates/apply-all', { updates })
    return response.data
  })()
}

export function refreshManifests(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<{
      success: boolean
      changed: Record<string, boolean>
    }>('/manifests/refresh')
    return response.data
  })()
}

export function listCuratedCategories(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<CategoryWithStatus[]>('/easy-setup/curated-categories')
    return response.data
  })()
}

export function getCreatorPacks(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{
      configured: boolean
      packs: CreatorPackWithStatus[]
      downloads: DownloadJobWithProgress[]
    }>('/creator-packs')
    return response.data
  })()
}

export function installCreatorPack(client: AxiosInstance, id: string) {
  return catchInternal(async () => {
    const response = await client.post<{ message: string; filename?: string }>(
      `/creator-packs/${id}/install`
    )
    return response.data
  })()
}

export function uninstallCreatorPack(client: AxiosInstance, id: string) {
  return catchInternal(async () => {
    const response = await client.delete<{ message: string; filename?: string }>(
      `/creator-packs/${id}`
    )
    return response.data
  })()
}
