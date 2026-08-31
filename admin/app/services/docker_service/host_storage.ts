import Docker from 'dockerode'
import os from 'node:os'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'

const ADMIN_CONTAINER_NAME = 'nomad_admin'
const ADMIN_STORAGE_DEST = '/app/storage'
const DEFAULT_HOST_STORAGE_ROOT = '/opt/project-nomad/storage'

export async function resolveHostStorageRoot(docker: Docker): Promise<string> {
  const fallback = env.get('NOMAD_STORAGE_PATH', DEFAULT_HOST_STORAGE_ROOT)
  try {
    const containers = await docker.listContainers({ all: true })
    let adminInfo = containers.find((c) => c.Names.includes(`/${ADMIN_CONTAINER_NAME}`))
    if (!adminInfo) {
      const hn = os.hostname()
      adminInfo = containers.find((c) => c.Id.startsWith(hn))
    }
    if (!adminInfo) return fallback

    const inspected = await docker.getContainer(adminInfo.Id).inspect()
    const mount = (inspected.Mounts ?? []).find(
      (m: any) => m.Type === 'bind' && m.Destination === ADMIN_STORAGE_DEST
    )
    if (mount?.Source) {
      logger.info(`[DockerService] Resolved host storage root from admin mount: ${mount.Source}`)
      return mount.Source
    }
    return fallback
  } catch (err: any) {
    logger.warn(
      `[DockerService] Could not resolve host storage root, using fallback ${fallback}: ${err.message}`
    )
    return fallback
  }
}

export async function applyHostStorageRoot(docker: Docker, containerConfig: any): Promise<void> {
  const binds: string[] | undefined = containerConfig?.HostConfig?.Binds
  if (!binds?.length) return
  const root = await resolveHostStorageRoot(docker)
  const seededRoots = [
    env.get('NOMAD_STORAGE_PATH', DEFAULT_HOST_STORAGE_ROOT),
    DEFAULT_HOST_STORAGE_ROOT,
  ].filter((r) => r !== root)
  if (!seededRoots.length) return
  containerConfig.HostConfig.Binds = binds.map((b) => {
    const firstColon = b.indexOf(':')
    if (firstColon < 0) return b
    const hostSrc = b.slice(0, firstColon)
    const rest = b.slice(firstColon)
    const seededRoot = seededRoots.find((r) => hostSrc === r || hostSrc.startsWith(r + '/'))
    if (seededRoot) {
      return `${root}${hostSrc.slice(seededRoot.length)}${rest}`
    }
    return b
  })
}

export { ADMIN_CONTAINER_NAME, ADMIN_STORAGE_DEST, DEFAULT_HOST_STORAGE_ROOT }
