import type Docker from 'dockerode'

export interface GpuDetectionResult {
  type: 'nvidia' | 'amd' | 'none'
  toolkitMissing?: boolean
}

export interface DockerDevice {
  PathOnHost: string
  PathInContainer: string
  CgroupPermissions: string
}

export interface ServiceStatus {
  service_name: string
  status: string
}

export interface OperationResult {
  success: boolean
  message: string
}

export interface PortConflict {
  port: number
  usedBy: string
}

export interface ContainerStats {
  cpuPercent: number
  memUsageBytes: number
  memLimitBytes: number
  memPercent: number
}

export interface DockerCtx {
  docker: Docker
  self: any
  activeInstallations: Set<string>
  broadcast(service: string, status: string, message: string): void
  invalidateCache(): void
  parseConfig(config: any): any
  pullImage(imageName: string): Promise<void>
  checkImageExists(imageName: string): Promise<boolean>
  applyHostStorageRoot(config: any): Promise<void>
  resolveHostStorageRoot(): Promise<string>
  cleanupFailedInstallation(serviceName: string): Promise<void>
  detectGPUType(): Promise<GpuDetectionResult>
  resolveAmdHsaOverride(): Promise<string | null>
  discoverAMDDevices(): Promise<DockerDevice[]>
  resolveHomeboxPepper(): Promise<string>
  resolveN8nEncryptionKey(): Promise<string>
  findContainerByName(serviceName: string): Promise<Docker.ContainerInfo | null>
  removeServiceContainer(serviceName: string): Promise<OperationResult>
  humanizeDockerError(error: any, serviceName: string): string
}
