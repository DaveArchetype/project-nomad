import Docker from 'dockerode'
import logger from '@adonisjs/core/services/logger'
import transmit from '@adonisjs/transmit/services/main'
import { BROADCAST_CHANNELS } from '../../constants/broadcast.js'
import KVStore from '#models/kv_store'
import {
  MANAGED_LABEL,
  MB_BYTES,
  WATCHDOG_HOST_MEM_KILL_PERCENT,
  WATCHDOG_KILL_COOLDOWN_MS,
  WATCHDOG_LOOP_BREAK_KILLS,
  WATCHDOG_LOOP_BREAK_WINDOW_MS,
  WATCHDOG_MEM_PRESSURE_THRESHOLD,
  WATCHDOG_SUSTAINED_TICKS,
  resolveMemoryLimitBytes,
} from '../../constants/container_watchdog.js'

export class ContainerWatchdogService {
  private docker: Docker
  private pressureTicks = new Map<string, number>()
  private lastKillAt = new Map<string, number>()
  private killHistory = new Map<string, number[]>()

  constructor() {
    const isWindows = process.platform === 'win32'
    this.docker = isWindows
      ? new Docker({ socketPath: '//./pipe/docker_engine' })
      : new Docker({ socketPath: '/var/run/docker.sock' })
  }

  async tick(): Promise<void> {
    const enabledRaw = await KVStore.getValue('watchdog.enabled')
    if (enabledRaw === false) return

    try {
      await this.reconcileMemoryLimits()
    } catch (err: any) {
      logger.warn(
        '[ContainerWatchdog] reconcileMemoryLimits failed: %s',
        err instanceof Error ? err.message : String(err)
      )
    }
    try {
      await this.stopRunawayContainers()
    } catch (err: any) {
      logger.warn(
        '[ContainerWatchdog] stopRunawayContainers failed: %s',
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  private async listManagedContainers(): Promise<any[]> {
    const containers = await this.docker.listContainers({ all: false })
    return containers.filter((c) => c.Labels?.[MANAGED_LABEL] === 'true')
  }

  async reconcileMemoryLimits(): Promise<void> {
    const containers = await this.listManagedContainers()
    for (const info of containers) {
      const name = info.Names[0]?.replace('/', '') ?? info.Id
      try {
        const container = this.docker.getContainer(info.Id)
        const inspected = await container.inspect()
        const currentMemory = inspected.HostConfig?.Memory ?? 0
        const currentSwap = inspected.HostConfig?.MemorySwap ?? 0
        const desired = await resolveMemoryLimitBytes(name, async (k) => {
          const v = await KVStore.getValue(k as any)
          return v == null ? null : String(v)
        })
        const desiredSwap = desired > 0 ? desired : -1
        if (desired === currentMemory && (desired === 0 || desiredSwap === currentSwap)) {
          continue
        }
        if (desired > 0) {
          await container.update({ Memory: desired, MemorySwap: desiredSwap })
          logger.info(
            `[ContainerWatchdog] Set memory limit on ${name} to ${Math.round(desired / MB_BYTES)} MB (was ${currentMemory > 0 ? Math.round(currentMemory / MB_BYTES) : 0} MB)`
          )
        } else {
          await container.update({ Memory: 0, MemorySwap: -1 })
          logger.info(
            `[ContainerWatchdog] Cleared memory limit on ${name} (was ${currentMemory > 0 ? Math.round(currentMemory / MB_BYTES) : 0} MB)`
          )
        }
      } catch (err: any) {
        logger.warn(
          `[ContainerWatchdog] reconcile ${name} failed: %s`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }
  }

  private async readThresholds(): Promise<{
    memPressureThreshold: number
    sustainedTicks: number
    hostMemKillPercent: number
  }> {
    const thresholdRaw = await KVStore.getValue('watchdog.memPressureThreshold')
    const memPressureThreshold =
      thresholdRaw != null && thresholdRaw !== ''
        ? Number.parseFloat(thresholdRaw)
        : WATCHDOG_MEM_PRESSURE_THRESHOLD
    const sustainedRaw = await KVStore.getValue('watchdog.sustainedTicks')
    const sustainedTicks =
      sustainedRaw != null && sustainedRaw !== ''
        ? Number.parseInt(sustainedRaw, 10)
        : WATCHDOG_SUSTAINED_TICKS
    const hostRaw = await KVStore.getValue('watchdog.hostMemKillPercent')
    const hostMemKillPercent =
      hostRaw != null && hostRaw !== ''
        ? Number.parseInt(hostRaw, 10)
        : WATCHDOG_HOST_MEM_KILL_PERCENT
    return {
      memPressureThreshold: Number.isFinite(memPressureThreshold)
        ? memPressureThreshold
        : WATCHDOG_MEM_PRESSURE_THRESHOLD,
      sustainedTicks:
        Number.isFinite(sustainedTicks) && sustainedTicks > 0
          ? sustainedTicks
          : WATCHDOG_SUSTAINED_TICKS,
      hostMemKillPercent: Number.isFinite(hostMemKillPercent)
        ? hostMemKillPercent
        : WATCHDOG_HOST_MEM_KILL_PERCENT,
    }
  }

  async stopRunawayContainers(): Promise<void> {
    const containers = await this.listManagedContainers()
    const { memPressureThreshold, sustainedTicks, hostMemKillPercent } = await this.readThresholds()

    for (const info of containers) {
      const id = info.Id
      const name = info.Names[0]?.replace('/', '') ?? id
      let pressured = false
      try {
        const s: any = await this.docker.getContainer(id).stats({ stream: false })
        const cache = s.memory_stats?.stats?.cache ?? s.memory_stats?.stats?.inactive_file ?? 0
        const memUsage = Math.max(0, (s.memory_stats?.usage ?? 0) - cache)
        const memLimit = s.memory_stats?.limit ?? 0
        const configuredLimit = await resolveMemoryLimitBytes(name, async (k) => {
          const v = await KVStore.getValue(k as any)
          return v == null ? null : String(v)
        })
        if (configuredLimit > 0) {
          if (memUsage / configuredLimit >= memPressureThreshold) pressured = true
        } else if (memLimit > 0 && memUsage > 0) {
          const hostPercent = (memUsage / memLimit) * 100
          if (hostPercent >= hostMemKillPercent) pressured = true
        }
      } catch (err: any) {
        logger.debug(
          `[ContainerWatchdog] stats for ${name} failed: %s`,
          err instanceof Error ? err.message : String(err)
        )
      }

      if (pressured) {
        const ticks = (this.pressureTicks.get(id) ?? 0) + 1
        this.pressureTicks.set(id, ticks)
        if (ticks >= sustainedTicks) {
          await this.killContainer(id, name)
          this.pressureTicks.set(id, 0)
        }
      } else {
        this.pressureTicks.delete(id)
      }
    }
  }

  private async killContainer(id: string, name: string): Promise<void> {
    const now = Date.now()
    const lastKill = this.lastKillAt.get(id) ?? 0
    if (now - lastKill < WATCHDOG_KILL_COOLDOWN_MS) {
      logger.info(
        `[ContainerWatchdog] ${name} pressured but within kill cooldown (${Math.round((now - lastKill) / 1000)}s) — skipping`
      )
      return
    }

    const history = (this.killHistory.get(id) ?? []).filter(
      (t) => now - t < WATCHDOG_LOOP_BREAK_WINDOW_MS
    )
    history.push(now)
    this.killHistory.set(id, history)

    const container = this.docker.getContainer(id)
    try {
      if (history.length >= WATCHDOG_LOOP_BREAK_KILLS) {
        logger.warn(
          `[ContainerWatchdog] ${name} killed ${history.length}x in ${Math.round(WATCHDOG_LOOP_BREAK_WINDOW_MS / 1000 / 60)} min — flipping restart policy to "no" to break the loop. Restart it manually from the UI once the workload is fixed.`
        )
        try {
          await container.update({ RestartPolicy: { Name: 'no', MaximumRetryCount: 0 } })
        } catch (err: any) {
          logger.warn(
            `[ContainerWatchdog] Failed to flip restart policy on ${name}: %s`,
            err instanceof Error ? err.message : String(err)
          )
        }
        this.killHistory.set(id, [])
      }
      await container.stop({ t: 10 })
      this.lastKillAt.set(id, now)
      logger.warn(
        `[ContainerWatchdog] Stopped ${name} after sustained memory pressure (${history.length} kill(s) in last ${Math.round(WATCHDOG_LOOP_BREAK_WINDOW_MS / 1000 / 60)} min)`
      )
      transmit.broadcast(BROADCAST_CHANNELS.SERVICE_INSTALLATION, {
        service_name: name,
        timestamp: new Date().toISOString(),
        status: 'watchdog-kill',
        message: `Stopped by OOM watchdog after sustained memory pressure.`,
      })
    } catch (err: any) {
      logger.error(
        `[ContainerWatchdog] Failed to stop ${name}: %s`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }
}
