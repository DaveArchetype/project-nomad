import { useQuery } from '@tanstack/react-query'
import api from '~/lib/api'
import { getServiceLink } from '~/lib/navigation'
import { SERVICE_NAMES } from '../../constants/service_names'
import { useReverseProxyBaseDomain } from './useReverseProxyBaseDomain'

export function useCalibreWebBaseUrl(): string | null {
  const reverseProxyBaseDomain = useReverseProxyBaseDomain()

  const { data: services } = useQuery({
    queryKey: ['installed-services'],
    queryFn: () => api.getSystemServices(),
    staleTime: 60_000,
  })

  const calibreService = services?.find(
    (s) => s.service_name === SERVICE_NAMES.CALIBREWEB && s.installed
  )
  if (!calibreService) return null

  const base = getServiceLink(
    calibreService.ui_location || '',
    calibreService.custom_url,
    calibreService.ui_path,
    reverseProxyBaseDomain
  )

  return base || null
}
