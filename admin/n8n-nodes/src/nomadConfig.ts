import {
  NodeConnectionTypes,
  type IExecuteFunctions,
  type INodeType,
  type INodeTypeDescription,
  type INodeExecutionData,
} from 'n8n-workflow'

export const NOMAD_ADMIN_HOST = process.env.NOMAD_ADMIN_HOST || 'nomad_admin'
export const NOMAD_ADMIN_PORT = process.env.NOMAD_ADMIN_PORT || '8080'
export const NOMAD_ADMIN_BASE_URL =
  process.env.NOMAD_ADMIN_BASE_URL || `http://${NOMAD_ADMIN_HOST}:${NOMAD_ADMIN_PORT}`

export async function getNomadSecret(this: IExecuteFunctions): Promise<string> {
  try {
    const secret = await this.getCredentials('nomadAutomationSecret', 0)
    if (secret && (secret as any)?.secret) {
      return (secret as any).secret as string
    }
  } catch {}
  return process.env.NOMAD_AUTOMATION_SECRET ?? ''
}

export function nomadHeaders(secret: string) {
  return {
    'Content-Type': 'application/json',
    'x-nomad-automation-secret': secret,
  }
}

export async function nomadPost(url: string, body: any, secret: string): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: nomadHeaders(secret),
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    throw new Error(`NOMAD API ${res.status}: ${json?.error || json?.message || text}`)
  }
  return json
}

export { NodeConnectionTypes }
export type { IExecuteFunctions, INodeType, INodeTypeDescription, INodeExecutionData }
