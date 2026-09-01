import { AxiosInstance } from 'axios'
import { FileEntry } from '../../../types/files'
import type { Country, CountryCode, CountryGroup, MapExtractPreflight } from '../../../types/maps'
import { CollectionWithStatus } from '../../../types/collections'
import { catchInternal } from '../util'

export function downloadBaseMapAssets(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean }>('/maps/download-base-assets')
    return response.data
  })()
}

export function setupWorldBasemap(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean }>('/maps/setup-world-basemap')
    return response.data
  })()
}

export function downloadMapCollection(client: AxiosInstance, slug: string) {
  return catchInternal(async () => {
    const response = await client.post<{
      message: string
      slug: string
      resources: string[] | null
    }>('/maps/download-collection', { slug })
    return response.data
  })()
}

export function downloadRemoteMapRegion(client: AxiosInstance, url: string) {
  return catchInternal(async () => {
    const response = await client.post<{ message: string; filename: string; url: string }>(
      '/maps/download-remote',
      { url }
    )
    return response.data
  })()
}

export function downloadRemoteMapRegionPreflight(client: AxiosInstance, url: string) {
  return catchInternal(async () => {
    const response = await client.post<
      { filename: string; size: number } | { message: string }
    >('/maps/download-remote-preflight', { url })
    return response.data
  })()
}

export function deleteMapRegionFile(client: AxiosInstance, filename: string) {
  return catchInternal(async () => {
    const response = await client.delete<{ message: string }>(
      `/maps/${encodeURIComponent(filename)}`
    )
    return response.data
  })()
}

export function fetchLatestMapCollections(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean }>('/maps/fetch-latest-collections')
    return response.data
  })()
}

export function getGlobalMapInfo(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{
      url: string
      date: string
      size: number
      key: string
    }>('/maps/global-map-info')
    return response.data
  })()
}

export function downloadGlobalMap(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<{
      message: string
      filename: string
      jobId?: string
    }>('/maps/download-global-map')
    return response.data
  })()
}

export function listCountries(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ countries: Country[] }>('/maps/countries')
    return response.data.countries
  })()
}

export function listCountryGroups(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ groups: CountryGroup[] }>('/maps/country-groups')
    return response.data.groups
  })()
}

export function extractMapPreflight(
  client: AxiosInstance,
  params: { countries: CountryCode[]; maxzoom?: number }
) {
  return catchInternal(async () => {
    const response = await client.post<MapExtractPreflight>('/maps/extract-preflight', params)
    return response.data
  })()
}

export function extractMapRegion(
  client: AxiosInstance,
  params: {
    countries: CountryCode[]
    maxzoom?: number
    label?: string
    estimatedBytes?: number
  }
) {
  return catchInternal(async () => {
    const response = await client.post<{
      message: string
      filename: string
      jobId?: string
    }>('/maps/extract', params)
    return response.data
  })()
}

export function listCuratedMapCollections(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<CollectionWithStatus[]>('/maps/curated-collections')
    return response.data
  })()
}

export function listMapRegionFiles(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ files: FileEntry[] }>('/maps/regions')
    return response.data.files
  })()
}

export function listMapMarkers(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<
      Array<{
        id: number
        name: string
        longitude: number
        latitude: number
        color: string
        notes: string | null
        created_at: string
      }>
    >('/maps/markers')
    return response.data
  })()
}

export function createMapMarker(
  client: AxiosInstance,
  data: {
    name: string
    longitude: number
    latitude: number
    color?: string
    notes?: string | null
  }
) {
  return catchInternal(async () => {
    const response = await client.post<{
      id: number
      name: string
      longitude: number
      latitude: number
      color: string
      notes: string | null
      created_at: string
    }>('/maps/markers', data)
    return response.data
  })()
}

export function updateMapMarker(
  client: AxiosInstance,
  id: number,
  data: { name?: string; color?: string }
) {
  return catchInternal(async () => {
    const response = await client.patch<{
      id: number
      name: string
      longitude: number
      latitude: number
      color: string
    }>(`/maps/markers/${id}`, data)
    return response.data
  })()
}

export function deleteMapMarker(client: AxiosInstance, id: number) {
  return catchInternal(async () => {
    await client.delete(`/maps/markers/${id}`)
  })()
}
