import KbIngestState from '#models/kb_ingest_state'
import { SERVICE_NAMES } from '../../../constants/service_names.js'
import { decideContentReindex, type ReindexOutcome } from '../../utils/content_reindex_decision.js'
import type { RagCtx } from './types.js'
import { deletePointsBySource } from './artifacts.js'

export async function reconcileReplacedContentFile(
  ctx: RagCtx,
  params: {
    oldFilePath: string
    newFilePath: string
    fileName: string
  }
): Promise<ReindexOutcome> {
  const { oldFilePath, newFilePath, fileName } = params

  const isReplacement = !!oldFilePath && oldFilePath !== newFilePath

  const qdrantInstalled = isReplacement
    ? !!(await ctx.dockerService.getServiceURL(SERVICE_NAMES.QDRANT))
    : false

  let oldFileWasIndexed = false
  if (isReplacement && qdrantInstalled) {
    const oldState = await KbIngestState.query().where('file_path', oldFilePath).first()
    oldFileWasIndexed = oldState?.state === 'indexed'
  }

  let qdrantRunning = false
  if (isReplacement && qdrantInstalled && oldFileWasIndexed) {
    const health = await ctx.checkQdrantHealth()
    qdrantRunning = health.online
  }

  const outcome = decideContentReindex({
    isReplacement,
    qdrantInstalled,
    oldFileWasIndexed,
    qdrantRunning,
  })

  if (outcome === 'reindex') {
    await deletePointsBySource(ctx, oldFilePath)
    await KbIngestState.remove(oldFilePath)
    const { EmbedFileJob } = await import('#jobs/embed_file_job')
    await EmbedFileJob.dispatch({ fileName, filePath: newFilePath })
  }

  return outcome
}
