import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { join } from 'node:path'

interface MissingEntry {
  source: string
  fileName: string
  resourceId: string
  version: string
  chunksEmbedded: number | null
}

interface ResolveResult {
  fileName: string
  resourceId: string
  resolved: boolean
  url: string | null
  version: string | null
  sizeBytes: number | null
  source: 'manifest' | 'kiwix_catalog' | 'unresolved'
  reason?: string
}

interface DispatchResult extends ResolveResult {
  dispatched: boolean
  jobId?: string
  skippedReason?: string
}

export default class KbRedownloadMissingZim extends BaseCommand {
  static commandName = 'kb:redownload-missing-zim'
  static description =
    'Detect ZIM files that were embedded but are missing from disk, then re-download them'

  @flags.boolean({
    description:
      'Resolve download URLs and print what would be downloaded without dispatching jobs',
  })
  declare dryRun: boolean

  @flags.boolean({
    description: 'Emit a JSON summary to stdout instead of a human-readable report',
  })
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
    const { getFileStatsIfExists, ZIM_STORAGE_PATH } = await import('../../app/utils/fs.js')
    const { CollectionManifestService } = await import('#services/collection_manifest_service')
    const { KiwixCatalogService } = await import('#services/kiwix_catalog_service')
    const { RunDownloadJob } = await import('#jobs/run_download_job')
    const { resolveZimDownload } = await import('../../app/utils/zim_download_resolution.js')
    const { getHostedContentHeaders } = await import('../../app/utils/hosted_content_auth.js')

    const ZIM_MIME_TYPES = [
      'application/x-zim',
      'application/x-openzim',
      'application/octet-stream',
    ]

    const dockerService = new DockerService()

    // ── Step 1: detect missing ZIM files (same logic as kb:missing-zim) ──
    const candidates = new Map<
      string,
      { fromQdrant: boolean; fromState: boolean; chunksEmbedded: number | null }
    >()

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
        candidates.set(hit.value, {
          fromQdrant: true,
          fromState: false,
          chunksEmbedded: null,
        })
      }
    } catch (err) {
      this.logger.error(
        `Failed to query Qdrant facet: ${err instanceof Error ? err.message : String(err)}`
      )
      this.exitCode = 2
      return
    }

    try {
      const stateRows = await KbIngestState.query()
        .where('state', 'indexed')
        .select('file_path', 'chunks_embedded')
      for (const row of stateRows) {
        if (!row.file_path.toLowerCase().endsWith('.zim')) continue
        const existing = candidates.get(row.file_path)
        if (existing) {
          existing.fromState = true
          existing.chunksEmbedded = row.chunks_embedded
        } else {
          candidates.set(row.file_path, {
            fromQdrant: false,
            fromState: true,
            chunksEmbedded: row.chunks_embedded,
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

    const missing: MissingEntry[] = []
    for (const [source, meta] of candidates) {
      const stats = await getFileStatsIfExists(source)
      if (stats) continue
      const fileName = source.split(/[/\\]/).at(-1) ?? source
      const parsed = CollectionManifestService.parseZimFilename(fileName)
      if (!parsed) {
        this.logger.info(
          `Could not parse resource_id/version from filename: ${fileName} — skipping`
        )
        continue
      }
      missing.push({
        source,
        fileName,
        resourceId: parsed.resource_id,
        version: parsed.version,
        chunksEmbedded: meta.chunksEmbedded,
      })
    }

    missing.sort((a, b) => a.fileName.localeCompare(b.fileName))

    if (missing.length === 0) {
      if (this.json) {
        console.log(
          JSON.stringify({ missing: [], dispatched: [], skipped: [], unresolved: [] }, null, 2)
        )
      } else {
        this.logger.success('No missing ZIM files detected — nothing to re-download.')
      }
      this.exitCode = 0
      return
    }

    // ── Step 2: build spec resource map from the curated manifest ──
    const manifestService = new CollectionManifestService()
    const spec =
      await manifestService.getSpecWithFallback<
        import('../../types/collections.js').ZimCategoriesSpec
      >('zim_categories')

    const specResourceMap = new Map<string, import('../../types/collections.js').SpecResource>()
    if (spec) {
      for (const cat of spec.categories) {
        for (const tier of cat.tiers) {
          for (const res of tier.resources) {
            specResourceMap.set(res.id, res)
          }
        }
      }
    }

    // ── Step 3: resolve download URL for each missing file ──
    const catalogService = new KiwixCatalogService()
    const resolved: ResolveResult[] = []

    for (const entry of missing) {
      const specResource = specResourceMap.get(entry.resourceId)
      if (specResource) {
        // Curated/manifest resource — use resolveZimDownload (handles gated content,
        // and checks the catalog for a newer version of non-gated resources).
        let latest = null
        try {
          latest = await catalogService.getLatestZim(entry.resourceId)
        } catch (err) {
          this.logger.info(
            `Catalog lookup failed for ${entry.resourceId}: ${err instanceof Error ? err.message : String(err)}`
          )
        }
        const resolvedDownload = resolveZimDownload(specResource, latest)
        resolved.push({
          fileName: entry.fileName,
          resourceId: entry.resourceId,
          resolved: true,
          url: resolvedDownload.url,
          version: resolvedDownload.version,
          sizeBytes: resolvedDownload.sizeBytes ?? null,
          source: 'manifest',
        })
      } else {
        // Not in the manifest — try the public Kiwix catalog directly.
        try {
          const latest = await catalogService.getLatestZim(entry.resourceId)
          if (latest) {
            resolved.push({
              fileName: entry.fileName,
              resourceId: entry.resourceId,
              resolved: true,
              url: latest.download_url,
              version: latest.version,
              sizeBytes: latest.size_bytes > 0 ? latest.size_bytes : null,
              source: 'kiwix_catalog',
            })
          } else {
            resolved.push({
              fileName: entry.fileName,
              resourceId: entry.resourceId,
              resolved: false,
              url: null,
              version: null,
              sizeBytes: null,
              source: 'unresolved',
              reason: 'Not found in curated manifest or Kiwix catalog',
            })
          }
        } catch (err) {
          resolved.push({
            fileName: entry.fileName,
            resourceId: entry.resourceId,
            resolved: false,
            url: null,
            version: null,
            sizeBytes: null,
            source: 'unresolved',
            reason: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    // ── Step 4: dispatch downloads (or just report in dry-run) ──
    const results: DispatchResult[] = []

    for (const r of resolved) {
      if (!r.resolved || !r.url) {
        results.push({ ...r, dispatched: false, skippedReason: r.reason ?? 'unresolved' })
        continue
      }

      const downloadFileName = r.url!.split('/').pop() ?? r.fileName
      const filepath = join(process.cwd(), ZIM_STORAGE_PATH, downloadFileName)

      if (this.dryRun) {
        results.push({ ...r, dispatched: false, skippedReason: 'dry-run' })
        continue
      }

      // Skip if a download for this URL is already in flight.
      const existingJob = await RunDownloadJob.getActiveByUrl(r.url!).catch(() => undefined)
      if (existingJob) {
        results.push({ ...r, dispatched: false, skippedReason: 'already in flight' })
        continue
      }

      // For manifest resources, thread the auth header through (gated content).
      const specResource = specResourceMap.get(r.resourceId)
      const requestHeaders = specResource ? getHostedContentHeaders(specResource) : undefined

      try {
        const result = await RunDownloadJob.dispatch({
          url: r.url!,
          filepath,
          timeout: 30000,
          allowedMimeTypes: ZIM_MIME_TYPES,
          filetype: 'zim',
          totalBytes: r.sizeBytes ?? undefined,
          requestHeaders,
          resourceMetadata: {
            resource_id: r.resourceId,
            version: r.version ?? '',
            collection_ref: null,
          },
        })
        results.push({
          ...r,
          dispatched: result.created,
          jobId: result.job?.id,
          skippedReason: result.created ? undefined : 'job already exists',
        })
      } catch (err) {
        results.push({
          ...r,
          dispatched: false,
          skippedReason: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // ── Step 5: report ──
    const dispatched = results.filter((r) => r.dispatched)
    const skipped = results.filter((r) => !r.dispatched && r.resolved)
    const unresolved = results.filter((r) => !r.resolved)

    if (this.json) {
      console.log(
        JSON.stringify(
          {
            missingCount: missing.length,
            dispatched,
            skipped,
            unresolved,
            dryRun: this.dryRun,
          },
          null,
          2
        )
      )
    } else {
      this.logger.info('')
      this.logger.info(
        `${this.dryRun ? '[DRY RUN] ' : ''}${missing.length} missing ZIM file(s) detected`
      )
      this.logger.info(
        `${dispatched.length} dispatched, ${skipped.length} skipped, ${unresolved.length} unresolved`
      )
      this.logger.info('')

      if (dispatched.length > 0) {
        this.logger.success('Dispatched downloads:')
        for (const r of dispatched) {
          const sizeStr = r.sizeBytes ? ` (${(r.sizeBytes / 1024 / 1024).toFixed(1)} MB)` : ''
          this.logger.info(
            `  ${r.fileName}  →  ${r.url}${sizeStr}  [${r.source}]${r.jobId ? `  job=${r.jobId}` : ''}`
          )
        }
        this.logger.info('')
      }

      if (skipped.length > 0) {
        this.logger.info('Skipped:')
        for (const r of skipped) {
          this.logger.info(`  ${r.fileName}  —  ${r.skippedReason}`)
        }
        this.logger.info('')
      }

      if (unresolved.length > 0) {
        this.logger.error('Could not resolve a download URL:')
        for (const r of unresolved) {
          this.logger.info(`  ${r.fileName}  —  ${r.reason ?? 'unknown'}`)
        }
        this.logger.info('')
        this.logger.info('These files are not in the curated manifest or the public Kiwix catalog.')
        this.logger.info(
          'They may be private/custom ZIMs you sideloaded manually. Re-acquire them from your original source.'
        )
      }

      if (dispatched.length > 0 && !this.dryRun) {
        this.logger.info(
          'Downloads are running in the background. Re-embedding starts automatically on completion.'
        )
        this.logger.info('Track progress in the NOMAD admin UI → Downloads.')
      }
    }

    this.exitCode = unresolved.length > 0 ? 1 : 0
  }
}
