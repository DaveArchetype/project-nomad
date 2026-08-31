import Service from '#models/service'
import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'
import { SERVICE_NAMES } from '../../../constants/service_names.js'
import type { DockerCtx, OperationResult } from './types.js'
import {
  runPreinstallActions__KiwixServe,
  runPreinstallActions__CalibreWeb,
  runPreinstallActions__Vaultwarden,
  runPreinstallActions__Jellyfin,
  runPreinstallActions__MeshCoreWeb,
  runPreinstallActions__CodeServer,
} from './preinstall_actions.js'

const PREINSTALL_MAP: Record<string, (ctx: DockerCtx) => Promise<void>> = {
  [SERVICE_NAMES.KIWIX]: runPreinstallActions__KiwixServe,
  [SERVICE_NAMES.CALIBREWEB]: runPreinstallActions__CalibreWeb,
  [SERVICE_NAMES.VAULTWARDEN]: runPreinstallActions__Vaultwarden,
  [SERVICE_NAMES.JELLYFIN]: runPreinstallActions__Jellyfin,
  [SERVICE_NAMES.MESHCORE_WEB]: runPreinstallActions__MeshCoreWeb,
  [SERVICE_NAMES.CODE_SERVER]: runPreinstallActions__CodeServer,
}

export async function createContainerPreflight(
  ctx: DockerCtx,
  serviceName: string
): Promise<OperationResult> {
  const service = await Service.query().where('service_name', serviceName).first()
  if (!service) {
    return {
      success: false,
      message: `Service ${serviceName} not found`,
    }
  }

  if (service.installed) {
    return {
      success: false,
      message: `Service ${serviceName} is already installed`,
    }
  }

  if (service.installation_status === 'installing') {
    return {
      success: false,
      message: `Service ${serviceName} installation is already in progress`,
    }
  }

  if (ctx.activeInstallations.has(serviceName)) {
    return {
      success: false,
      message: `Service ${serviceName} installation is already in progress`,
    }
  }

  ctx.activeInstallations.add(serviceName)
  service.installation_status = 'installing'
  await service.save()

  const containerConfig = ctx.parseConfig(service.container_config)

  createContainer(ctx, service, containerConfig).catch(async (error) => {
    logger.error(`Installation failed for ${serviceName}: ${error.message}`)
    await ctx.cleanupFailedInstallation(serviceName)
  })

  return {
    success: true,
    message: `Service ${serviceName} installation initiated successfully. You can receive updates via server-sent events.`,
  }
}

export async function forceReinstall(
  ctx: DockerCtx,
  serviceName: string
): Promise<OperationResult> {
  try {
    const service = await Service.query().where('service_name', serviceName).first()
    if (!service) {
      return {
        success: false,
        message: `Service ${serviceName} not found`,
      }
    }

    if (ctx.activeInstallations.has(serviceName)) {
      return {
        success: false,
        message: `Service ${serviceName} installation is already in progress`,
      }
    }

    ctx.activeInstallations.add(serviceName)
    service.installation_status = 'installing'
    await service.save()

    ctx.broadcast(
      serviceName,
      'reinstall-starting',
      `Starting force reinstall for ${serviceName}...`
    )

    try {
      const containers = await ctx.docker.listContainers({ all: true })
      const container = containers.find((c) => c.Names.includes(`/${serviceName}`))

      if (container) {
        const dockerContainer = ctx.docker.getContainer(container.Id)

        if (container.State === 'running') {
          ctx.broadcast(serviceName, 'stopping', `Stopping container...`)
          await dockerContainer.stop({ t: 10 }).catch((error) => {
            if (!error.message.includes('already stopped')) {
              logger.warn(`Error stopping container: ${error.message}`)
            }
          })
        }

        ctx.broadcast(serviceName, 'removing', `Removing container...`)
        await dockerContainer.remove({ force: true }).catch((error) => {
          logger.warn(`Error removing container: ${error.message}`)
        })
      } else {
        ctx.broadcast(
          serviceName,
          'no-container',
          `No existing container found, proceeding with installation...`
        )
      }
    } catch (error: any) {
      logger.warn(
        { err: error },
        `[DockerService] Error during container cleanup for ${serviceName}`
      )
      ctx.broadcast(
        serviceName,
        'cleanup-warning',
        'Warning during container cleanup. Check server logs for details.'
      )
    }

    try {
      ctx.broadcast(serviceName, 'clearing-volumes', `Checking for volumes to clear...`)
      const volumes = await ctx.docker.listVolumes()
      const serviceVolumes =
        volumes.Volumes?.filter(
          (v) =>
            v.Name === serviceName ||
            v.Name.startsWith(`${serviceName}_`) ||
            v.Labels?.service === serviceName
        ) || []

      for (const vol of serviceVolumes) {
        try {
          const volume = ctx.docker.getVolume(vol.Name)
          await volume.remove({ force: true })
          ctx.broadcast(serviceName, 'volume-removed', `Removed volume: ${vol.Name}`)
        } catch (error: any) {
          logger.warn(`Failed to remove volume ${vol.Name}: ${error.message}`)
        }
      }

      if (serviceVolumes.length === 0) {
        ctx.broadcast(serviceName, 'no-volumes', `No volumes found to clear`)
      }
    } catch (error: any) {
      logger.warn({ err: error }, `[DockerService] Error during volume cleanup for ${serviceName}`)
      ctx.broadcast(
        serviceName,
        'volume-cleanup-warning',
        'Warning during volume cleanup. Check server logs for details.'
      )
    }

    service.installed = false
    service.installation_status = 'installing'
    await service.save()
    ctx.invalidateCache()

    ctx.broadcast(serviceName, 'recreating', `Recreating container...`)
    const containerConfig = ctx.parseConfig(service.container_config)

    createContainer(ctx, service, containerConfig).catch(async (error) => {
      logger.error(`Reinstallation failed for ${serviceName}: ${error.message}`)
      await ctx.cleanupFailedInstallation(serviceName)
    })

    return {
      success: true,
      message: `Service ${serviceName} force reinstall initiated successfully. You can receive updates via server-sent events.`,
    }
  } catch (error: any) {
    logger.error({ err: error }, `[DockerService] Force reinstall failed for ${serviceName}`)
    await ctx.cleanupFailedInstallation(serviceName)
    return {
      success: false,
      message: `Failed to force reinstall service ${serviceName}. Check server logs for details.`,
    }
  }
}

async function createContainer(
  ctx: DockerCtx,
  service: Service & { dependencies?: Service[] },
  containerConfig: any
): Promise<void> {
  try {
    ctx.broadcast(service.service_name, 'initializing', '')

    await ctx.applyHostStorageRoot(containerConfig)

    let dependencies = []
    if (service.depends_on) {
      const dependency = await Service.query().where('service_name', service.depends_on).first()
      if (dependency) {
        dependencies.push(dependency)
      }
    }

    if (dependencies && dependencies.length > 0) {
      ctx.broadcast(
        service.service_name,
        'checking-dependencies',
        `Checking dependencies for service ${service.service_name}...`
      )
      for (const dependency of dependencies) {
        if (!dependency.installed) {
          ctx.broadcast(
            service.service_name,
            'dependency-not-installed',
            `Dependency service ${dependency.service_name} is not installed. Installing it first...`
          )
          await createContainer(ctx, dependency, ctx.parseConfig(dependency.container_config))
        } else {
          ctx.broadcast(
            service.service_name,
            'dependency-installed',
            `Dependency service ${dependency.service_name} is already installed.`
          )
        }
      }
    }

    const imageExists = await ctx.checkImageExists(service.container_image)
    if (imageExists) {
      ctx.broadcast(
        service.service_name,
        'image-exists',
        `Docker image ${service.container_image} already exists locally. Skipping pull...`
      )
    } else {
      ctx.broadcast(
        service.service_name,
        'pulling',
        `Pulling Docker image ${service.container_image}...`
      )
      await ctx.pullImage(service.container_image)
    }

    const preinstallFn = PREINSTALL_MAP[service.service_name]
    if (preinstallFn) {
      await preinstallFn(ctx)
      ctx.broadcast(
        service.service_name,
        'preinstall-complete',
        `Pre-install actions for ${service.service_name} completed successfully.`
      )
    }

    let finalImage = service.container_image
    let gpuHostConfig = containerConfig?.HostConfig || {}
    let amdGpuConfigured = false

    if (service.service_name === SERVICE_NAMES.OLLAMA) {
      const gpuResult = await ctx.detectGPUType()

      if (gpuResult.type === 'nvidia') {
        ctx.broadcast(
          service.service_name,
          'gpu-config',
          `NVIDIA container runtime detected. Configuring container with GPU support...`
        )
        gpuHostConfig = {
          ...gpuHostConfig,
          DeviceRequests: [
            {
              Driver: 'nvidia',
              Count: -1,
              Capabilities: [['gpu']],
            },
          ],
        }
      } else if (gpuResult.type === 'amd') {
        const amdEnabledRaw = await KVStore.getValue('ai.amdGpuAcceleration')
        const amdAccelerationEnabled = String(amdEnabledRaw) !== 'false'

        if (amdAccelerationEnabled) {
          ctx.broadcast(
            service.service_name,
            'gpu-config',
            `AMD GPU detected. Using ROCm image with /dev/kfd and /dev/dri passthrough...`
          )

          finalImage = 'ollama/ollama:rocm'

          const rocmImageExists = await ctx.checkImageExists(finalImage)
          if (!rocmImageExists) {
            ctx.broadcast(service.service_name, 'pulling', `Pulling Docker image ${finalImage}...`)
            await ctx.pullImage(finalImage)
          }

          const amdDevices = await ctx.discoverAMDDevices()
          gpuHostConfig = {
            ...gpuHostConfig,
            Devices: amdDevices,
          }
          amdGpuConfigured = true
          logger.info(
            `[DockerService] Configured ROCm image and ${amdDevices.length} AMD device entries for Ollama`
          )
        } else {
          ctx.broadcast(
            service.service_name,
            'gpu-config',
            `AMD GPU detected but acceleration is disabled via ai.amdGpuAcceleration. Using CPU-only configuration.`
          )
          logger.info(
            '[DockerService] AMD GPU acceleration disabled by KV opt-out; using CPU-only configuration.'
          )
        }
      } else if (gpuResult.toolkitMissing) {
        ctx.broadcast(
          service.service_name,
          'gpu-config',
          `NVIDIA GPU detected but NVIDIA Container Toolkit is not installed. Using CPU-only configuration. Install the toolkit and reinstall AI Assistant for GPU acceleration: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html`
        )
      } else {
        ctx.broadcast(
          service.service_name,
          'gpu-config',
          `No GPU detected. Using CPU-only configuration...`
        )
      }
    }

    if (service.service_name === SERVICE_NAMES.COMFYUI) {
      const gpuResult = await ctx.detectGPUType()

      if (gpuResult.type === 'nvidia') {
        ctx.broadcast(
          service.service_name,
          'gpu-config',
          `NVIDIA container runtime detected. Configuring Image Studio with GPU support...`
        )
        gpuHostConfig = {
          ...gpuHostConfig,
          DeviceRequests: [
            {
              Driver: 'nvidia',
              Count: -1,
              Capabilities: [['gpu']],
            },
          ],
        }
      } else if (gpuResult.type === 'amd') {
        ctx.broadcast(
          service.service_name,
          'gpu-config',
          `AMD GPU detected. Using ROCm image with /dev/kfd and /dev/dri passthrough...`
        )
        finalImage = 'yanwk/comfyui-boot:rocm'
        const rocmImageExists = await ctx.checkImageExists(finalImage)
        if (!rocmImageExists) {
          ctx.broadcast(service.service_name, 'pulling', `Pulling Docker image ${finalImage}...`)
          await ctx.pullImage(finalImage)
        }
        const amdDevices = await ctx.discoverAMDDevices()
        gpuHostConfig = {
          ...gpuHostConfig,
          Devices: amdDevices,
        }
      } else {
        ctx.broadcast(
          service.service_name,
          'gpu-config',
          `No usable GPU detected. Using CPU-only image — image generation will be very slow...`
        )
        finalImage = 'yanwk/comfyui-boot:cpu'
        const cpuImageExists = await ctx.checkImageExists(finalImage)
        if (!cpuImageExists) {
          ctx.broadcast(service.service_name, 'pulling', `Pulling Docker image ${finalImage}...`)
          await ctx.pullImage(finalImage)
        }
      }
    }

    const ollamaEnv: string[] = []
    if (service.service_name === SERVICE_NAMES.OLLAMA) {
      ollamaEnv.push('OLLAMA_NO_CLOUD=1')
      const flashAttentionEnabled = await KVStore.getValue('ai.ollamaFlashAttention')
      if (flashAttentionEnabled !== false) {
        ollamaEnv.push('OLLAMA_FLASH_ATTENTION=1')
      }
      const kvCacheType = await KVStore.getValue('ai.ollamaKvCacheType')
      if (kvCacheType && typeof kvCacheType === 'string' && kvCacheType.trim() !== '') {
        ollamaEnv.push(`OLLAMA_KV_CACHE_TYPE=${kvCacheType.trim()}`)
      }
      if (amdGpuConfigured) {
        const hsaOverride = await ctx.resolveAmdHsaOverride()
        if (hsaOverride) {
          ollamaEnv.push(`HSA_OVERRIDE_GFX_VERSION=${hsaOverride}`)
        }
        ollamaEnv.push('OLLAMA_IGPU_ENABLE=1')
      }
    }

    const appEnv: string[] = []
    if (service.service_name === SERVICE_NAMES.HOMEBOX) {
      appEnv.push(`HBOX_AUTH_API_KEY_PEPPER=${await ctx.resolveHomeboxPepper()}`)
    }

    ctx.broadcast(
      service.service_name,
      'creating',
      `Creating Docker container for service ${service.service_name}...`
    )
    const container = await ctx.docker.createContainer({
      Image: finalImage,
      name: service.service_name,
      Labels: {
        ...(containerConfig?.Labels ?? {}),
        'com.docker.compose.project': 'project-nomad-managed',
        'io.project-nomad.managed': 'true',
      },
      ...(containerConfig?.User && { User: containerConfig.User }),
      HostConfig: gpuHostConfig,
      ...(containerConfig?.WorkingDir && { WorkingDir: containerConfig.WorkingDir }),
      ...(containerConfig?.ExposedPorts && { ExposedPorts: containerConfig.ExposedPorts }),
      Env: [...(containerConfig?.Env ?? []), ...ollamaEnv, ...appEnv],
      ...(service.container_command ? { Cmd: service.container_command.split(' ') } : {}),
      ...(process.env.NODE_ENV === 'production' && {
        NetworkingConfig: {
          EndpointsConfig: {
            ['project-nomad_default']: {},
          },
        },
      }),
    })

    ctx.broadcast(
      service.service_name,
      'starting',
      `Starting Docker container for service ${service.service_name}...`
    )
    await container.start()

    ctx.broadcast(
      service.service_name,
      'finalizing',
      `Finalizing installation of service ${service.service_name}...`
    )
    service.installed = true
    service.installation_status = 'idle'
    await service.save()
    ctx.invalidateCache()

    ctx.activeInstallations.delete(service.service_name)

    if (service.service_name === SERVICE_NAMES.OLLAMA) {
      logger.info(
        '[DockerService] Ollama installation complete. Default behavior is to not enable chat suggestions.'
      )
      await KVStore.setValue('chat.suggestionsEnabled', false)

      logger.info(
        '[DockerService] Ollama installation complete. Triggering Nomad docs discovery...'
      )

      const { OllamaService } = await import('../ollama_service.js')
      const { RagService } = await import('../rag_service.js')
      const ollamaService = new OllamaService()
      const ragService = new RagService(ctx.self, ollamaService)

      ragService.discoverNomadDocs().catch((error) => {
        logger.error('[DockerService] Failed to discover Nomad docs:', error)
      })
    }

    ctx.broadcast(
      service.service_name,
      'completed',
      `Service ${service.service_name} installation completed successfully.`
    )
  } catch (error: any) {
    const friendly = ctx.humanizeDockerError(error, service.service_name)
    ctx.broadcast(
      service.service_name,
      'error',
      `Error installing service ${service.service_name}: ${friendly}`
    )
    await ctx.cleanupFailedInstallation(service.service_name)
    throw new Error(`Failed to install service ${service.service_name}: ${friendly}`)
  }
}
