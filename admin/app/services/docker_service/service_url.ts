import Service from '#models/service'
import KVStore from '#models/kv_store'
import { SERVICE_NAMES } from '../../../constants/service_names.js'

export async function getServiceURL(serviceName: string): Promise<string | null> {
  if (!serviceName || serviceName.trim() === '') {
    return null
  }

  if (serviceName === SERVICE_NAMES.OLLAMA) {
    const remoteUrl = await KVStore.getValue('ai.remoteOllamaUrl')
    if (remoteUrl) return remoteUrl
  }

  const service = await Service.query()
    .where('service_name', serviceName)
    .andWhere('installed', true)
    .first()

  if (!service) {
    return null
  }

  const hostname = process.env.NODE_ENV === 'production' ? serviceName : 'localhost'

  const schemePort = service.ui_location?.match(/^(https?):(\d+)$/)
  if (schemePort) {
    return `${schemePort[1]}://${hostname}:${schemePort[2]}`
  }

  if (service.ui_location && Number.parseInt(service.ui_location, 10)) {
    return `http://${hostname}:${service.ui_location}`
  }

  const parsedConfig = parseConfigInline(service.container_config)
  if (parsedConfig?.HostConfig?.PortBindings) {
    const portBindings = parsedConfig.HostConfig.PortBindings
    const hostPorts = Object.values(portBindings)
    if (!hostPorts || !Array.isArray(hostPorts) || hostPorts.length === 0) {
      return null
    }

    const hostPortsArray = hostPorts.flat() as { HostPort: string }[]
    const hostPortsStrings = hostPortsArray.map((binding) => binding.HostPort)
    if (hostPortsStrings.length > 0) {
      return `http://${hostname}:${hostPortsStrings[0]}`
    }
  }

  return null
}

function parseConfigInline(containerConfig: any): any {
  if (!containerConfig) return {}
  try {
    let toParse = containerConfig
    if (typeof containerConfig === 'object') {
      toParse = JSON.stringify(containerConfig)
    }
    return JSON.parse(toParse)
  } catch {
    return {}
  }
}
