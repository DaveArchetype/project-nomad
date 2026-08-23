import Docker from 'dockerode'
import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'

const TEI_CONTAINER_NAME = 'nomad_tei'
const DEFAULT_IDLE_STOP_MINUTES = 5

export class TeiLifecycleService {
  private docker: Docker

  constructor() {
    const isWindows = process.platform === 'win32'
    this.docker = isWindows
      ? new Docker({ socketPath: '//./pipe/docker_engine' })
      : new Docker({ socketPath: '/var/run/docker.sock' })
  }

  async ensureStarted(): Promise<{ started: boolean; alreadyRunning: boolean }> {
    try {
      const containers = await this.docker.listContainers({ all: true })
      const tei = containers.find((c) => c.Names.includes(`/${TEI_CONTAINER_NAME}`))
      if (!tei) {
        logger.warn(`[TeiLifecycle] Container ${TEI_CONTAINER_NAME} not found — cannot start`)
        return { started: false, alreadyRunning: false }
      }

      if (tei.State === 'running') {
        await this.stampActivity()
        return { started: false, alreadyRunning: true }
      }

      const container = this.docker.getContainer(tei.Id)
      await container.start()
      await this.stampActivity()
      logger.info(`[TeiLifecycle] Started ${TEI_CONTAINER_NAME} on demand`)
      return { started: true, alreadyRunning: false }
    } catch (err) {
      logger.error(
        `[TeiLifecycle] Failed to start ${TEI_CONTAINER_NAME}: %s`,
        err instanceof Error ? err.message : String(err)
      )
      return { started: false, alreadyRunning: false }
    }
  }

  async stampActivity(): Promise<void> {
    try {
      await KVStore.setValue('rag.lastTeiActivityAt', String(Date.now()))
    } catch (err) {
      logger.warn(
        `[TeiLifecycle] Failed to stamp activity: %s`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  async stopIfIdle(): Promise<void> {
    try {
      const idleMinutesRaw = await KVStore.getValue('rag.teiIdleStopMinutes')
      const idleMinutes =
        idleMinutesRaw != null && idleMinutesRaw !== ''
          ? Number.parseInt(idleMinutesRaw, 10)
          : DEFAULT_IDLE_STOP_MINUTES

      if (!Number.isFinite(idleMinutes) || idleMinutes <= 0) return

      const lastActivityRaw = await KVStore.getValue('rag.lastTeiActivityAt')
      if (!lastActivityRaw) return

      const lastActivity = Number.parseInt(lastActivityRaw, 10)
      if (!Number.isFinite(lastActivity)) return

      const idleMs = Date.now() - lastActivity
      const thresholdMs = idleMinutes * 60 * 1000
      if (idleMs < thresholdMs) return

      const containers = await this.docker.listContainers({ all: true })
      const tei = containers.find((c) => c.Names.includes(`/${TEI_CONTAINER_NAME}`))
      if (!tei || tei.State !== 'running') return

      const container = this.docker.getContainer(tei.Id)
      await container.stop()
      await KVStore.clearValue('rag.lastTeiActivityAt')
      logger.info(
        `[TeiLifecycle] Stopped ${TEI_CONTAINER_NAME} after ${Math.round(idleMs / 1000 / 60)} min idle (threshold: ${idleMinutes} min)`
      )
    } catch (err) {
      logger.error(
        `[TeiLifecycle] Failed to check/stop idle TEI: %s`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }
}
