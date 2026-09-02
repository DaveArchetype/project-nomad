import Service from '#models/service'
import Docker from 'dockerode'
import logger from '@adonisjs/core/services/logger'
import { inject } from '@adonisjs/core'
import transmit from '@adonisjs/transmit/services/main'
import { BROADCAST_CHANNELS } from '../../../constants/broadcast.js'
import { GITEA_REGISTRY_HOST, getGiteaCredentials } from '../container_registry_service.js'
import type { DockerCtx, OperationResult, ServiceStatus } from './types.js'
import { humanizeDockerError, parseContainerConfig } from './utils.js'
import { resolveHomeboxPepper, resolveN8nEncryptionKey } from './secrets.js'
import { checkPortConflicts } from './port_conflicts.js'
import { getServiceURL } from './service_url.js'
import { detectGPUType, resolveAmdHsaOverride, discoverAMDDevices } from './gpu.js'
import {
  resolveHostStorageRoot,
  applyHostStorageRoot,
  ADMIN_CONTAINER_NAME,
  ADMIN_STORAGE_DEST,
  DEFAULT_HOST_STORAGE_ROOT,
} from './host_storage.js'
import { getContainerLogs, getContainerStats } from './logs_stats.js'
import { affectContainer, fetchServicesStatus } from './lifecycle.js'
import { isKiwixOnLegacyConfig, migrateKiwixToLibraryMode } from './kiwix_migration.js'
import { createContainerPreflight, forceReinstall } from './installer.js'
import { updateContainer } from './updater.js'
import {
  removeCustomAppContainer,
  uninstallService,
  recreateCustomAppContainer,
} from './custom_apps.js'

@inject()
export class DockerService {
  public docker: Docker
  private activeInstallations: Set<string> = new Set()
  public static NOMAD_NETWORK = 'project-nomad_default'
  public static ADMIN_CONTAINER_NAME = ADMIN_CONTAINER_NAME
  public static ADMIN_STORAGE_DEST = ADMIN_STORAGE_DEST
  public static DEFAULT_HOST_STORAGE_ROOT = DEFAULT_HOST_STORAGE_ROOT

  private _hostStorageRoot: string | null = null

  private _servicesStatusCache: {
    data: ServiceStatus[]
    expiresAt: number
  } | null = null
  private _servicesStatusInflight: Promise<ServiceStatus[]> | null = null

  constructor() {
    const isWindows = process.platform === 'win32'
    if (isWindows) {
      this.docker = new Docker({ socketPath: '//./pipe/docker_engine' })
    } else {
      this.docker = new Docker({ socketPath: '/var/run/docker.sock' })
    }
  }

  private get ctx(): DockerCtx {
    return {
      docker: this.docker,
      self: this,
      activeInstallations: this.activeInstallations,
      broadcast: (service, status, message) => this._broadcast(service, status, message),
      invalidateCache: () => this.invalidateServicesStatusCache(),
      parseConfig: (config) => this._parseContainerConfig(config),
      pullImage: (imageName) => this.pullImage(imageName),
      checkImageExists: (imageName) => this._checkImageExists(imageName),
      applyHostStorageRoot: (config) => this._applyHostStorageRoot(config),
      resolveHostStorageRoot: () => this._resolveHostStorageRoot(),
      cleanupFailedInstallation: (serviceName) => this._cleanupFailedInstallation(serviceName),
      detectGPUType: () => this._detectGPUType(),
      resolveAmdHsaOverride: () => this._resolveAmdHsaOverride(),
      discoverAMDDevices: () => this._discoverAMDDevices(),
      resolveHomeboxPepper: () => this._resolveHomeboxPepper(),
      resolveN8nEncryptionKey: () => this._resolveN8nEncryptionKey(),
      findContainerByName: (serviceName) => this._findContainerByName(serviceName),
      removeServiceContainer: (serviceName) => this._removeServiceContainer(serviceName),
      humanizeDockerError: (error, serviceName) => this._humanizeDockerError(error, serviceName),
    }
  }

  async pullImage(imageName: string): Promise<void> {
    const auth = await this._getRegistryAuth(imageName)
    const lastColon = imageName.lastIndexOf(':')
    const fromImage = lastColon > -1 ? imageName.substring(0, lastColon) : imageName
    const tag = lastColon > -1 ? imageName.substring(lastColon + 1) : 'latest'
    const pullStream = auth
      ? await this.docker.createImage(auth, { fromImage, tag })
      : await this.docker.pull(imageName)
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(pullStream, (error: Error | null) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private async _getRegistryAuth(
    imageName: string
  ): Promise<{ username: string; password: string; serveraddress: string } | undefined> {
    if (!imageName.startsWith(`${GITEA_REGISTRY_HOST}/`)) return undefined
    const credentials = await getGiteaCredentials()
    if (!credentials) return undefined
    return { ...credentials, serveraddress: GITEA_REGISTRY_HOST }
  }

  async affectContainer(
    serviceName: string,
    action: 'start' | 'stop' | 'restart'
  ): Promise<OperationResult> {
    return affectContainer(this.ctx, serviceName, action)
  }

  async getServicesStatus(): Promise<ServiceStatus[]> {
    const now = Date.now()
    if (this._servicesStatusCache && now < this._servicesStatusCache.expiresAt) {
      return this._servicesStatusCache.data
    }
    if (this._servicesStatusInflight) return this._servicesStatusInflight

    this._servicesStatusInflight = fetchServicesStatus(this.ctx)
      .then((data) => {
        this._servicesStatusCache = { data, expiresAt: Date.now() + 5000 }
        this._servicesStatusInflight = null
        return data
      })
      .catch((err) => {
        this._servicesStatusInflight = null
        throw err
      })
    return this._servicesStatusInflight
  }

  invalidateServicesStatusCache() {
    this._servicesStatusCache = null
    this._servicesStatusInflight = null
  }

  async getServiceURL(serviceName: string): Promise<string | null> {
    return getServiceURL(serviceName)
  }

  async createContainerPreflight(serviceName: string): Promise<OperationResult> {
    return createContainerPreflight(this.ctx, serviceName)
  }

  async forceReinstall(serviceName: string): Promise<OperationResult> {
    return forceReinstall(this.ctx, serviceName)
  }

  async updateContainer(serviceName: string, targetVersion: string): Promise<OperationResult> {
    return updateContainer(this.ctx, serviceName, targetVersion)
  }

  async checkPortConflicts(
    ports: number[]
  ): Promise<{ conflicts: { port: number; usedBy: string }[] }> {
    return checkPortConflicts(this.ctx, ports)
  }

  async removeCustomAppContainer(
    serviceName: string,
    removeImage = false
  ): Promise<OperationResult> {
    return removeCustomAppContainer(this.ctx, serviceName, removeImage)
  }

  async uninstallService(serviceName: string, removeImage = false): Promise<OperationResult> {
    return uninstallService(this.ctx, serviceName, removeImage)
  }

  async recreateCustomAppContainer(
    serviceName: string,
    opts: { forcePull?: boolean } = {}
  ): Promise<OperationResult> {
    return recreateCustomAppContainer(this.ctx, serviceName, opts)
  }

  async getContainerLogs(
    serviceName: string,
    tail = 200
  ): Promise<{ success: boolean; logs?: string; message?: string }> {
    return getContainerLogs(this.ctx, serviceName, tail)
  }

  async getContainerStats(serviceName: string): Promise<{
    success: boolean
    running?: boolean
    stats?: { cpuPercent: number; memUsageBytes: number; memLimitBytes: number; memPercent: number }
    message?: string
  }> {
    return getContainerStats(this.ctx, serviceName)
  }

  async getHostStorageRoot(): Promise<string> {
    return this._resolveHostStorageRoot()
  }

  async isKiwixOnLegacyConfig(): Promise<boolean> {
    return isKiwixOnLegacyConfig(this.ctx)
  }

  async migrateKiwixToLibraryMode(): Promise<void> {
    return migrateKiwixToLibraryMode(this.ctx)
  }

  private _broadcast(service: string, status: string, message: string) {
    transmit.broadcast(BROADCAST_CHANNELS.SERVICE_INSTALLATION, {
      service_name: service,
      timestamp: new Date().toISOString(),
      status,
      message,
    })
    logger.info(`[DockerService] [${service}] ${status}: ${message}`)
  }

  private _parseContainerConfig(containerConfig: any): any {
    return parseContainerConfig(containerConfig)
  }

  private _humanizeDockerError(error: any, serviceName: string): string {
    return humanizeDockerError(error, serviceName)
  }

  private async _checkImageExists(imageName: string): Promise<boolean> {
    try {
      const images = await this.docker.listImages()
      return images.some((image) => image.RepoTags && image.RepoTags.includes(imageName))
    } catch (error: any) {
      logger.warn(`Error checking if image exists: ${error.message}`)
      return false
    }
  }

  private async _resolveHostStorageRoot(): Promise<string> {
    if (this._hostStorageRoot) return this._hostStorageRoot
    const root = await resolveHostStorageRoot(this.docker)
    this._hostStorageRoot = root
    return root
  }

  private async _applyHostStorageRoot(containerConfig: any): Promise<void> {
    await applyHostStorageRoot(this.docker, containerConfig)
  }

  private async _detectGPUType() {
    return detectGPUType(this.docker)
  }

  private async _resolveAmdHsaOverride(): Promise<string | null> {
    return resolveAmdHsaOverride()
  }

  private async _discoverAMDDevices() {
    return discoverAMDDevices()
  }

  private async _resolveHomeboxPepper(): Promise<string> {
    return resolveHomeboxPepper()
  }

  private async _resolveN8nEncryptionKey(): Promise<string> {
    return resolveN8nEncryptionKey()
  }

  private async _findContainerByName(serviceName: string) {
    const containers = await this.docker.listContainers({ all: true })
    return containers.find((c) => c.Names.includes(`/${serviceName}`)) ?? null
  }

  private async _removeServiceContainer(serviceName: string): Promise<OperationResult> {
    try {
      const containers = await this.docker.listContainers({ all: true })
      const container = containers.find((c) => c.Names.includes(`/${serviceName}`))
      if (!container) {
        return { success: false, message: `Container for service ${serviceName} not found` }
      }

      const dockerContainer = this.docker.getContainer(container.Id)
      await dockerContainer.remove({ force: true })

      return { success: true, message: `Service ${serviceName} container removed successfully` }
    } catch (error: any) {
      logger.error(
        { err: error },
        `[DockerService] Error removing service container ${serviceName}`
      )
      return {
        success: false,
        message: `Failed to remove service ${serviceName} container. Check server logs for details.`,
      }
    }
  }

  private async _cleanupFailedInstallation(serviceName: string): Promise<void> {
    try {
      const service = await Service.query().where('service_name', serviceName).first()
      if (service) {
        if (service.is_custom) {
          await service.delete()
        } else {
          service.installation_status = 'error'
          await service.save()
        }
      }
      this.activeInstallations.delete(serviceName)

      await this._removeServiceContainer(serviceName)

      logger.info(`[DockerService] Cleaned up failed installation for ${serviceName}`)
    } catch (error: any) {
      logger.error(
        `[DockerService] Failed to cleanup installation for ${serviceName}: ${error.message}`
      )
    }
  }
}
