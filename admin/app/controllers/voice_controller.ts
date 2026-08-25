import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { readFile } from 'node:fs/promises'
import logger from '@adonisjs/core/services/logger'
import { VoiceGatewayClientService } from '#services/voice_gateway_client_service'
import { TtsService } from '#services/tts_service'
import { AmbientRecallService } from '#services/ambient_recall_service'
import { DailyRecapJob } from '#jobs/daily_recap_job'
import { DailyRecapService } from '#services/daily_recap_service'
import { OllamaService } from '#services/ollama_service'
import { synthesizeSchema, recapDateParamSchema } from '#validators/voice'

@inject()
export default class VoiceController {
  constructor(
    private voiceGatewayClient: VoiceGatewayClientService,
    private ttsService: TtsService,
    private ambientRecallService: AmbientRecallService
  ) {}

  /** Combined status the frontend uses to decide whether to show the mic icon at all. */
  async status({ response }: HttpContext) {
    const [gateway, tts] = await Promise.all([
      this.voiceGatewayClient.checkHealth(),
      this.ttsService.checkHealth(),
    ])
    return response.status(200).json({ gateway, tts })
  }

  async wakeWordPresets({ response }: HttpContext) {
    const presets = await this.voiceGatewayClient.getWakeWordPresets()
    if (!presets) {
      return response.status(503).json({ error: 'Voice Gateway is not reachable.' })
    }
    return response.status(200).json(presets)
  }

  async uploadWakeWordModel({ request, response }: HttpContext) {
    const uploadedFile = request.file('file', { extnames: ['onnx'], size: '150mb' })
    if (!uploadedFile || !uploadedFile.tmpPath) {
      return response.status(400).json({ error: 'No .onnx file uploaded.' })
    }

    const buffer = await readFile(uploadedFile.tmpPath)
    const result = await this.voiceGatewayClient.uploadCustomWakeWordModel(
      buffer,
      uploadedFile.clientName
    )
    return response.status(result.success ? 200 : 422).json(result)
  }

  async deleteWakeWordModel({ response }: HttpContext) {
    const result = await this.voiceGatewayClient.deleteCustomWakeWordModel()
    return response.status(result.success ? 200 : 422).json(result)
  }

  async ttsVoices({ response }: HttpContext) {
    const voices = await this.ttsService.listVoices()
    if (!voices) {
      return response.status(503).json({ error: 'Text-to-Speech service is not reachable.' })
    }
    return response.status(200).json(voices)
  }

  async synthesize({ request, response }: HttpContext) {
    const data = await request.validateUsing(synthesizeSchema)
    const result = await this.ttsService.synthesize(data.text, data.voice)
    if (!result.success) {
      return response.status(502).json({ error: result.message })
    }
    response.header('Content-Type', result.contentType)
    return response.send(result.audio)
  }

  async listRecaps({ request, response }: HttpContext) {
    const limit = Math.min(Number.parseInt(request.qs().limit ?? '30', 10) || 30, 90)
    const DailyRecap = (await import('#models/daily_recap')).default
    const recaps = await DailyRecap.query().orderBy('recap_date', 'desc').limit(limit)
    return response.status(200).json(recaps)
  }

  async getRecap({ params, response }: HttpContext) {
    const { date } = await recapDateParamSchema.validate({ date: params.date })
    const recap = await this.ambientRecallService.getRecapForDate(date)
    if (!recap) {
      return response.status(404).json({ error: `No recap found for ${date}.` })
    }
    return response.status(200).json(recap)
  }

  /** Manually (re-)generate a recap for a given date — used by the "Generate now" button in Settings. */
  async generateRecap({ request, response }: HttpContext) {
    const dateInput = request.input('date')
    const date = typeof dateInput === 'string' && dateInput ? dateInput : undefined
    const recapService = new DailyRecapService(new OllamaService())
    try {
      const recap = date
        ? await recapService.generateForDate(date)
        : await recapService.generateForYesterday()
      if (!recap) {
        return response
          .status(422)
          .json({ error: 'No ambient recordings found for that day, or generation failed.' })
      }
      return response.status(200).json(recap)
    } catch (err) {
      logger.error(
        `[VoiceController] Manual recap generation failed: ${err instanceof Error ? err.message : String(err)}`
      )
      return response.status(500).json({ error: 'Failed to generate recap.' })
    }
  }

  /** Re-applies the BullMQ cron schedule — called after `recap.scheduleTime`/`recap.enabled` change. */
  async rescheduleRecapJob({ response }: HttpContext) {
    await DailyRecapJob.schedule()
    return response.status(200).json({ success: true })
  }
}
