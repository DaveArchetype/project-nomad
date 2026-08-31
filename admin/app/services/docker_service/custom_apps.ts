import Service from '#models/service'
import logger from '@adonisjs/core/services/logger'
import { SERVICE_NAMES } from '../../../constants/service_names.js'
import type { DockerCtx, OperationResult } from './types.js'
import { awaitContainerReady } from './updater.js'

export async function removeCustomAppContainer(
  ctx: DockerCtx,
  serviceName: string,
  removeImage = false
): Promise<OperationResult> {
  try {
    const containers = await ctx.docker.listContainers({ all: true })
    const container = containers.find((c) => c.Names.includes(`/${serviceName}`))

    if (!container) return { success: true, message: 'No container found — nothing to remove' }

    const imageRef = container.Image
    const c = ctx.docker.getContainer(container.Id)
    if (container.State === 'running') await c.stop()
    await c.remove({ force: true })

    if (removeImage && imageRef) {
      try {
        await ctx.docker.getImage(imageRef).remove()
      } catch (imgErr: any) {
        logger.warn(
          `[DockerService] Could not remove image ${imageRef} for ${serviceName}: ${imgErr.message}`
        )
      }
    }

    ctx.invalidateCache()
    return { success: true, message: `Container ${serviceName} removed` }
  } catch (error: any) {
    logger.error(
      { err: error },
      `[DockerService] removeCustomAppContainer failed for ${serviceName}`
    )
    return { success: false, message: error.message }
  }
}

export async function uninstallService(
  ctx: DockerCtx,
  serviceName: string,
  removeImage = false
): Promise<OperationResult> {
  const service = await Service.query().where('service_name', serviceName).first()
  if (!service || !service.installed) {
    return { success: false, message: `Service ${serviceName} not found or not installed` }
  }

  const removal = await removeCustomAppContainer(ctx, serviceName, removeImage)
  if (!removal.success) return removal

  service.installed = false
  service.installation_status = 'idle'
  await service.save()
  ctx.invalidateCache()

  return { success: true, message: `Service ${serviceName} uninstalled` }
}

export async function recreateCustomAppContainer(
  ctx: DockerCtx,
  serviceName: string,
  opts: { forcePull?: boolean } = {}
): Promise<OperationResult> {
  const service = await Service.query().where('service_name', serviceName).first()
  if (!service) return { success: false, message: `Service ${serviceName} not found` }

  const containerConfig = ctx.parseConfig(service.container_config)
  const oldInfo = await ctx.findContainerByName(serviceName)
  const oldName = `${serviceName}_old`

  const staleOld = await ctx.findContainerByName(oldName)
  if (staleOld) {
    await ctx.docker
      .getContainer(staleOld.Id)
      .remove({ force: true })
      .catch(() => {})
  }

  try {
    if (oldInfo) {
      const oldContainer = ctx.docker.getContainer(oldInfo.Id)
      if (oldInfo.State === 'running') await oldContainer.stop({ t: 10 }).catch(() => {})
      await oldContainer.rename({ name: oldName })
    }

    if (opts.forcePull || !(await ctx.checkImageExists(service.container_image))) {
      await ctx.pullImage(service.container_image)
    }

    let recreateEnv: string[] = containerConfig?.Env ?? []
    if (
      serviceName === SERVICE_NAMES.HOMEBOX &&
      !recreateEnv.some((e: string) => e.startsWith('HBOX_AUTH_API_KEY_PEPPER='))
    ) {
      recreateEnv = [...recreateEnv, `HBOX_AUTH_API_KEY_PEPPER=${await ctx.resolveHomeboxPepper()}`]
    }

    const newContainer = await ctx.docker.createContainer({
      Image: service.container_image,
      name: serviceName,
      Labels: {
        ...(containerConfig?.Labels ?? {}),
        'com.docker.compose.project': 'project-nomad-managed',
        'io.project-nomad.managed': 'true',
      },
      ...(containerConfig?.User && { User: containerConfig.User }),
      HostConfig: containerConfig?.HostConfig ?? {},
      ...(containerConfig?.ExposedPorts && { ExposedPorts: containerConfig.ExposedPorts }),
      ...(recreateEnv.length ? { Env: recreateEnv } : {}),
      ...(service.container_command ? { Cmd: service.container_command.split(' ') } : {}),
      ...(process.env.NODE_ENV === 'production' && {
        NetworkingConfig: { EndpointsConfig: { ['project-nomad_default']: {} } },
      }),
    })
    await newContainer.start()

    const readiness = await awaitContainerReady(newContainer)
    if (!readiness.ready) throw new Error(`recreated container ${readiness.reason}`)

    if (oldInfo) {
      const oldRef = await ctx.findContainerByName(oldName)
      if (oldRef) await ctx.docker.getContainer(oldRef.Id).remove({ force: true })
    }
    service.installed = true
    service.installation_status = 'idle'
    await service.save()
    ctx.invalidateCache()
    return { success: true, message: `Service ${serviceName} reconfigured successfully` }
  } catch (error: any) {
    logger.error(
      { err: error },
      `[DockerService] recreateCustomAppContainer failed for ${serviceName}`
    )
    try {
      const failedNew = await ctx.findContainerByName(serviceName)
      if (failedNew) {
        const c = ctx.docker.getContainer(failedNew.Id)
        await c.stop({ t: 5 }).catch(() => {})
        await c.remove({ force: true }).catch(() => {})
      }
      const renamed = await ctx.findContainerByName(oldName)
      if (renamed) {
        const c = ctx.docker.getContainer(renamed.Id)
        await c.rename({ name: serviceName })
        await c.start().catch(() => {})
      }
    } catch (rollbackError: any) {
      logger.error({ err: rollbackError }, `[DockerService] rollback failed for ${serviceName}`)
    }
    ctx.invalidateCache()
    return { success: false, message: `Reconfigure failed and was rolled back: ${error.message}` }
  }
}
