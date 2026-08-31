import logger from '@adonisjs/core/services/logger'
import { SERVICE_NAMES } from '../../../constants/service_names.js'

export function humanizeDockerError(error: any, serviceName: string): string {
  const raw: string = error?.message ?? String(error)
  const portMatch = raw.match(
    /(?:Bind for [^:]+:(\d+) failed: port is already allocated|:(\d+): bind: address already in use)/i
  )
  if (portMatch) {
    const port = portMatch[1] || portMatch[2]
    const portText = port ? `port ${port}` : 'a required port'
    if (port === '11434' || serviceName === SERVICE_NAMES.OLLAMA) {
      return `Couldn't start because ${portText} is already in use on this machine. This usually means Ollama is already installed and running directly on the host (outside NOMAD). Stop and disable the host Ollama service (e.g. "sudo systemctl stop ollama" then "sudo systemctl disable ollama"), then try again.`
    }
    return `Couldn't start because ${portText} is already in use on this machine. Stop whatever is using ${portText} on the host, then try again.`
  }
  return raw
}

export function parseContainerConfig(containerConfig: any): any {
  if (!containerConfig) {
    return {}
  }

  try {
    let toParse = containerConfig
    if (typeof containerConfig === 'object') {
      toParse = JSON.stringify(containerConfig)
    }

    return JSON.parse(toParse)
  } catch (error: any) {
    logger.error(`Failed to parse container configuration: ${error.message}`)
    throw new Error(`Invalid container configuration: ${error.message}`)
  }
}
