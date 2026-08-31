import logger from '@adonisjs/core/services/logger'
import type { ContainerStats, DockerCtx } from './types.js'

export function demuxDockerLog(buf: Buffer): string {
  let out = ''
  let offset = 0
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4)
    offset += 8
    if (offset + size > buf.length) {
      out += buf.toString('utf8', offset)
      break
    }
    out += buf.toString('utf8', offset, offset + size)
    offset += size
  }
  return out
}

export async function getContainerLogs(
  ctx: DockerCtx,
  serviceName: string,
  tail = 200
): Promise<{ success: boolean; logs?: string; message?: string }> {
  try {
    const info = await ctx.findContainerByName(serviceName)
    if (!info) return { success: false, message: `No container found for ${serviceName}` }

    const container = ctx.docker.getContainer(info.Id)
    const inspect = await container.inspect()
    const tty = inspect.Config?.Tty ?? false

    const buf = (await container.logs({
      stdout: true,
      stderr: true,
      follow: false,
      tail,
      timestamps: false,
    })) as unknown as Buffer

    const logs = tty ? buf.toString('utf8') : demuxDockerLog(buf)
    return { success: true, logs }
  } catch (error: any) {
    logger.error({ err: error }, `[DockerService] getContainerLogs failed for ${serviceName}`)
    return { success: false, message: error.message }
  }
}

export async function getContainerStats(
  ctx: DockerCtx,
  serviceName: string
): Promise<{
  success: boolean
  running?: boolean
  stats?: ContainerStats
  message?: string
}> {
  try {
    const info = await ctx.findContainerByName(serviceName)
    if (!info) return { success: false, message: `No container found for ${serviceName}` }
    if (info.State !== 'running') return { success: true, running: false }

    const container = ctx.docker.getContainer(info.Id)
    const s: any = await container.stats({ stream: false })

    const cpuDelta =
      (s.cpu_stats?.cpu_usage?.total_usage ?? 0) - (s.precpu_stats?.cpu_usage?.total_usage ?? 0)
    const systemDelta =
      (s.cpu_stats?.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0)
    const numCpus = s.cpu_stats?.online_cpus ?? s.cpu_stats?.cpu_usage?.percpu_usage?.length ?? 1
    const cpuPercent =
      systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0

    const cache = s.memory_stats?.stats?.cache ?? s.memory_stats?.stats?.inactive_file ?? 0
    const memUsageBytes = Math.max(0, (s.memory_stats?.usage ?? 0) - cache)
    const memLimitBytes = s.memory_stats?.limit ?? 0
    const memPercent = memLimitBytes > 0 ? (memUsageBytes / memLimitBytes) * 100 : 0

    return {
      success: true,
      running: true,
      stats: {
        cpuPercent: Math.round(cpuPercent * 10) / 10,
        memUsageBytes,
        memLimitBytes,
        memPercent: Math.round(memPercent * 10) / 10,
      },
    }
  } catch (error: any) {
    logger.error({ err: error }, `[DockerService] getContainerStats failed for ${serviceName}`)
    return { success: false, message: error.message }
  }
}
