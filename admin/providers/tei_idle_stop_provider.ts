import type { ApplicationService } from '@adonisjs/core/types'

const TICK_INTERVAL_MS = 60_000

let timer: NodeJS.Timeout | null = null

export default class TeiIdleStopProvider {
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

    timer = setInterval(async () => {
      try {
        const { TeiLifecycleService } = await import('#services/tei_lifecycle_service')
        await new TeiLifecycleService().stopIfIdle()
      } catch (err) {
        if (logger) {
          logger.warn(
            '[TeiIdleStopProvider] Tick failed: %s',
            err instanceof Error ? err.message : String(err)
          )
        }
      }
    }, TICK_INTERVAL_MS)

    timer.unref()
    if (logger) {
      logger.info('[TeiIdleStopProvider] Started TEI idle-stop watcher (60s tick)')
    }
  }

  async shutdown() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
}
