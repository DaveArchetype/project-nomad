import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

interface MissingZimEntry {
  source: string
  fileName: string
  chunksEmbedded: number | null
  collection: string | null
  flaggedBy: string[]
}

export default class KbMissingZim extends BaseCommand {
  static commandName = 'kb:missing-zim'
  static description =
    'List ZIM files that were embedded (model trained on) but are missing from disk'

  @flags.boolean({ description: 'Emit a JSON array to stdout instead of a human-readable report' })
  declare json: boolean

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    const { DockerService } = await import('#services/docker_service')
    const { RagService } = await import('#services/rag_service')
    const { QdrantClient } = await import('@qdrant/js-client-rest')
    const { SERVICE_NAMES } = await import('../../constants/service_names.js')
    const KbIngestState = (await import('#models/kb_ingest_state')).default
    const { getFileStatsIfExists } = await import('../../app/utils/fs.js')

    const dockerService = new DockerService()

    const candidates = new Map<
      string,
      {
        fromQdrant: boolean
        fromState: boolean
        chunksEmbedded: number | null
        collection: string | null
      }
    >()

    try {
      const qdrantUrl = await dockerService.getServiceURL(SERVICE_NAMES.QDRANT)
      if (!qdrantUrl) {
        this.logger.error(
          'Qdrant vector database is offline. Start the AI Assistant service and retry.'
        )
        this.exitCode = 2
        return
      }

      const qdrant = new QdrantClient({ url: qdrantUrl })

      try {
        const facetResult = await qdrant.facet(RagService.CONTENT_COLLECTION_NAME, {
          key: 'source',
          limit: RagService.FACET_SOURCE_LIMIT,
          exact: true,
        })
        for (const hit of facetResult.hits) {
          if (typeof hit.value !== 'string') continue
          if (!hit.value.toLowerCase().endsWith('.zim')) continue
          const existing = candidates.get(hit.value)
          if (existing) {
            existing.fromQdrant = true
          } else {
            candidates.set(hit.value, {
              fromQdrant: true,
              fromState: false,
              chunksEmbedded: null,
              collection: null,
            })
          }
        }
      } catch (err) {
        this.logger.error(
          `Failed to query Qdrant facet on 'source': ${
            err instanceof Error ? err.message : String(err)
          }`
        )
        this.exitCode = 2
        return
      }
    } catch (err) {
      this.logger.error(
        `Failed to initialise Qdrant client: ${err instanceof Error ? err.message : String(err)}`
      )
      this.exitCode = 2
      return
    }

    try {
      const stateRows = await KbIngestState.query()
        .where('state', 'indexed')
        .select('file_path', 'chunks_embedded', 'collection')
      for (const row of stateRows) {
        if (!row.file_path.toLowerCase().endsWith('.zim')) continue
        const existing = candidates.get(row.file_path)
        if (existing) {
          existing.fromState = true
          existing.chunksEmbedded = row.chunks_embedded
          existing.collection = row.collection
        } else {
          candidates.set(row.file_path, {
            fromQdrant: false,
            fromState: true,
            chunksEmbedded: row.chunks_embedded,
            collection: row.collection,
          })
        }
      }
    } catch (err) {
      this.logger.error(
        `Failed to query kb_ingest_state: ${err instanceof Error ? err.message : String(err)}`
      )
      this.exitCode = 2
      return
    }

    const missing: MissingZimEntry[] = []
    let present = 0
    for (const [source, meta] of candidates) {
      const stats = await getFileStatsIfExists(source)
      if (stats) {
        present++
        continue
      }
      const flaggedBy: string[] = []
      if (meta.fromQdrant) flaggedBy.push('qdrant')
      if (meta.fromState) flaggedBy.push('kb_ingest_state')
      missing.push({
        source,
        fileName: source.split(/[/\\]/).at(-1) ?? source,
        chunksEmbedded: meta.chunksEmbedded,
        collection: meta.collection,
        flaggedBy,
      })
    }

    missing.sort((a, b) => a.fileName.localeCompare(b.fileName))

    if (this.json) {
      console.log(JSON.stringify(missing, null, 2))
    } else {
      this.logger.info('')
      this.logger.info(
        `Checked ${candidates.size} indexed ZIM source(s): ${present} present, ${missing.length} missing from disk`
      )
      this.logger.info('')

      if (missing.length === 0) {
        this.logger.success('No missing ZIM files detected.')
      } else {
        this.logger.error(`Found ${missing.length} missing ZIM file(s):`)
        this.logger.info('')
        for (const entry of missing) {
          const chunks = entry.chunksEmbedded !== null ? entry.chunksEmbedded.toString() : 'unknown'
          const collection = entry.collection ?? 'uncategorized'
          this.logger.info(
            `  ${entry.fileName}  |  chunks: ${chunks}  |  collection: ${collection}  |  flagged by: ${entry.flaggedBy.join(', ')}`
          )
          this.logger.info(`    path: ${entry.source}`)
        }
        this.logger.info('')
        this.logger.info(
          'These ZIM archives were embedded (the model was trained on them) but the .zim files'
        )
        this.logger.info(
          'are no longer on disk. This happens when the pre-9e96b51 embedding flow deleted ZIMs'
        )
        this.logger.info('after embedding. Re-download the files to restore them.')
      }
    }

    this.exitCode = missing.length > 0 ? 1 : 0
  }
}
