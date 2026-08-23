import { useQuery } from '@tanstack/react-query'
import api from '~/lib/api'
import { getServiceLink } from '~/lib/navigation'
import { SERVICE_NAMES } from '../../constants/service_names'
import { useReverseProxyBaseDomain } from './useReverseProxyBaseDomain'

export function useKiwixBaseUrl(): string | null {
  const reverseProxyBaseDomain = useReverseProxyBaseDomain()

  const { data: services } = useQuery({
    queryKey: ['installed-services'],
    queryFn: () => api.getSystemServices(),
    staleTime: 60_000,
  })

  const kiwixService = services?.find((s) => s.service_name === SERVICE_NAMES.KIWIX && s.installed)
  if (!kiwixService) return null

  const base = getServiceLink(
    kiwixService.ui_location || '',
    kiwixService.custom_url,
    kiwixService.ui_path,
    reverseProxyBaseDomain
  )

  return base || null
}
