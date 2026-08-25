/*
|--------------------------------------------------------------------------
| WebSocket routes
|--------------------------------------------------------------------------
|
| AdonisJS's router only handles plain HTTP; real-time, bidirectional audio
| streaming for the Voice Assistant feature needs a raw WebSocket instead.
| This attaches a `ws` server directly to the underlying Node HTTP server
| (available via the `server` service once the app has booted) and handles
| the `upgrade` event for `/ws/voice` only — every other path is left alone
| so it doesn't interfere with anything else running on this server.
|
| Called once from `bin/server.ts`'s `app.ready()` callback, after the HTTP
| server is listening (`server.getNodeServer()` is null before that).
|
*/

import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import { WebSocketServer } from 'ws'
import server from '@adonisjs/core/services/server'
import logger from '@adonisjs/core/services/logger'
import { VoiceWsBridgeService } from '#services/voice_ws_bridge_service'

const VOICE_WS_PATH = '/ws/voice'

export function registerWebSocketRoutes() {
  const nodeServer = server.getNodeServer()
  if (!nodeServer) {
    logger.warn('[ws] Node HTTP server not available yet — Voice Assistant WebSocket not attached.')
    return
  }

  const wss = new WebSocketServer({ noServer: true })

  wss.on('connection', (socket) => {
    const bridge = new VoiceWsBridgeService(socket)
    bridge.start().catch((err) => {
      logger.error(
        `[ws] Voice bridge failed to start: ${err instanceof Error ? err.message : String(err)}`
      )
      socket.close(1011, 'internal-error')
    })
  })

  nodeServer.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(request.url ?? '', 'http://internal')
    if (url.pathname !== VOICE_WS_PATH) {
      // Not ours — leave the socket alone in case something else (or a future
      // feature) also upgrades connections on this server.
      return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  })

  logger.info(`[ws] Voice Assistant WebSocket listening at ${VOICE_WS_PATH}`)
}
