import KVStore from '#models/kv_store'
import { MapService } from '#services/map_service'
import { OllamaService } from '#services/ollama_service'
import { SystemService } from '#services/system_service'
import { DockerService } from '#services/docker_service'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import { getSettingSchema, updateSettingSchema, validateSettingValue } from '#validators/settings'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ADMIN_STORAGE_DEST } from '#services/docker_service/host_storage'

@inject()
export default class SettingsController {
  constructor(
    private systemService: SystemService,
    private mapService: MapService,
    private ollamaService: OllamaService,
    private dockerService: DockerService
  ) {}

  async system({ inertia }: HttpContext) {
    const systemInfo = await this.systemService.getSystemInfo()
    return inertia.render('settings/system', {
      system: {
        info: systemInfo,
      },
    })
  }

  async apps({ inertia }: HttpContext) {
    const services = await this.systemService.getServices({ installedOnly: false })
    return inertia.render('settings/apps', {
      system: {
        services,
      },
    })
  }

  async legal({ inertia }: HttpContext) {
    return inertia.render('settings/legal')
  }

  async support({ inertia }: HttpContext) {
    return inertia.render('settings/support')
  }

  async maps({ inertia }: HttpContext) {
    const baseAssetsCheck = await this.mapService.checkBaseAssetsExist()
    const [regionFiles, worldBasemapExists] = await Promise.all([
      this.mapService.listRegions(),
      this.mapService.checkWorldBasemapExists(),
    ])
    return inertia.render('settings/maps', {
      maps: {
        baseAssetsExist: baseAssetsCheck,
        worldBasemapExists,
        regionFiles: regionFiles.files,
      },
    })
  }

  async models({ inertia }: HttpContext) {
    const availableModels = await this.ollamaService.getAvailableModels({
      sort: 'pulls',
      recommendedOnly: false,
      query: null,
      limit: 15,
    })
    const installedModels = await this.ollamaService.getModels().catch(() => [])
    const chatSuggestionsEnabled = await KVStore.getValue('chat.suggestionsEnabled')
    const aiAssistantCustomName = await KVStore.getValue('ai.assistantCustomName')
    const remoteOllamaUrl = await KVStore.getValue('ai.remoteOllamaUrl')
    const ollamaFlashAttention = await KVStore.getValue('ai.ollamaFlashAttention')
    const ollamaKvCacheType = await KVStore.getValue('ai.ollamaKvCacheType')
    const ollamaNumCtx = await KVStore.getValue('ai.ollamaNumCtx')
    const autoThinking = await KVStore.getValue('ai.autoThinking')
    const embedPauseAfterChatMinutes = await KVStore.getValue('rag.embedPauseAfterChatMinutes')
    const embedConcurrency = await KVStore.getValue('rag.embedConcurrency')
    const maxConcurrentEmbeds = await KVStore.getValue('rag.maxConcurrentEmbeds')
    const qdrantUpsertConcurrency = await KVStore.getValue('rag.qdrantUpsertConcurrency')
    const embeddingBatchSize = await KVStore.getValue('rag.embeddingBatchSize')
    const zimWorkerCount = await KVStore.getValue('rag.zimWorkerCount')
    const qdrantIndexingThreshold = await KVStore.getValue('rag.qdrantIndexingThreshold')
    const teiIdleStopMinutes = await KVStore.getValue('rag.teiIdleStopMinutes')
    return inertia.render('settings/models', {
      models: {
        availableModels: availableModels?.models || [],
        installedModels: installedModels || [],
        settings: {
          chatSuggestionsEnabled: chatSuggestionsEnabled ?? false,
          aiAssistantCustomName: aiAssistantCustomName ?? '',
          remoteOllamaUrl: remoteOllamaUrl ?? '',
          ollamaFlashAttention: ollamaFlashAttention ?? true,
          ollamaKvCacheType: ollamaKvCacheType ?? '',
          ollamaNumCtx: ollamaNumCtx ?? '',
          autoThinking: autoThinking ?? false,
          embedPauseAfterChatMinutes: embedPauseAfterChatMinutes ?? '',
          embedConcurrency: embedConcurrency ?? '',
          maxConcurrentEmbeds: maxConcurrentEmbeds ?? '',
          qdrantUpsertConcurrency: qdrantUpsertConcurrency ?? '',
          embeddingBatchSize: embeddingBatchSize ?? '',
          zimWorkerCount: zimWorkerCount ?? '',
          qdrantIndexingThreshold: qdrantIndexingThreshold ?? '',
          teiIdleStopMinutes: teiIdleStopMinutes ?? '',
        },
      },
    })
  }

  async update({ inertia }: HttpContext) {
    const updateInfo = await this.systemService.checkLatestVersion()
    return inertia.render('settings/update', {
      system: {
        updateAvailable: updateInfo.updateAvailable,
        latestVersion: updateInfo.latestVersion,
        currentVersion: updateInfo.currentVersion,
      },
    })
  }

  async zim({ inertia }: HttpContext) {
    return inertia.render('settings/zim/index')
  }

  async zimRemote({ inertia }: HttpContext) {
    return inertia.render('settings/zim/remote-explorer')
  }

  async creatorPacks({ inertia }: HttpContext) {
    return inertia.render('settings/creator-packs')
  }

  async voice({ inertia }: HttpContext) {
    const [
      voiceEnabled,
      audioSource,
      wakeWordPreset,
      customWakeWordModelPath,
      wakeWordSensitivity,
      sttModelSize,
      sttLanguage,
      vadSensitivity,
      retentionDays,
      ttsEnabled,
      ttsVoice,
      ttsAutoReadReplies,
      ttsSpeechRate,
      recapEnabled,
      recapScheduleTime,
      recapTimezone,
      recapModel,
    ] = await Promise.all([
      KVStore.getValue('voice.enabled'),
      KVStore.getValue('voice.audioSource'),
      KVStore.getValue('voice.wakeWordPreset'),
      KVStore.getValue('voice.customWakeWordModelPath'),
      KVStore.getValue('voice.wakeWordSensitivity'),
      KVStore.getValue('stt.modelSize'),
      KVStore.getValue('stt.language'),
      KVStore.getValue('stt.vadSensitivity'),
      KVStore.getValue('voice.retentionDays'),
      KVStore.getValue('tts.enabled'),
      KVStore.getValue('tts.voice'),
      KVStore.getValue('tts.autoReadReplies'),
      KVStore.getValue('tts.speechRate'),
      KVStore.getValue('recap.enabled'),
      KVStore.getValue('recap.scheduleTime'),
      KVStore.getValue('recap.timezone'),
      KVStore.getValue('recap.model'),
    ])

    return inertia.render('settings/voice', {
      voice: {
        settings: {
          enabled: voiceEnabled ?? false,
          audioSource: audioSource || 'browser',
          wakeWordPreset: wakeWordPreset || 'hey_jarvis',
          customWakeWordModelPath: customWakeWordModelPath ?? '',
          wakeWordSensitivity: wakeWordSensitivity || '0.5',
          sttModelSize: sttModelSize || 'base',
          sttLanguage: sttLanguage || 'auto',
          vadSensitivity: vadSensitivity || '2',
          retentionDays: retentionDays || '30',
          ttsEnabled: ttsEnabled ?? false,
          ttsVoice: ttsVoice || 'en_US-lessac-medium',
          ttsAutoReadReplies: ttsAutoReadReplies ?? false,
          ttsSpeechRate: ttsSpeechRate || '1.0',
          recapEnabled: recapEnabled ?? false,
          recapScheduleTime: recapScheduleTime || '23:55',
          recapTimezone: recapTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          recapModel: recapModel ?? '',
        },
      },
    })
  }

  async advanced({ inertia }: HttpContext) {
    // When the env var is set it always takes precedence over the stored value,
    // so surface that to the UI to disable the field and explain the override.
    const envOverride = Boolean(env.get('INTERNET_STATUS_TEST_URL')?.trim())
    const internetStatusTestUrl = await KVStore.getValue('system.internetStatusTestUrl')
    return inertia.render('settings/advanced', {
      advanced: {
        internetStatusTestUrl: internetStatusTestUrl ?? '',
        internetStatusTestUrlEnvOverride: envOverride,
      },
    })
  }

  async appearance({ inertia }: HttpContext) {
    return inertia.render('settings/appearance')
  }

  async getSetting({ request, response }: HttpContext) {
    const { key } = await getSettingSchema.validate({ key: request.qs().key })
    const value = await KVStore.getValue(key)
    return response.status(200).send({ key, value })
  }

  async updateSetting({ request, response }: HttpContext) {
    const reqData = await request.validateUsing(updateSettingSchema)
    const valueError = validateSettingValue(reqData.key, reqData.value)
    if (valueError) {
      return response.status(422).send({ success: false, message: valueError })
    }
    await this.systemService.updateSetting(reqData.key, reqData.value)

    if (reqData.key === 'recap.scheduleTime' || reqData.key === 'recap.enabled') {
      const { DailyRecapJob } = await import('#jobs/daily_recap_job')
      await DailyRecapJob.schedule().catch(() => {})
    }

    return response.status(200).send({ success: true, message: 'Setting updated successfully' })
  }

  async getVpnCountries({ response }: HttpContext) {
    try {
      let raw: string | null = null

      try {
        const serversPath = path.join(ADMIN_STORAGE_DEST, 'vpn', 'gluetun', 'servers.json')
        raw = await fs.readFile(serversPath, 'utf-8')
      } catch {
        // File not accessible from admin container's filesystem
      }

      if (!raw) {
        const execResult = await this.execInContainer(SERVICE_NAMES.VPN, [
          'cat',
          '/gluetun/servers.json',
        ])
        if (execResult.exitCode === 0 && execResult.stdout) {
          raw = execResult.stdout
        }
      }

      if (!raw) {
        return response.status(200).send({
          countries: [],
          error: 'VPN server list not available. Install and start the VPN first.',
        })
      }

      const parsed = JSON.parse(raw)
      let servers: any[] = []
      if (Array.isArray(parsed)) {
        servers = parsed
      } else if (parsed.servers && Array.isArray(parsed.servers)) {
        servers = parsed.servers
      } else if (parsed.surfshark?.servers && Array.isArray(parsed.surfshark.servers)) {
        servers = parsed.surfshark.servers
      } else {
        for (const key of Object.keys(parsed)) {
          const provider = parsed[key]
          if (provider && provider.servers && Array.isArray(provider.servers)) {
            servers = servers.concat(provider.servers)
          }
        }
      }

      const countries = new Set<string>()
      for (const server of servers) {
        const country = server.country || server.Country
        if (country) {
          countries.add(country)
        }
      }
      const sorted = Array.from(countries).sort((a, b) => a.localeCompare(b))
      return response.status(200).send({ countries: sorted })
    } catch (err: any) {
      return response.status(200).send({
        countries: [],
        error: `VPN server list error: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  private async execInContainer(
    containerName: string,
    cmd: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const containers = await this.dockerService.docker.listContainers({ all: true })
    const info = containers.find((c) => c.Names.includes(`/${containerName}`))
    if (!info) {
      return { stdout: '', stderr: `Container ${containerName} not found`, exitCode: null }
    }
    const container = this.dockerService.docker.getContainer(info.Id)
    const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true })
    const stream = await exec.start({})
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const done = (exitCode: number | null) => {
        if (settled) return
        settled = true
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode })
      }
      container.modem.demuxStream(
        stream,
        {
          write: (data: Buffer) => {
            stdout += data.toString('utf-8')
          },
        },
        {
          write: (data: Buffer) => {
            stderr += data.toString('utf-8')
          },
        }
      )
      stream.on('end', () => {
        exec
          .inspect()
          .then((i: any) => done(i.ExitCode))
          .catch(() => done(null))
      })
      stream.on('error', () => done(null))
      setTimeout(() => {
        if (!settled) {
          try {
            stream.destroy()
          } catch {}
          done(null)
        }
      }, 15000)
    })
  }

  async testVpn({ response }: HttpContext) {
    try {
      const containers = await this.dockerService.docker.listContainers({ all: true })
      const vpnContainer = containers.find((c) => c.Names.includes(`/${SERVICE_NAMES.VPN}`))

      if (!vpnContainer) {
        return response.status(200).send({
          connected: false,
          checks: [
            {
              label: 'VPN container exists',
              passed: false,
              detail: 'VPN Gateway is not installed',
            },
          ],
        })
      }

      const checks: { label: string; passed: boolean; detail: string }[] = []

      checks.push({
        label: 'VPN container running',
        passed: vpnContainer.State === 'running',
        detail:
          vpnContainer.State === 'running'
            ? 'Container is running'
            : `Container state: ${vpnContainer.State}`,
      })

      if (vpnContainer.State !== 'running') {
        return response.status(200).send({ connected: false, checks })
      }

      const statusResult = await this.execInContainer(SERVICE_NAMES.VPN, [
        'wget',
        '-qO-',
        'http://localhost:8000/v1/vpn/status',
        '--timeout=5',
      ])
      let vpnStatus = 'unknown'
      if (statusResult.exitCode === 0 && statusResult.stdout) {
        try {
          const parsed = JSON.parse(statusResult.stdout)
          vpnStatus = parsed.status ?? 'unknown'
        } catch {
          vpnStatus = 'unknown'
        }
      }
      checks.push({
        label: 'VPN tunnel status',
        passed: vpnStatus === 'up' || vpnStatus === 'running',
        detail:
          vpnStatus === 'up' || vpnStatus === 'running'
            ? 'VPN tunnel is up'
            : `VPN status: ${vpnStatus}`,
      })

      const ipResult = await this.execInContainer(SERVICE_NAMES.VPN, [
        'wget',
        '-qO-',
        'https://api.ipify.org',
        '--timeout=10',
      ])
      const vpnIp = ipResult.exitCode === 0 ? ipResult.stdout : null
      checks.push({
        label: 'Public IP through VPN',
        passed: vpnIp !== null && vpnIp !== '',
        detail: vpnIp ? `VPN public IP: ${vpnIp}` : 'Could not determine public IP',
      })

      const hostIpResult = await this.execInContainer(SERVICE_NAMES.VPN, [
        'wget',
        '-qO-',
        'http://ip-api.com/json/',
        '--timeout=10',
      ])
      let ispInfo = ''
      if (hostIpResult.exitCode === 0 && hostIpResult.stdout) {
        try {
          const parsed = JSON.parse(hostIpResult.stdout)
          ispInfo = `${parsed.country ?? ''} ${parsed.city ?? ''} ${parsed.isp ?? ''}`.trim()
        } catch {
          // ignore
        }
      }
      if (ispInfo) {
        checks.push({
          label: 'VPN geolocation',
          passed: true,
          detail: ispInfo,
        })
      }

      const connected = checks.every((c) => c.passed)
      return response.status(200).send({ connected, checks, publicIp: vpnIp, geolocation: ispInfo })
    } catch (err: any) {
      return response.status(200).send({
        connected: false,
        checks: [
          {
            label: 'VPN test',
            passed: false,
            detail: err instanceof Error ? err.message : String(err),
          },
        ],
      })
    }
  }

  async testStremioVpn({ response }: HttpContext) {
    try {
      const stremioVpnEnabled = await KVStore.getValue('stremio.vpnEnabled')
      const containers = await this.dockerService.docker.listContainers({ all: true })
      const stremioContainer = containers.find((c) => c.Names.includes(`/${SERVICE_NAMES.STREMIO}`))
      const vpnContainer = containers.find((c) => c.Names.includes(`/${SERVICE_NAMES.VPN}`))

      const checks: { label: string; passed: boolean; detail: string }[] = []

      checks.push({
        label: 'VPN routing enabled in settings',
        passed: stremioVpnEnabled === true,
        detail:
          stremioVpnEnabled === true
            ? 'VPN routing is enabled'
            : 'VPN routing is disabled — toggle "Route Stremio through VPN" to enable',
      })

      if (!stremioContainer) {
        checks.push({
          label: 'Stremio container exists',
          passed: false,
          detail: 'Stremio is not installed',
        })
        return response.status(200).send({ routed: false, checks })
      }

      const inspected = await this.dockerService.docker.getContainer(stremioContainer.Id).inspect()
      const networkMode = inspected.HostConfig?.NetworkMode ?? 'default'
      const usingVpnNetwork = vpnContainer
        ? networkMode === `container:${SERVICE_NAMES.VPN}` ||
          networkMode === `container:${vpnContainer.Id}`
        : networkMode === `container:${SERVICE_NAMES.VPN}`

      checks.push({
        label: 'Stremio uses VPN network namespace',
        passed: usingVpnNetwork,
        detail: usingVpnNetwork
          ? 'Stremio shares the VPN container network — all traffic goes through the tunnel'
          : `Stremio network mode: ${networkMode} (not routed through VPN)`,
      })

      if (vpnContainer) {
        checks.push({
          label: 'VPN container running',
          passed: vpnContainer.State === 'running',
          detail:
            vpnContainer.State === 'running'
              ? 'VPN container is running'
              : `VPN container state: ${vpnContainer.State}`,
        })
      }

      const hasOwnPort = inspected.HostConfig?.PortBindings?.['8080/tcp'] != null
      checks.push({
        label: 'Stremio port ownership',
        passed: usingVpnNetwork ? !hasOwnPort : hasOwnPort,
        detail: usingVpnNetwork
          ? hasOwnPort
            ? 'Stremio still has its own port binding — should be removed'
            : 'Port 8530 is correctly owned by the VPN container'
          : 'Stremio correctly owns port 8530',
      })

      const reachable = await this.execInContainer(SERVICE_NAMES.VPN, [
        'wget',
        '-qO-',
        'http://localhost:8080',
        '--timeout=5',
        '--spider',
      ])
      checks.push({
        label: 'Stremio reachable through VPN',
        passed: reachable.exitCode === 0,
        detail:
          reachable.exitCode === 0
            ? 'Stremio web UI responds through the VPN network namespace'
            : 'Stremio is not reachable on port 8080 inside the VPN namespace',
      })

      const vpnIpResult = await this.execInContainer(SERVICE_NAMES.VPN, [
        'wget',
        '-qO-',
        'https://api.ipify.org',
        '--timeout=10',
      ])
      const vpnIp = vpnIpResult.exitCode === 0 ? vpnIpResult.stdout : null

      let hostIp: string | null = null
      try {
        const hostIpRes = await fetch('https://api.ipify.org', {
          signal: AbortSignal.timeout(10000),
        })
        if (hostIpRes.ok) {
          hostIp = (await hostIpRes.text()).trim()
        }
      } catch {}

      if (vpnIp && hostIp) {
        const ipsDiffer = vpnIp !== hostIp
        checks.push({
          label: 'Traffic routed through VPN',
          passed: ipsDiffer,
          detail: ipsDiffer
            ? `Stremio exits via VPN IP ${vpnIp} (host IP is ${hostIp}) — traffic is encrypted`
            : `Stremio IP (${vpnIp}) matches host IP (${hostIp}) — traffic is NOT going through VPN`,
        })
      } else if (vpnIp) {
        checks.push({
          label: 'Traffic routed through VPN',
          passed: true,
          detail: `Stremio exits via IP ${vpnIp} (could not fetch host IP for comparison)`,
        })
      }

      const routed = checks.every((c) => c.passed)
      return response.status(200).send({ routed, checks })
    } catch (err: any) {
      return response.status(200).send({
        routed: false,
        checks: [
          {
            label: 'Stremio VPN test',
            passed: false,
            detail: err instanceof Error ? err.message : String(err),
          },
        ],
      })
    }
  }
}
