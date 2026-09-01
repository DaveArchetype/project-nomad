import type { ApplicationService } from '@adonisjs/core/types'
import { WATCHDOG_TICK_INTERVAL_MS } from '../constants/container_watchdog.js'

let timer: NodeJS.Timeout | null = null

export default class ContainerWatchdogProvider {
  constructor(protected app: ApplicationService) {}

  async boot() {
    if (this.app.getEnvironment() !== 'web') return

    let logger: any
    try {
      const loggerModule = await import('@adonisjs/core/services/logger')
      logger = loggerModule.default
    } catch {
      // Logger unavailable — interval will still run, errors will be swallowed.
    }

    let intervalMs = WATCHDOG_TICK_INTERVAL_MS
    try {
      const KVStore = (await import('#models/kv_store')).default
      const raw = await KVStore.getValue('watchdog.tickIntervalMs')
      if (raw != null && raw !== '') {
        const v = Number.parseInt(raw, 10)
        if (Number.isFinite(v) && v >= 5000) intervalMs = v
      }
    } catch {
      // KV unavailable — use default interval.
    }

    timer = setInterval(async () => {
      try {
        const { ContainerWatchdogService } = await import('#services/container_watchdog_service')
        await new ContainerWatchdogService().tick()
      } catch (err) {
        if (logger) {
          logger.warn(
            '[ContainerWatchdogProvider] Tick failed: %s',
            err instanceof Error ? err.message : String(err)
          )
        }
      }
    }, intervalMs)

    timer.unref()
    if (logger) {
      logger.info(
        `[ContainerWatchdogProvider] Started container OOM watchdog (${intervalMs}ms tick)`
      )
    }
  }

  async shutdown() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
}
