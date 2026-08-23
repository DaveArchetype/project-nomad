import logger from '@adonisjs/core/services/logger'
import type { ApplicationService } from '@adonisjs/core/types'

const TICK_INTERVAL_MS = 60_000

let timer: NodeJS.Timeout | null = null

export default class TeiIdleStopProvider {
  constructor(protected app: ApplicationService) {}

  async boot() {
    if (this.app.getEnvironment() !== 'web') return

    timer = setInterval(async () => {
      try {
        const { TeiLifecycleService } = await import('#services/tei_lifecycle_service')
        await new TeiLifecycleService().stopIfIdle()
      } catch (err) {
        logger.warn(
          '[TeiIdleStopProvider] Tick failed: %s',
          err instanceof Error ? err.message : String(err)
        )
      }
    }, TICK_INTERVAL_MS)

    timer.unref()
    logger.info('[TeiIdleStopProvider] Started TEI idle-stop watcher (60s tick)')
  }

  async shutdown() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
}
