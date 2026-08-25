import { WebSocket as NodeWebSocket, RawData } from 'ws'
import type { WebSocket as ClientWebSocket } from 'ws'
import logger from '@adonisjs/core/services/logger'
import app from '@adonisjs/core/services/app'
import transmit from '@adonisjs/transmit/services/main'
import { VoiceGatewayClientService } from './voice_gateway_client_service.js'
import { VoiceIngestService } from './voice_ingest_service.js'
import { BROADCAST_CHANNELS } from '../../constants/broadcast.js'

const GATEWAY_RECONNECT_ATTEMPTS = 3
const GATEWAY_RECONNECT_DELAY_MS = 1000

/**
 * Bridges one browser `/ws/voice` connection to a companion connection on the
 * Voice Gateway container. This is the real-time hop of the pipeline: raw PCM
 * frames are piped through with minimal buffering, and `wake`/`final`
 * messages from the gateway are relayed straight back down to the browser
 * (near-real-time) as well as handed to `VoiceIngestService` for persistence.
 *
 * One instance is created per browser connection by the raw WS upgrade
 * handler in `start/ws.ts` — it is not a long-lived singleton.
 */
export class VoiceWsBridgeService {
  private gatewaySocket: ClientWebSocket | null = null
  private closed = false

  constructor(private browserSocket: ClientWebSocket) {}

  async start(): Promise<void> {
    const gatewayClient = await app.container.make(VoiceGatewayClientService)
    const wsUrl = await gatewayClient.getWsUrl()

    if (!wsUrl) {
      this.sendToBrowser({ type: 'error', message: 'Voice Gateway is not installed or reachable.' })
      this.browserSocket.close(1011, 'voice-gateway-unavailable')
      return
    }

    await this.connectToGateway(wsUrl, 0)

    this.browserSocket.on('message', (data: RawData, isBinary: boolean) => {
      if (!isBinary) return // ignore stray text frames from the browser side
      if (this.gatewaySocket && this.gatewaySocket.readyState === NodeWebSocket.OPEN) {
        this.gatewaySocket.send(data)
      }
    })

    this.browserSocket.on('close', () => {
      this.closed = true
      this.gatewaySocket?.close()
    })

    this.browserSocket.on('error', () => {
      this.closed = true
      this.gatewaySocket?.close()
    })
  }

  private async connectToGateway(wsUrl: string, attempt: number): Promise<void> {
    if (this.closed) return

    const socket: ClientWebSocket = new NodeWebSocket(wsUrl)
    this.gatewaySocket = socket

    socket.on('open', () => {
      logger.info('[VoiceWsBridge] Connected to Voice Gateway')
      socket.send(JSON.stringify({ type: 'config', sampleRate: 16000 }))
    })

    socket.on('message', (data: RawData) => {
      this.handleGatewayMessage(data.toString())
    })

    socket.on('close', () => {
      if (this.closed) return
      if (attempt < GATEWAY_RECONNECT_ATTEMPTS) {
        logger.warn(
          `[VoiceWsBridge] Gateway connection dropped, reconnecting (attempt ${attempt + 1}/${GATEWAY_RECONNECT_ATTEMPTS})`
        )
        setTimeout(() => this.connectToGateway(wsUrl, attempt + 1), GATEWAY_RECONNECT_DELAY_MS)
      } else {
        this.sendToBrowser({ type: 'error', message: 'Lost connection to Voice Gateway.' })
        this.browserSocket.close(1011, 'voice-gateway-disconnected')
      }
    })

    socket.on('error', (err) => {
      logger.warn(`[VoiceWsBridge] Gateway socket error: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  private async handleGatewayMessage(raw: string) {
    let message: any
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }

    if (message.type === 'ready') return

    // Relay immediately for a responsive UI, then persist in the background —
    // ingestion (embedding + Qdrant + MySQL) should never add latency to the
    // live wake/transcript signal the browser is waiting on.
    this.sendToBrowser(message)

    if (message.type === 'wake') {
      transmit.broadcast(BROADCAST_CHANNELS.VOICE_STATE, {
        type: 'wake',
        score: message.score,
        model: message.model,
        at: Date.now(),
      })
      return
    }

    if (message.type === 'final' && typeof message.text === 'string' && message.text.trim()) {
      try {
        const ingestService = await app.container.make(VoiceIngestService)
        await ingestService.ingestSegment({
          text: message.text,
          startedAtMs: message.startedAtMs,
          endedAtMs: message.endedAtMs,
          isWakeWord: Boolean(message.isWakeWord),
        })
      } catch (err) {
        logger.error(
          `[VoiceWsBridge] Failed to ingest ambient segment: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  private sendToBrowser(message: unknown) {
    if (this.browserSocket.readyState === NodeWebSocket.OPEN) {
      this.browserSocket.send(JSON.stringify(message))
    }
  }
}
