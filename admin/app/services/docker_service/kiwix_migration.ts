import Service from '#models/service'
import logger from '@adonisjs/core/services/logger'
import { KiwixLibraryService } from '../kiwix_library_service.js'
import { SERVICE_NAMES } from '../../../constants/service_names.js'
import { KIWIX_LIBRARY_CMD } from '../../../constants/kiwix.js'
import type { DockerCtx } from './types.js'

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

export async function migrateKiwixToLibraryMode(ctx: DockerCtx): Promise<void> {
  if (ctx.activeInstallations.has(SERVICE_NAMES.KIWIX)) {
    logger.warn('[DockerService] Kiwix migration already in progress, skipping duplicate call.')
    return
  }

  ctx.activeInstallations.add(SERVICE_NAMES.KIWIX)

  try {
    ctx.broadcast(SERVICE_NAMES.KIWIX, 'migrating', 'Migrating kiwix to library mode...')
    const kiwixLibraryService = new KiwixLibraryService()
    await kiwixLibraryService.rebuildFromDisk()
    ctx.broadcast(
      SERVICE_NAMES.KIWIX,
      'migrating',
      'Built kiwix library XML from existing ZIM files.'
    )

    const containers = await ctx.docker.listContainers({ all: true })
    const containerInfo = containers.find((c) => c.Names.includes(`/${SERVICE_NAMES.KIWIX}`))
    if (containerInfo) {
      const oldContainer = ctx.docker.getContainer(containerInfo.Id)
      if (containerInfo.State === 'running') {
        await oldContainer
          .stop({ t: 10 })
          .catch((e: any) =>
            logger.warn(`[DockerService] Kiwix stop warning during migration: ${e.message}`)
          )
      }
      await oldContainer
        .remove({ force: true })
        .catch((e: any) =>
          logger.warn(`[DockerService] Kiwix remove warning during migration: ${e.message}`)
        )
    }

    const service = await Service.query().where('service_name', SERVICE_NAMES.KIWIX).first()
    if (!service) {
      throw new Error('Kiwix service record not found in DB during migration')
    }

    service.container_command = KIWIX_LIBRARY_CMD
    service.installed = false
    service.installation_status = 'installing'
    await service.save()

    const containerConfig = ctx.parseConfig(service.container_config)
    await ctx.applyHostStorageRoot(containerConfig)

    ctx.broadcast(
      SERVICE_NAMES.KIWIX,
      'migrating',
      'Recreating kiwix container with library mode config...'
    )
    const newContainer = await ctx.docker.createContainer({
      Image: service.container_image,
      name: service.service_name,
      HostConfig: containerConfig?.HostConfig ?? {},
      ...(containerConfig?.ExposedPorts && { ExposedPorts: containerConfig.ExposedPorts }),
      Cmd: KIWIX_LIBRARY_CMD.split(' '),
      ...(process.env.NODE_ENV === 'production' && {
        NetworkingConfig: {
          EndpointsConfig: {
            ['project-nomad_default']: {},
          },
        },
      }),
    })

    await newContainer.start()

    service.installed = true
    service.installation_status = 'idle'
    await service.save()
    ctx.activeInstallations.delete(SERVICE_NAMES.KIWIX)

    ctx.broadcast(SERVICE_NAMES.KIWIX, 'migrated', 'Kiwix successfully migrated to library mode.')
    logger.info('[DockerService] Kiwix migration to library mode complete.')
  } catch (error: any) {
    logger.error(`[DockerService] Kiwix migration failed: ${error.message}`)
    await ctx.cleanupFailedInstallation(SERVICE_NAMES.KIWIX)
    throw error
  }
}
