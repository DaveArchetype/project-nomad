import Service from '#models/service'
import logger from '@adonisjs/core/services/logger'
import { SERVICE_NAMES } from '../../../constants/service_names.js'
import type { DockerCtx, OperationResult, ServiceStatus } from './types.js'
import { migrateKiwixToLibraryMode } from './kiwix_migration.js'

export async function affectContainer(
  ctx: DockerCtx,
  serviceName: string,
  action: 'start' | 'stop' | 'restart'
): Promise<OperationResult> {
  try {
    const service = await Service.query().where('service_name', serviceName).first()
    if (!service || !service.installed) {
      return {
        success: false,
        message: `Service ${serviceName} not found or not installed`,
      }
    }

    const containers = await ctx.docker.listContainers({ all: true })
    const container = containers.find((c) => c.Names.includes(`/${serviceName}`))
    if (!container) {
      return {
        success: false,
        message: `Container for service ${serviceName} not found`,
      }
    }

    const dockerContainer = ctx.docker.getContainer(container.Id)
    if (action === 'stop') {
      await dockerContainer.stop()
      ctx.invalidateCache()
      return {
        success: true,
        message: `Service ${serviceName} stopped successfully`,
      }
    }

    if (action === 'restart') {
      if (serviceName === SERVICE_NAMES.KIWIX) {
        const isLegacy = await isKiwixOnLegacyConfig(ctx)
        if (isLegacy) {
          logger.info(
            '[DockerService] Kiwix on legacy glob config — running migration instead of restart.'
          )
          await migrateKiwixToLibraryMode(ctx)
          ctx.invalidateCache()
          return { success: true, message: 'Kiwix migrated to library mode successfully.' }
        }
      }

      await dockerContainer.restart()
      ctx.invalidateCache()

      return {
        success: true,
        message: `Service ${serviceName} restarted successfully`,
      }
    }

    if (action === 'start') {
      if (container.State === 'running') {
        return {
          success: true,
          message: `Service ${serviceName} is already running`,
        }
      }

      await dockerContainer.start()
      ctx.invalidateCache()

      return {
        success: true,
        message: `Service ${serviceName} started successfully`,
      }
    }

    return {
      success: false,
      message: `Invalid action: ${action}. Use 'start', 'stop', or 'restart'.`,
    }
  } catch (error: any) {
    logger.error({ err: error }, `[DockerService] Error controlling service ${serviceName}`)
    return {
      success: false,
      message: `Failed to ${action} service ${serviceName}. Check server logs for details.`,
    }
  }
}

export async function fetchServicesStatus(ctx: DockerCtx): Promise<ServiceStatus[]> {
  try {
    const containers = await ctx.docker.listContainers({ all: true })
    const containerMap = new Map<string, any>()
    containers.forEach((container) => {
      const name = container.Names[0]?.replace('/', '')
      if (name && name.startsWith('nomad_')) {
        containerMap.set(name, container)
      }
    })

    return Array.from(containerMap.entries()).map(([name, container]) => ({
      service_name: name,
      status: container.State,
    }))
  } catch (error: any) {
    logger.error(`Error fetching services status: ${error.message}`)
    return []
  }
}

export async function checkIfServiceContainerExists(
  ctx: DockerCtx,
  serviceName: string
): Promise<boolean> {
  try {
    const containers = await ctx.docker.listContainers({ all: true })
    return containers.some((container) => container.Names.includes(`/${serviceName}`))
  } catch (error: any) {
    logger.error(`Error checking if service container exists: ${error.message}`)
    return false
  }
}

export async function isKiwixOnLegacyConfig(ctx: DockerCtx): Promise<boolean> {
  try {
    const containers = await ctx.docker.listContainers({ all: true })
    const info = containers.find((c) => c.Names.includes(`/${SERVICE_NAMES.KIWIX}`))
    if (!info) return false

    const inspected = await ctx.docker.getContainer(info.Id).inspect()
    const cmd: string[] = inspected.Config?.Cmd ?? []
    return cmd.some((arg) => arg.includes('*.zim'))
  } catch (err: any) {
    logger.warn(`[DockerService] Could not inspect kiwix container: ${err.message}`)
    return false
  }
}
