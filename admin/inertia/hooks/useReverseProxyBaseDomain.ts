import { useSystemSetting } from './useSystemSetting'

export function useReverseProxyBaseDomain() {
  const { data } = useSystemSetting({ key: 'ui.reverseProxyBaseDomain' })
  const value = (data?.value as string | null | undefined)?.trim().toLowerCase() ?? ''
  return value || null
}
