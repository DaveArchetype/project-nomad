import logger from '@adonisjs/core/services/logger'
import type { DockerCtx, PortConflict } from './types.js'

export async function checkPortConflicts(
  ctx: DockerCtx,
  ports: number[]
): Promise<{ conflicts: PortConflict[] }> {
  if (!ports.length) return { conflicts: [] }

  try {
    const containers = await ctx.docker.listContainers({ all: true })
    const bound = new Map<number, string>()

    for (const c of containers) {
      const name = (c.Names[0] || '').replace('/', '')
      for (const p of c.Ports) {
        if (p.PublicPort) bound.set(p.PublicPort, name || c.Id.slice(0, 12))
      }
    }

    const conflicts = ports
      .filter((p) => bound.has(p))
      .map((p) => ({ port: p, usedBy: bound.get(p)! }))

    return { conflicts }
  } catch (error: any) {
    logger.warn(`[DockerService] checkPortConflicts failed: ${error.message}`)
    return { conflicts: [] }
  }
}
