import Service from '#models/service'
import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'
import { SERVICE_NAMES } from '../../../constants/service_names.js'
import type { DockerCtx, OperationResult } from './types.js'

export async function updateContainer(
  ctx: DockerCtx,
  serviceName: string,
  targetVersion: string
): Promise<OperationResult> {
  try {
    const service = await Service.query().where('service_name', serviceName).first()
    if (!service) {
      return { success: false, message: `Service ${serviceName} not found` }
    }
    if (!service.installed) {
      return { success: false, message: `Service ${serviceName} is not installed` }
    }
    if (ctx.activeInstallations.has(serviceName)) {
      return {
        success: false,
        message: `Service ${serviceName} already has an operation in progress`,
      }
    }
    if (service.installation_status === 'installing') {
      return {
        success: false,
        message: `Service ${serviceName} already has an update in progress`,
      }
    }

    ctx.activeInstallations.add(serviceName)
    service.installation_status = 'installing'
    await service.save()

    const currentImage = service.container_image
    const imageBase = currentImage.includes(':')
      ? currentImage.substring(0, currentImage.lastIndexOf(':'))
      : currentImage
    const newImage = `${imageBase}:${targetVersion}`
    let runtimeImage = newImage

    let updatedDeviceRequests: any[] | undefined = undefined
    let updatedAmdDevices: any[] | undefined = undefined
    let updatedAmdGpuConfigured = false
    if (serviceName === SERVICE_NAMES.OLLAMA) {
      const gpuResult = await ctx.detectGPUType()
      if (gpuResult.type === 'nvidia') {
        ctx.broadcast(
          serviceName,
          'update-gpu-config',
          `NVIDIA container runtime detected. Configuring updated container with GPU support...`
        )
        updatedDeviceRequests = [{ Driver: 'nvidia', Count: -1, Capabilities: [['gpu']] }]
      } else if (gpuResult.type === 'amd') {
        const amdEnabledRaw = await KVStore.getValue('ai.amdGpuAcceleration')
        const amdAccelerationEnabled = String(amdEnabledRaw) !== 'false'
        if (amdAccelerationEnabled) {
          ctx.broadcast(
            serviceName,
            'update-gpu-config',
            `AMD GPU detected. Using ROCm image with /dev/kfd and /dev/dri passthrough...`
          )
          runtimeImage = 'ollama/ollama:rocm'
          updatedAmdDevices = await ctx.discoverAMDDevices()
          updatedAmdGpuConfigured = true
        } else {
          ctx.broadcast(
            serviceName,
            'update-gpu-config',
            `AMD GPU detected but acceleration is disabled via ai.amdGpuAcceleration. Using CPU-only configuration.`
          )
        }
      } else if (gpuResult.toolkitMissing) {
        ctx.broadcast(
          serviceName,
          'update-gpu-config',
          `NVIDIA GPU detected but NVIDIA Container Toolkit is not installed. Using CPU-only configuration. Install the toolkit and reinstall AI Assistant for GPU acceleration: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html`
        )
      } else {
        ctx.broadcast(
          serviceName,
          'update-gpu-config',
          `No GPU detected. Using CPU-only configuration.`
        )
      }
    }

    ctx.broadcast(serviceName, 'update-pulling', `Pulling image ${runtimeImage}...`)
    await ctx.pullImage(runtimeImage)

    ctx.broadcast(serviceName, 'update-stopping', `Stopping current container...`)
    const containers = await ctx.docker.listContainers({ all: true })
    const existingContainer = containers.find((c) => c.Names.includes(`/${serviceName}`))

    if (!existingContainer) {
      ctx.activeInstallations.delete(serviceName)
      return { success: false, message: `Container for ${serviceName} not found` }
    }

    const oldContainer = ctx.docker.getContainer(existingContainer.Id)
    const inspectData = await oldContainer.inspect()

    if (existingContainer.State === 'running') {
      await oldContainer.stop({ t: 15 })
    }

    const oldName = `${serviceName}_old`

    const staleOld = (await ctx.docker.listContainers({ all: true })).find((c) =>
      c.Names.includes(`/${oldName}`)
    )
    if (staleOld) {
      try {
        await ctx.docker.getContainer(staleOld.Id).remove({ force: true })
      } catch {
        // Best effort
      }
    }

    await oldContainer.rename({ name: oldName })

    const rollbackToOld = async () => {
      const containers = await ctx.docker.listContainers({ all: true })
      const oldRef = containers.find((c) => c.Names.includes(`/${oldName}`))
      if (oldRef) {
        const rollbackContainer = ctx.docker.getContainer(oldRef.Id)
        await rollbackContainer.rename({ name: serviceName }).catch(() => {})
        await rollbackContainer.start().catch(() => {})
      }
    }

    ctx.broadcast(serviceName, 'update-creating', `Creating updated container...`)

    const hostConfig = inspectData.HostConfig || {}

    const baseEnv = inspectData.Config?.Env || []
    let finalEnv = baseEnv
    if (updatedAmdGpuConfigured) {
      const hsaOverride = await ctx.resolveAmdHsaOverride()
      finalEnv = baseEnv.filter(
        (e: string) =>
          !e.startsWith('HSA_OVERRIDE_GFX_VERSION=') && !e.startsWith('OLLAMA_IGPU_ENABLE=')
      )
      if (hsaOverride) {
        finalEnv.push(`HSA_OVERRIDE_GFX_VERSION=${hsaOverride}`)
      }
      finalEnv.push('OLLAMA_IGPU_ENABLE=1')
    }

    if (
      serviceName === SERVICE_NAMES.HOMEBOX &&
      !finalEnv.some((e: string) => e.startsWith('HBOX_AUTH_API_KEY_PEPPER='))
    ) {
      finalEnv = [...finalEnv, `HBOX_AUTH_API_KEY_PEPPER=${await ctx.resolveHomeboxPepper()}`]
    }

    const newContainerConfig: any = {
      Image: runtimeImage,
      name: serviceName,
      Env: finalEnv.length > 0 ? finalEnv : undefined,
      Cmd: inspectData.Config?.Cmd || undefined,
      ExposedPorts: inspectData.Config?.ExposedPorts || undefined,
      WorkingDir: inspectData.Config?.WorkingDir || undefined,
      User: inspectData.Config?.User || undefined,
      HostConfig: {
        Binds: hostConfig.Binds || undefined,
        PortBindings: hostConfig.PortBindings || undefined,
        RestartPolicy: hostConfig.RestartPolicy || undefined,
        DeviceRequests:
          serviceName === SERVICE_NAMES.OLLAMA
            ? updatedDeviceRequests
            : hostConfig.DeviceRequests || undefined,
        Devices:
          serviceName === SERVICE_NAMES.OLLAMA && updatedAmdDevices
            ? updatedAmdDevices
            : hostConfig.Devices || undefined,
      },
      NetworkingConfig: inspectData.NetworkSettings?.Networks
        ? {
            EndpointsConfig: Object.fromEntries(
              Object.keys(inspectData.NetworkSettings.Networks).map((net) => [net, {}])
            ),
          }
        : undefined,
    }

    Object.keys(newContainerConfig.HostConfig).forEach((key) => {
      if (newContainerConfig.HostConfig[key] === undefined) {
        delete newContainerConfig.HostConfig[key]
      }
    })

    let newContainer: any
    try {
      newContainer = await ctx.docker.createContainer(newContainerConfig)
    } catch (createError: any) {
      ctx.broadcast(
        serviceName,
        'update-rollback',
        `Failed to create new container: ${createError.message}. Rolling back...`
      )
      await rollbackToOld()
      ctx.activeInstallations.delete(serviceName)
      return {
        success: false,
        message: `Failed to create updated container: ${createError.message}`,
      }
    }

    ctx.broadcast(serviceName, 'update-starting', `Starting updated container...`)
    try {
      await newContainer.start()
    } catch (startError: any) {
      ctx.broadcast(
        serviceName,
        'update-rollback',
        `Updated container failed to start: ${startError.message}. Rolling back to previous version...`
      )
      try {
        await newContainer.remove({ force: true })
      } catch {
        // Best effort
      }
      await rollbackToOld()
      ctx.activeInstallations.delete(serviceName)
      return {
        success: false,
        message: `Update failed: new container did not start (${startError.message}). Rolled back to previous version.`,
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 5000))
    const newContainerInfo = await newContainer.inspect()

    if (newContainerInfo.State?.Running) {
      try {
        const oldContainerRef = ctx.docker.getContainer(
          (await ctx.docker.listContainers({ all: true })).find((c) =>
            c.Names.includes(`/${oldName}`)
          )?.Id || ''
        )
        await oldContainerRef.remove({ force: true })
      } catch {
        // Old container may already be gone
      }

      service.container_image = newImage
      service.available_update_version = null
      await service.save()

      ctx.activeInstallations.delete(serviceName)
      ctx.broadcast(
        serviceName,
        'update-complete',
        `Successfully updated ${serviceName} to ${targetVersion}`
      )
      return { success: true, message: `Service ${serviceName} updated to ${targetVersion}` }
    } else {
      ctx.broadcast(
        serviceName,
        'update-rollback',
        `New container failed health check. Rolling back to previous version...`
      )

      try {
        await newContainer.stop({ t: 5 }).catch(() => {})
        await newContainer.remove({ force: true })
      } catch {
        // Best effort cleanup
      }

      await rollbackToOld()

      ctx.activeInstallations.delete(serviceName)
      return {
        success: false,
        message: `Update failed: new container did not stay running. Rolled back to previous version.`,
      }
    }
  } catch (error: any) {
    ctx.activeInstallations.delete(serviceName)
    ctx.broadcast(
      serviceName,
      'update-rollback',
      'Update failed. Check server logs for details.'
    )
    logger.error({ err: error }, `[DockerService] Update failed for ${serviceName}`)
    return { success: false, message: 'Update failed. Check server logs for details.' }
  } finally {
    const svc = await Service.query().where('service_name', serviceName).first()
    if (svc && svc.installation_status === 'installing') {
      svc.installation_status = 'idle'
      try {
        await svc.save()
      } catch (saveErr: any) {
        logger.error(
          { err: saveErr },
          `[DockerService] Failed to reset installation_status for ${serviceName}`
        )
      }
    }
  }
}

export async function awaitContainerReady(
  container: any,
  timeoutMs = 30000
): Promise<{ ready: boolean; reason?: string }> {
  let inspect = await container.inspect()
  const hasHealthcheck = !!inspect.State?.Health

  if (!hasHealthcheck) {
    await new Promise((r) => setTimeout(r, 5000))
    inspect = await container.inspect()
    return inspect.State?.Running
      ? { ready: true }
      : { ready: false, reason: 'container did not stay running' }
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    inspect = await container.inspect()
    if (!inspect.State?.Running) return { ready: false, reason: 'container exited' }
    const status = inspect.State?.Health?.Status
    if (status === 'healthy') return { ready: true }
    if (status === 'unhealthy') return { ready: false, reason: 'failed its health check' }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return inspect.State?.Running
    ? { ready: true }
    : { ready: false, reason: 'health check timed out' }
}
