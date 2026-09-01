import { AxiosError, AxiosInstance } from 'axios'
import { ServiceSlim } from '../../../types/services'
import {
  AppAutoUpdateStatus,
  AutoUpdateStatus,
  CheckLatestVersionResult,
  ContentAutoUpdateStatus,
  SystemInformationResponse,
  SystemUpdateStatus,
} from '../../../types/system'
import { catchInternal } from '../util'

export function affectService(
  client: AxiosInstance,
  service_name: string,
  action: 'start' | 'stop' | 'restart'
) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean; message: string }>(
      '/system/services/affect',
      { service_name, action }
    )
    return response.data
  })()
}

export function checkLatestVersion(client: AxiosInstance, force: boolean = false) {
  return catchInternal(async () => {
    const response = await client.get<CheckLatestVersionResult>('/system/latest-version', {
      params: { force },
    })
    return response.data
  })()
}

export function checkServiceUpdates(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean; message: string }>(
      '/system/services/check-updates'
    )
    return response.data
  })()
}

export function getAvailableVersions(client: AxiosInstance, serviceName: string) {
  return catchInternal(async () => {
    const response = await client.get<{
      versions: Array<{ tag: string; isLatest: boolean; releaseUrl?: string }>
    }>(`/system/services/${serviceName}/available-versions`)
    return response.data
  })()
}

export function updateService(client: AxiosInstance, serviceName: string, targetVersion: string) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean; message: string }>(
      '/system/services/update',
      { service_name: serviceName, target_version: targetVersion }
    )
    return response.data
  })()
}

export function forceReinstallService(client: AxiosInstance, service_name: string) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean; message: string }>(
      `/system/services/force-reinstall`,
      { service_name }
    )
    return response.data
  })()
}

export function getDebugInfo(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ debugInfo: string }>('/system/debug-info')
    return response.data.debugInfo
  })()
}

export function getInternetStatus(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<boolean>('/system/internet-status')
    return response.data
  })()
}

export function getSystemInfo(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<SystemInformationResponse>('/system/info')
    return response.data
  })()
}

export function getSystemServices(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<Array<ServiceSlim>>('/system/services')
    return response.data
  })()
}

export function getSystemUpdateStatus(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<SystemUpdateStatus>('/system/update/status')
    return response.data
  })()
}

export function getSystemUpdateLogs(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ logs: string }>('/system/update/logs')
    return response.data
  })()
}

export function getAutoUpdateStatus(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<AutoUpdateStatus>('/system/auto-update/status')
    return response.data
  })()
}

export function getAppAutoUpdateStatus(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<AppAutoUpdateStatus>('/system/apps/auto-update/status')
    return response.data
  })()
}

export function getContentAutoUpdateStatus(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<ContentAutoUpdateStatus>('/system/content/auto-update/status')
    return response.data
  })()
}

export function setServiceAutoUpdate(client: AxiosInstance, serviceName: string, enabled: boolean) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean; message: string }>(
      '/system/services/auto-update',
      { service_name: serviceName, enabled }
    )
    return response.data
  })()
}

export function healthCheck(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ status: string }>('/health', {
      timeout: 5000,
    })
    return response.data
  })()
}

export function installService(client: AxiosInstance, service_name: string) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean; message: string }>(
      '/system/services/install',
      { service_name }
    )
    return response.data
  })()
}

export function startSystemUpdate(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean; message: string }>('/system/update')
    return response.data
  })()
}

export function subscribeToReleaseNotes(client: AxiosInstance, email: string) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean; message: string }>(
      '/system/subscribe-release-notes',
      { email }
    )
    return response.data
  })()
}

export function getSetting(client: AxiosInstance, key: string) {
  return catchInternal(async () => {
    const response = await client.get<{ key: string; value: any }>('/system/settings', {
      params: { key },
    })
    return response.data
  })()
}

export function updateSetting(client: AxiosInstance, key: string, value: any) {
  return catchInternal(async () => {
    const response = await client.patch<{ success: boolean; message: string }>('/system/settings', {
      key,
      value,
    })
    return response.data
  })()
}

export function preflightCheck(client: AxiosInstance, service_name: string) {
  return catchInternal(async () => {
    const response = await client.get<{
      portConflicts: Array<{ port: number; usedBy: string }>
      resourceWarnings: string[]
    }>('/system/services/preflight', { params: { service_name } })
    return response.data
  })()
}

export function suggestCustomPort(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<{ port: number }>('/system/services/suggest-port')
    return response.data
  })()
}

export function preflightCustomApp(
  client: AxiosInstance,
  payload: {
    image?: string
    ports?: number[]
    volumes?: Array<{ host_path: string; container_path: string }>
    exclude_service?: string
  }
) {
  return catchInternal(async () => {
    const response = await client.post<{
      portConflicts: Array<{ port: number; usedBy: string }>
      resourceWarnings: string[]
      blocked: string[]
    }>('/system/services/preflight-custom', payload)
    return response.data
  })()
}

export function createCustomApp(
  client: AxiosInstance,
  payload: {
    friendly_name: string
    image: string
    ports?: Array<{ container: number; host: number }>
    volumes?: Array<{ host_path: string; container_path: string }>
    env?: string[]
    category?: string
    icon?: string
    memory_mb?: number
    cpus?: number
    force?: boolean
  }
) {
  return catchInternal(async () => {
    const response = await client.post<{
      success: boolean
      message: string
      service_name: string
    }>('/system/services/custom', payload)
    return response.data
  })()
}

export function setServiceCustomUrl(
  client: AxiosInstance,
  service_name: string,
  custom_url: string | null
) {
  return catchInternal(async () => {
    const response = await client.put<{ success: boolean; custom_url: string | null }>(
      '/system/services/custom-url',
      { service_name, custom_url }
    )
    return response.data
  })()
}

export function deleteCustomApp(client: AxiosInstance, service_name: string, remove_image = false) {
  return catchInternal(async () => {
    const response = await client.delete<{ success: boolean; message: string }>(
      '/system/services/custom',
      { data: { service_name, remove_image } }
    )
    return response.data
  })()
}

export function uninstallService(
  client: AxiosInstance,
  service_name: string,
  remove_image = false
) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean; message: string }>(
      '/system/services/uninstall',
      { service_name, remove_image }
    )
    return response.data
  })()
}

export function updateCustomAppImage(client: AxiosInstance, service_name: string) {
  return catchInternal(async () => {
    const response = await client.post<{ success: boolean; message: string }>(
      '/system/services/custom/update',
      { service_name }
    )
    return response.data
  })()
}

export function getServiceLogs(client: AxiosInstance, service_name: string, tail = 200) {
  return catchInternal(async () => {
    const response = await client.get<{ success: boolean; logs: string }>(
      `/system/services/${service_name}/logs`,
      { params: { tail } }
    )
    return response.data
  })()
}

export function getServiceStats(client: AxiosInstance, service_name: string) {
  return catchInternal(async () => {
    const response = await client.get<{
      success: boolean
      running: boolean
      stats: {
        cpuPercent: number
        memUsageBytes: number
        memLimitBytes: number
        memPercent: number
      } | null
    }>(`/system/services/${service_name}/stats`)
    return response.data
  })()
}

export function getCustomApp(client: AxiosInstance, service_name: string) {
  return catchInternal(async () => {
    const response = await client.get<{
      success: boolean
      app: {
        service_name: string
        friendly_name: string | null
        image: string
        category: string
        icon: string
        ports: Array<{ container: number; host: number }>
        volumes: Array<{ host_path: string; container_path: string }>
        env: string[]
        memory_mb?: number
        cpus?: number
      }
    }>(`/system/services/custom/${service_name}`)
    return response.data
  })()
}

export function updateCustomApp(
  client: AxiosInstance,
  payload: {
    service_name: string
    friendly_name: string
    image: string
    ports?: Array<{ container: number; host: number }>
    volumes?: Array<{ host_path: string; container_path: string }>
    env?: string[]
    category?: string
    icon?: string
    memory_mb?: number
    cpus?: number
    force?: boolean
  }
) {
  return catchInternal(async () => {
    const response = await client.put<{
      success: boolean
      message: string
      service_name: string
    }>('/system/services/custom', payload)
    return response.data
  })()
}
