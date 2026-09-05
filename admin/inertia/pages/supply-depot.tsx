import { Head, router } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import {
  IconAlertTriangle,
  IconArrowRight,
  IconArrowUp,
  IconBook,
  IconBox,
  IconBrandDocker,
  IconChartBar,
  IconCircleCheck,
  IconClockBolt,
  IconCloudDownload,
  IconFileText,
  IconPackage,
  IconPencil,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconWorld,
  IconX,
} from '@tabler/icons-react'
import SettingsLayout from '~/layouts/SettingsLayout'
import DynamicIcon, { DynamicIconName } from '~/components/DynamicIcon'
import StyledButton from '~/components/StyledButton'
import StyledModal from '~/components/StyledModal'
import Input from '~/components/inputs/Input'
import Select from '~/components/inputs/Select'
import Switch from '~/components/inputs/Switch'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import InstallActivityFeed from '~/components/InstallActivityFeed'
import LoadingSpinner from '~/components/LoadingSpinner'
import Alert from '~/components/Alert'
import CustomAppModal, { CustomAppInitial } from '~/components/CustomAppModal'
import AppUrlModal from '~/components/AppUrlModal'
import ServiceLogsModal from '~/components/ServiceLogsModal'
import ServiceStatsModal from '~/components/ServiceStatsModal'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import UpdateServiceModal from '~/components/UpdateServiceModal'
import useErrorNotification from '~/hooks/useErrorNotification'
import { useNotifications } from '~/context/NotificationContext'
import useInternetStatus from '~/hooks/useInternetStatus'
import { useAppAutoUpdateStatus } from '~/hooks/useAppAutoUpdateStatus'
import useServiceInstallationActivity from '~/hooks/useServiceInstallationActivity'
import { useReverseProxyBaseDomain } from '~/hooks/useReverseProxyBaseDomain'
import { useSystemSetting } from '~/hooks/useSystemSetting'
import { useTransmit } from 'react-adonis-transmit'
import { BROADCAST_CHANNELS } from '../../constants/broadcast'
import { ServiceSlim } from '../../types/services'
import { getServiceLink } from '~/lib/navigation'
import { getSupplyDepotDocLink } from '../../constants/supply_depot_docs'
import api from '~/lib/api'
import { toTitleCase } from '../../app/utils/misc'
import { SERVICE_NAMES } from '../../constants/service_names'

function extractTag(containerImage: string): string {
  if (!containerImage) return ''
  const parts = containerImage.split(':')
  return parts.length > 1 ? parts[parts.length - 1] : 'latest'
}

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'installed', label: 'Installed' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'media', label: 'Media' },
  { id: 'security', label: 'Security' },
  { id: 'networking', label: 'Networking' },
  { id: 'utility', label: 'Utility' },
  { id: 'ai', label: 'AI' },
  { id: 'education', label: 'Education' },
  { id: 'custom', label: 'Custom' },
]

const CATEGORY_COLORS: Record<string, string> = {
  productivity: 'border border-desert-green-light bg-desert-green-lighter text-desert-green-dark',
  media: 'border border-desert-tan-light bg-desert-tan-lighter text-desert-tan-dark',
  security: 'border border-desert-red-light bg-desert-red-lighter text-desert-red-dark',
  networking: 'border border-desert-stone-light bg-desert-stone-lighter text-desert-stone-dark',
  utility: 'border border-desert-olive-light bg-desert-olive-lighter text-desert-olive-dark',
  ai: 'border border-desert-green bg-desert-green-light text-desert-green-darker',
  education: 'border border-desert-orange-light bg-desert-orange-lighter text-desert-orange-dark',
  custom: 'border border-border-subtle bg-surface-secondary text-text-secondary',
}

type Modal =
  | { type: 'install'; service: ServiceSlim }
  | { type: 'start'; service: ServiceSlim }
  | { type: 'stop'; service: ServiceSlim }
  | { type: 'restart'; service: ServiceSlim }
  | { type: 'reinstall'; service: ServiceSlim }
  | { type: 'delete'; service: ServiceSlim }
  | { type: 'uninstall'; service: ServiceSlim }
  | { type: 'logs'; service: ServiceSlim }
  | { type: 'stats'; service: ServiceSlim }
  | { type: 'update'; service: ServiceSlim }
  | null

export default function SupplyDepotPage(props: { system: { services: ServiceSlim[] } }) {
  const { showError } = useErrorNotification()
  const { addNotification } = useNotifications()
  const { isOnline } = useInternetStatus()
  const { subscribe } = useTransmit()
  const installActivity = useServiceInstallationActivity()
  const reverseProxyBaseDomain = useReverseProxyBaseDomain()
  const queryClient = useQueryClient()
  const [baseDomainDraft, setBaseDomainDraft] = useState(reverseProxyBaseDomain ?? '')
  const [baseDomainError, setBaseDomainError] = useState<string | null>(null)
  useEffect(() => {
    setBaseDomainDraft(reverseProxyBaseDomain ?? '')
    setBaseDomainError(null)
  }, [reverseProxyBaseDomain])

  function validateBaseDomain(value: string): string | null {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) {
      return 'Enter a valid hostname (e.g. "nomad.lan" or "example.com").'
    }
    return null
  }

  const updateBaseDomainMutation = useMutation({
    mutationFn: async (value: string) => {
      return await api.updateSetting('ui.reverseProxyBaseDomain', value)
    },
    onSuccess: () => {
      setBaseDomainError(null)
      queryClient.invalidateQueries({ queryKey: ['system-setting', 'ui.reverseProxyBaseDomain'] })
      addNotification({ message: 'Reverse proxy base domain updated.', type: 'success' })
    },
    onError: (error: any) => {
      const msg =
        error?.response?.data?.message ||
        error?.message ||
        'Failed to update reverse proxy base domain.'
      setBaseDomainError(msg)
      addNotification({ message: msg, type: 'error' })
    },
  })

  function handleSaveBaseDomain() {
    const trimmed = baseDomainDraft.trim()
    const validationError = validateBaseDomain(trimmed)
    if (validationError) {
      setBaseDomainError(validationError)
      return
    }
    updateBaseDomainMutation.mutate(trimmed)
  }

  // Private registry credentials — used by the admin server to pull Voice Gateway / TTS images
  // from the self-hosted Gitea container registry (registry.dasaroff.com). Falls back to anonymous
  // pulls for every other curated app's public image; only these two apps need this configured.
  const { data: giteaUsernameSetting } = useSystemSetting({ key: 'registry.giteaUsername' })
  const { data: giteaPasswordSetting } = useSystemSetting({ key: 'registry.giteaPassword' })
  const [giteaUsernameDraft, setGiteaUsernameDraft] = useState('')
  const [giteaPasswordDraft, setGiteaPasswordDraft] = useState('')
  useEffect(() => {
    setGiteaUsernameDraft((giteaUsernameSetting?.value as string | null | undefined) ?? '')
  }, [giteaUsernameSetting])
  useEffect(() => {
    setGiteaPasswordDraft((giteaPasswordSetting?.value as string | null | undefined) ?? '')
  }, [giteaPasswordSetting])

  const updateGiteaCredentialsMutation = useMutation({
    mutationFn: async () => {
      await api.updateSetting('registry.giteaUsername', giteaUsernameDraft.trim())
      await api.updateSetting('registry.giteaPassword', giteaPasswordDraft)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-setting', 'registry.giteaUsername'] })
      queryClient.invalidateQueries({ queryKey: ['system-setting', 'registry.giteaPassword'] })
      addNotification({ message: 'Registry credentials updated.', type: 'success' })
    },
    onError: (error: any) => {
      showError(error?.message || 'Failed to update registry credentials.')
    },
  })

  const { data: vpnUserSetting } = useSystemSetting({ key: 'vpn.openvpnUser' })
  const { data: vpnPasswordSetting } = useSystemSetting({ key: 'vpn.openvpnPassword' })
  const { data: vpnCountriesSetting } = useSystemSetting({ key: 'vpn.countries' })
  const { data: stremioVpnEnabledSetting } = useSystemSetting({ key: 'stremio.vpnEnabled' })
  const { data: vpnCountriesData, refetch: refetchVpnCountries } = useQuery({
    queryKey: ['vpn-countries'],
    queryFn: async () => await api.getVpnCountries(),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  })
  const [vpnUserDraft, setVpnUserDraft] = useState('')
  const [vpnPasswordDraft, setVpnPasswordDraft] = useState('')
  const [vpnCountriesDraft, setVpnCountriesDraft] = useState('')
  useEffect(() => {
    setVpnUserDraft((vpnUserSetting?.value as string | null | undefined) ?? '')
  }, [vpnUserSetting])
  useEffect(() => {
    setVpnPasswordDraft((vpnPasswordSetting?.value as string | null | undefined) ?? '')
  }, [vpnPasswordSetting])
  useEffect(() => {
    setVpnCountriesDraft((vpnCountriesSetting?.value as string | null | undefined) ?? '')
  }, [vpnCountriesSetting])

  const updateVpnSettingsMutation = useMutation({
    mutationFn: async () => {
      await api.updateSetting('vpn.openvpnUser', vpnUserDraft.trim())
      await api.updateSetting('vpn.openvpnPassword', vpnPasswordDraft)
      await api.updateSetting('vpn.countries', vpnCountriesDraft.trim())
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-setting', 'vpn.openvpnUser'] })
      queryClient.invalidateQueries({ queryKey: ['system-setting', 'vpn.openvpnPassword'] })
      queryClient.invalidateQueries({ queryKey: ['system-setting', 'vpn.countries'] })
      addNotification({
        message:
          'VPN settings saved. Reinstalling VPN container — running connection test in 15s...',
        type: 'success',
      })
      setVpnTestResult(null)
      setTimeout(() => {
        testVpnMutation.mutate()
      }, 15000)
    },
    onError: (error: any) => {
      showError(error?.message || 'Failed to update VPN settings.')
    },
  })

  const stremioVpnEnabled = stremioVpnEnabledSetting?.value === true
  const toggleStremioVpnMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      await api.updateSetting('stremio.vpnEnabled', enabled)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-setting', 'stremio.vpnEnabled'] })
      addNotification({
        message: stremioVpnEnabled
          ? 'VPN disabled for Stremio. Both containers are being reinstalled — running tests in 15s...'
          : 'VPN enabled for Stremio. Both containers are being reinstalled — running tests in 15s...',
        type: 'success',
      })
      setVpnTestResult(null)
      setStremioVpnTestResult(null)
      setTimeout(() => {
        testVpnMutation.mutate()
        testStremioVpnMutation.mutate()
      }, 15000)
    },
    onError: (error: any) => {
      showError(error?.message || 'Failed to toggle VPN for Stremio.')
    },
  })

  const [vpnTestResult, setVpnTestResult] = useState<{
    connected: boolean
    checks: { label: string; passed: boolean; detail: string }[]
    publicIp?: string
    geolocation?: string
  } | null>(null)
  const [stremioVpnTestResult, setStremioVpnTestResult] = useState<{
    routed: boolean
    checks: { label: string; passed: boolean; detail: string }[]
  } | null>(null)

  const testVpnMutation = useMutation({
    mutationFn: async () => await api.testVpn(),
    onSuccess: (data) => {
      setVpnTestResult(data)
      if (data.connected) {
        refetchVpnCountries()
      }
    },
    onError: (error: any) => {
      showError(error?.message || 'Failed to test VPN connection.')
    },
  })

  const testStremioVpnMutation = useMutation({
    mutationFn: async () => await api.testStremioVpn(),
    onSuccess: (data) => {
      setStremioVpnTestResult(data)
    },
    onError: (error: any) => {
      showError(error?.message || 'Failed to test Stremio VPN routing.')
    },
  })

  // Global master switch for app auto-updates (Settings → Updates). Per-app
  // toggles are inert until this is on, so the UI reflects that state.
  const { data: appAutoUpdateStatus } = useAppAutoUpdateStatus()
  const appAutoUpdateMasterEnabled = appAutoUpdateStatus?.enabled ?? false

  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<Modal>(null)
  const [loading, setLoading] = useState(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [customAppOpen, setCustomAppOpen] = useState(false)
  const [editApp, setEditApp] = useState<CustomAppInitial | null>(null)
  // App whose custom launch URL is being configured (null while the modal is closed).
  const [urlApp, setUrlApp] = useState<ServiceSlim | null>(null)
  const [removeImage, setRemoveImage] = useState(false)
  // Optimistic per-app auto-update toggle state, keyed by service_name. Lets the
  // toggle reflect instantly without a full page reload (props come from Inertia).
  const [autoUpdateOverrides, setAutoUpdateOverrides] = useState<Record<string, boolean>>({})
  // Service names whose install we just dispatched from this client. Lets the card
  // jump into the "Download in progress" section immediately, before the durable
  // installation_status==='installing' flag (set server-side) shows up via a reload.
  const [dispatchedInstalls, setDispatchedInstalls] = useState<Set<string>>(new Set())

  // Preflight state — scoped to the current install modal
  const [preflight, setPreflight] = useState<{
    portConflicts: Array<{ port: number; usedBy: string }>
    resourceWarnings: string[]
  } | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [forceInstall, setForceInstall] = useState(false)

  const dropdownRef = useRef<HTMLDivElement>(null)

  // Auto-reload when installation completes
  useEffect(() => {
    if (!installActivity.length) return
    if (installActivity.some((a) => a.type === 'completed' || a.type === 'update-complete')) {
      setTimeout(() => window.location.reload(), 3000)
      return
    }
    // If an install/update failed, drop the optimistic dispatched flag so the card
    // returns to "Available" and the Install button can be tried again.
    const failed = installActivity.filter(
      (a) => a.type === 'error' || a.type === 'preinstall-error' || a.type === 'update-rollback'
    )
    if (failed.length) {
      setDispatchedInstalls((prev) => {
        const next = new Set(prev)
        for (const a of failed) next.delete(a.service_name)
        return next
      })
    }
  }, [installActivity])

  // Listen for service update-check completion (manual or nightly), then reload so
  // refreshed available_update_version values surface on the cards.
  useEffect(() => {
    const unsubscribe = subscribe(BROADCAST_CHANNELS.SERVICE_UPDATES, () => {
      setCheckingUpdates(false)
      window.location.reload()
    })
    return () => {
      unsubscribe()
    }
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Run preflight when install modal opens
  useEffect(() => {
    if (modal?.type !== 'install') {
      setPreflight(null)
      setForceInstall(false)
      return
    }
    setPreflightLoading(true)
    api
      .preflightCheck(modal.service.service_name)
      .then((res) => {
        if (res) setPreflight(res)
      })
      .catch(() => {}) // non-fatal; proceed without warnings
      .finally(() => setPreflightLoading(false))
  }, [modal])

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filteredServices = props.system.services.filter((s) => {
    if (activeCategory === 'installed' && !s.installed) return false
    if (activeCategory !== 'all' && activeCategory !== 'installed') {
      if (s.category !== activeCategory) return false
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      return (
        s.friendly_name?.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.powered_by?.toLowerCase().includes(q) ||
        s.category?.toLowerCase().includes(q)
      )
    }
    return true
  })

  const installedServices = filteredServices.filter((s) => s.installed)
  // Services currently downloading/installing. Combines the durable DB flag
  // (installation_status==='installing', surfaced via props after a reload) with
  // the optimistic client-side dispatchedInstalls set (covers the window before a
  // reload reflects the server-side flag).
  const installingServiceNames = new Set<string>(dispatchedInstalls)
  for (const s of props.system.services) {
    if (!s.installed && s.installation_status === 'installing') {
      installingServiceNames.add(s.service_name)
    }
  }
  const installingServices = filteredServices.filter(
    (s) => !s.installed && installingServiceNames.has(s.service_name)
  )
  const availableServices = filteredServices.filter(
    (s) => !s.installed && !installingServiceNames.has(s.service_name)
  )

  // Whether the new Kolibri (Gen 2) install exists — gates the "Migrate content to Gen 2" action on
  // the legacy Kolibri card. Computed from the full (unfiltered) list so a search filter can't hide it.
  const educationGen2Installed = props.system.services.some(
    (s) => s.service_name === SERVICE_NAMES.KOLIBRI_GEN2 && s.installed
  )

  // ── Actions ───────────────────────────────────────────────────────────────
  async function handleInstall(service: ServiceSlim) {
    const hasWarnings =
      (preflight?.portConflicts.length ?? 0) > 0 || (preflight?.resourceWarnings.length ?? 0) > 0

    if (hasWarnings && !forceInstall) return

    // Keep the modal open with a spinning confirm button while the request is in
    // flight; close it once the install job is dispatched. Progress then streams
    // via the InstallActivityFeed broadcast, so we drop the loading flag here.
    setLoading(true)
    const result = await api.installService(service.service_name)
    setModal(null)
    setLoading(false)
    if (!result?.success) {
      showError(result?.message || 'Failed to start installation.')
      return
    }
    // Mark as dispatched so the card moves into "Download in progress" immediately;
    // the durable installation_status flag takes over once a reload refreshes props.
    setDispatchedInstalls((prev) => {
      const next = new Set(prev)
      next.add(service.service_name)
      return next
    })
  }

  async function handleAffect(service: ServiceSlim, action: 'start' | 'stop' | 'restart') {
    setLoading(true)
    const result = await api.affectService(service.service_name, action)
    setModal(null)
    if (!result?.success) {
      setLoading(false)
      showError(result?.message || `Failed to ${action} service.`)
    } else {
      // Keep loading=true so the overlay covers the page until it reloads.
      setTimeout(() => window.location.reload(), 1500)
    }
  }

  async function handleForceReinstall(service: ServiceSlim) {
    setLoading(true)
    const result = await api.forceReinstallService(service.service_name)
    setModal(null)
    setLoading(false)
    if (!result?.success) showError(result?.message || 'Failed to start reinstall.')
  }

  async function handleDelete(service: ServiceSlim) {
    setLoading(true)
    const result = await api.deleteCustomApp(service.service_name, removeImage)
    setRemoveImage(false)
    setModal(null)
    if (!result?.success) {
      setLoading(false)
      showError(result?.message || 'Failed to delete app.')
    } else {
      setTimeout(() => window.location.reload(), 1000)
    }
  }

  async function handleUninstall(service: ServiceSlim) {
    setLoading(true)
    const result = await api.uninstallService(service.service_name, removeImage)
    setRemoveImage(false)
    setModal(null)
    if (!result?.success) {
      setLoading(false)
      showError(result?.message || 'Failed to uninstall app.')
    } else {
      setTimeout(() => window.location.reload(), 1000)
    }
  }

  async function handleUpdate(service: ServiceSlim) {
    setOpenDropdown(null)
    setLoading(true)
    const result = await api.updateCustomAppImage(service.service_name)
    setLoading(false)
    if (!result?.success) showError(result?.message || 'Failed to update app.')
    else setTimeout(() => window.location.reload(), 1500)
  }

  // Manual trigger for the catalog-wide update check. Results stream back over the
  // SERVICE_UPDATES broadcast (handled by the effect above), which reloads the page.
  async function handleCheckUpdates() {
    if (!isOnline) {
      showError('You must have an internet connection to check for updates.')
      return
    }
    try {
      setCheckingUpdates(true)
      const response = await api.checkServiceUpdates()
      if (!response?.success)
        throw new Error(response?.message || 'Failed to dispatch update check')
    } catch (error: any) {
      showError(`Failed to check for updates: ${error?.message || 'Unknown error'}`)
      setCheckingUpdates(false)
    }
  }

  // Versioned update for a curated (non-custom) catalog app. Progress + reload are handled
  // by the installActivity effect (update-complete) above.
  async function handleUpdateService(service: ServiceSlim, targetVersion: string) {
    setLoading(true)
    const result = await api.updateService(service.service_name, targetVersion)
    setLoading(false)
    if (!result?.success) showError(result?.message || 'Failed to update service.')
  }

  // Toggle per-app automatic updates (opt-in). Optimistically reflects the new
  // state, reverting if the request fails. Gated by the global master switch in
  // Settings → Updates; this only sets the per-app preference.
  async function handleToggleAutoUpdate(service: ServiceSlim, enabled: boolean) {
    setOpenDropdown(null)
    setAutoUpdateOverrides((prev) => ({ ...prev, [service.service_name]: enabled }))
    const result = await api.setServiceAutoUpdate(service.service_name, enabled)
    if (!result?.success) {
      setAutoUpdateOverrides((prev) => ({ ...prev, [service.service_name]: !enabled }))
      showError(result?.message || 'Failed to update auto-update preference.')
      return
    }
    const appName = service.friendly_name || service.service_name
    addNotification({
      message: `Auto-updates for ${appName} are ${enabled ? 'on' : 'off'}.`,
      type: 'success',
    })
  }

  function handleCustomAppCreated() {
    setCustomAppOpen(false)
    // Page will reload when installation completes via broadcast
  }

  async function handleEdit(service: ServiceSlim) {
    setOpenDropdown(null)
    setLoading(true)
    const res = await api.getCustomApp(service.service_name)
    setLoading(false)
    if (res?.success && res.app) {
      setEditApp(res.app)
    } else {
      showError('Could not load this app for editing.')
    }
  }

  function handleEdited() {
    setEditApp(null)
    setTimeout(() => window.location.reload(), 1500)
  }

  function handleSetUrl(service: ServiceSlim) {
    setOpenDropdown(null)
    setUrlApp(service)
  }

  function handleUrlSaved() {
    setUrlApp(null)
    // Reload so the new link flows through to the card, /home, and settings.
    window.location.reload()
  }

  // ── Install modal helpers ─────────────────────────────────────────────────
  const hasPreflightWarnings =
    (preflight?.portConflicts.length ?? 0) > 0 || (preflight?.resourceWarnings.length ?? 0) > 0

  return (
    <SettingsLayout>
      <Head title="Supply Depot" />

      {loading && !modal && <LoadingSpinner fullscreen text="Working..." />}

      <div className="xl:pl-72 w-full">
        <main className="px-12 py-6">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {!isOnline && (
              <Alert
                title="No internet connection. You may not be able to download files."
                message=""
                type="warning"
                variant="solid"
                className="!mb-4"
              />
            )}

            {/* ── Hero / controls panel ─────────────────────────────────────────── */}
            <div className="rounded-lg overflow-hidden bg-desert-white border border-desert-stone-light shadow-sm mb-8">
              {/* Green header band */}
              <div className="relative bg-desert-green px-6 py-5 overflow-hidden">
                {/* Diagonal line pattern */}
                <div
                  className="absolute inset-0 opacity-10"
                  style={{
                    backgroundImage: `repeating-linear-gradient(
                  45deg,
                  transparent,
                  transparent 10px,
                  rgba(255, 255, 255, 0.1) 10px,
                  rgba(255, 255, 255, 0.1) 20px
                )`,
                  }}
                />
                <div className="absolute top-0 right-0 w-24 h-24 transform translate-x-8 -translate-y-8">
                  <div className="w-full h-full bg-desert-green-dark opacity-30 transform rotate-45" />
                </div>
                <div className="relative flex items-center gap-3">
                  <IconBox className="text-white opacity-90 flex-shrink-0" size={28} />
                  <div>
                    <h1 className="text-2xl font-bold text-white uppercase tracking-wide leading-tight">
                      Supply Depot
                    </h1>
                    <p className="text-sm text-white/70 mt-1 max-w-xl">
                      Browse and install curated apps, or add your own custom apps by providing a
                      Docker image.
                    </p>
                  </div>
                </div>
              </div>

              {/* Controls body */}
              <div className="p-6 space-y-4">
                {/* Activity feed (shown only while installing) */}
                {installActivity.length > 0 && (
                  <InstallActivityFeed activity={installActivity} withHeader />
                )}

                {/* Search + Add Custom App */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted h-4 w-4" />
                    <input
                      type="text"
                      placeholder="Search apps..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 rounded-md bg-surface-secondary border border-desert-stone-lighter text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-desert-green placeholder:text-text-muted/50"
                    />
                  </div>
                  <StyledButton
                    icon="IconRefreshAlert"
                    variant="outline"
                    onClick={handleCheckUpdates}
                    loading={checkingUpdates}
                    disabled={checkingUpdates || !isOnline}
                  >
                    Check for Updates
                  </StyledButton>
                  <StyledButton
                    icon="IconBrandDocker"
                    variant="outline"
                    onClick={() => setCustomAppOpen(true)}
                  >
                    Add Custom App
                  </StyledButton>
                </div>

                {/* Category filters */}
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer border ${
                        activeCategory === cat.id
                          ? 'bg-desert-green text-white border-desert-green'
                          : 'bg-surface-secondary text-text-muted border-desert-stone-lighter hover:text-text-primary hover:border-desert-stone-light'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bottom accent bar */}
              <div className="h-1 bg-desert-green" />
            </div>

            {/* App cards */}
            {filteredServices.length === 0 ? (
              <div className="text-center py-16">
                <IconPackage
                  className="mx-auto mb-3 opacity-40 text-desert-stone-light"
                  size={48}
                />
                <p className="text-text-muted">No apps match your filter.</p>
              </div>
            ) : (
              <div className="space-y-10">
                <section>
                  <StyledSectionHeader title="Reverse Proxy" className="mb-4" />
                  <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-6">
                    <p className="text-sm text-text-secondary mb-4">
                      When NOMAD sits behind a reverse proxy that routes one subdomain per service
                      (e.g. <span className="font-mono">kiwix.nomad.lan</span> → port 8090), set the
                      base domain here. Each app's "Open" link will then resolve to
                      <span className="font-mono">
                        {' '}
                        https://&lt;app&gt;.&lt;base-domain&gt;
                      </span>{' '}
                      instead of the raw host:port. Leave blank to use the default host + port
                      links. A per-app custom URL still overrides this.
                    </p>
                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <Input
                          name="reverseProxyBaseDomain"
                          label="Reverse Proxy Base Domain"
                          helpText="e.g. nomad.lan or dasaroff.com. Wildcard DNS (*.base-domain) must point at the proxy host."
                          placeholder="dasaroff.com"
                          value={baseDomainDraft}
                          error={Boolean(baseDomainError)}
                          onChange={(e) => {
                            setBaseDomainDraft(e.target.value)
                            setBaseDomainError(null)
                          }}
                        />
                        {baseDomainError && (
                          <p className="text-sm text-red-600 mt-1">{baseDomainError}</p>
                        )}
                      </div>
                      <StyledButton
                        variant="primary"
                        onClick={handleSaveBaseDomain}
                        loading={updateBaseDomainMutation.isPending}
                        disabled={updateBaseDomainMutation.isPending}
                        className="mb-0.5"
                      >
                        Save
                      </StyledButton>
                    </div>
                  </div>
                </section>

                <section>
                  <StyledSectionHeader title="Private Registry Credentials" className="mb-4" />
                  <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-6">
                    <p className="text-sm text-text-secondary mb-4">
                      Voice Gateway and Text-to-Speech are pulled from a private container registry.
                      Set the credentials below before installing or updating either app — every
                      other app in the catalog is public and doesn't need this.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                      <Input
                        name="giteaUsername"
                        label="Registry Username"
                        placeholder="DaveArchetype"
                        value={giteaUsernameDraft}
                        onChange={(e) => setGiteaUsernameDraft(e.target.value)}
                      />
                      <Input
                        name="giteaPassword"
                        type="password"
                        label="Registry Password"
                        placeholder="Access token or password"
                        value={giteaPasswordDraft}
                        onChange={(e) => setGiteaPasswordDraft(e.target.value)}
                      />
                    </div>
                    <div className="flex justify-end mt-3">
                      <StyledButton
                        variant="primary"
                        onClick={() => updateGiteaCredentialsMutation.mutate()}
                        loading={updateGiteaCredentialsMutation.isPending}
                        disabled={updateGiteaCredentialsMutation.isPending}
                      >
                        Save
                      </StyledButton>
                    </div>
                  </div>
                </section>

                <section>
                  <StyledSectionHeader title="VPN Settings" className="mb-4" />
                  <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-6">
                    <p className="text-sm text-text-secondary mb-4">
                      Install the VPN Gateway from the catalog above, then set your Surfshark
                      service credentials below (found at my.surfshark.com &gt; VPN &gt; Manual
                      setup &gt; Router). Enable the toggle to route Stremio through the VPN.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                      <Input
                        name="vpnUser"
                        label="Surfshark Username"
                        placeholder="Service username"
                        value={vpnUserDraft}
                        onChange={(e) => setVpnUserDraft(e.target.value)}
                      />
                      <Input
                        name="vpnPassword"
                        type="password"
                        label="Surfshark Password"
                        placeholder="Service password"
                        value={vpnPasswordDraft}
                        onChange={(e) => setVpnPasswordDraft(e.target.value)}
                      />
                    </div>
                    <div className="mt-3">
                      <Select
                        name="vpnCountries"
                        label="Server Country"
                        placeholder="Select a country"
                        helpText={
                          vpnCountriesData?.countries?.length
                            ? undefined
                            : 'Install the VPN first to populate the list, or type manually.'
                        }
                        value={vpnCountriesDraft}
                        onChange={(val) => setVpnCountriesDraft(val)}
                        options={[
                          { value: '', label: 'Default (Netherlands)' },
                          ...(vpnCountriesData?.countries ?? []).map((c: string) => ({
                            value: c,
                            label: c,
                          })),
                        ]}
                      />
                      {!vpnCountriesData?.countries?.length && (
                        <Input
                          name="vpnCountriesManual"
                          label="Server Country (manual)"
                          placeholder="Type a country name"
                          value={vpnCountriesDraft}
                          onChange={(e) => setVpnCountriesDraft(e.target.value)}
                          className="mt-2"
                        />
                      )}
                    </div>
                    <div className="flex justify-end mt-3">
                      <StyledButton
                        variant="primary"
                        onClick={() => updateVpnSettingsMutation.mutate()}
                        loading={updateVpnSettingsMutation.isPending}
                        disabled={updateVpnSettingsMutation.isPending}
                      >
                        Save
                      </StyledButton>
                    </div>
                    <div className="mt-4 pt-4 border-t border-border-subtle">
                      <Switch
                        checked={stremioVpnEnabled}
                        onChange={(checked) => toggleStremioVpnMutation.mutate(checked)}
                        label="Route Stremio through VPN"
                        description="When enabled, Stremio shares the VPN's network namespace. All traffic (streams, torrents, scrapers) goes through the encrypted tunnel. Both containers are reinstalled automatically when toggled."
                      />
                    </div>
                    <div className="mt-4 pt-4 border-t border-border-subtle">
                      <div className="flex items-center gap-3 flex-wrap">
                        <StyledButton
                          variant="secondary"
                          onClick={() => testVpnMutation.mutate()}
                          loading={testVpnMutation.isPending}
                          disabled={testVpnMutation.isPending}
                        >
                          Test VPN Connection
                        </StyledButton>
                        <StyledButton
                          variant="secondary"
                          onClick={() => testStremioVpnMutation.mutate()}
                          loading={testStremioVpnMutation.isPending}
                          disabled={testStremioVpnMutation.isPending}
                        >
                          Test Stremio VPN Routing
                        </StyledButton>
                      </div>
                      {vpnTestResult && (
                        <div className="mt-3 rounded-lg border border-border-subtle p-4">
                          <div className="flex items-center gap-2 mb-2">
                            {vpnTestResult.connected ? (
                              <IconCircleCheck className="w-5 h-5 text-green-500" />
                            ) : (
                              <IconAlertTriangle className="w-5 h-5 text-yellow-500" />
                            )}
                            <span className="font-medium text-text-primary">
                              VPN Connection:{' '}
                              {vpnTestResult.connected ? 'Connected' : 'Issues detected'}
                            </span>
                            {vpnTestResult.publicIp && (
                              <span className="text-sm text-text-muted ml-2">
                                IP: {vpnTestResult.publicIp}
                                {vpnTestResult.geolocation ? ` (${vpnTestResult.geolocation})` : ''}
                              </span>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            {vpnTestResult.checks.map((check, i) => (
                              <div key={i} className="flex items-start gap-2 text-sm">
                                {check.passed ? (
                                  <IconCircleCheck className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                                ) : (
                                  <IconX className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                                )}
                                <div>
                                  <span className="text-text-primary font-medium">
                                    {check.label}
                                  </span>
                                  <span className="text-text-muted ml-2">{check.detail}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {stremioVpnTestResult && (
                        <div className="mt-3 rounded-lg border border-border-subtle p-4">
                          <div className="flex items-center gap-2 mb-2">
                            {stremioVpnTestResult.routed ? (
                              <IconCircleCheck className="w-5 h-5 text-green-500" />
                            ) : (
                              <IconAlertTriangle className="w-5 h-5 text-yellow-500" />
                            )}
                            <span className="font-medium text-text-primary">
                              Stremio VPN Routing:{' '}
                              {stremioVpnTestResult.routed ? 'Working' : 'Issues detected'}
                            </span>
                          </div>
                          <div className="space-y-1.5">
                            {stremioVpnTestResult.checks.map((check, i) => (
                              <div key={i} className="flex items-start gap-2 text-sm">
                                {check.passed ? (
                                  <IconCircleCheck className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                                ) : (
                                  <IconX className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                                )}
                                <div>
                                  <span className="text-text-primary font-medium">
                                    {check.label}
                                  </span>
                                  <span className="text-text-muted ml-2">{check.detail}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {installedServices.length > 0 && (
                  <section>
                    <StyledSectionHeader title={`Installed (${installedServices.length})`} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {installedServices.map((service) => (
                        <AppCard
                          key={service.service_name}
                          service={service}
                          openDropdown={openDropdown}
                          dropdownRef={dropdownRef}
                          onOpenDropdown={setOpenDropdown}
                          onInstall={() => setModal({ type: 'install', service })}
                          onStart={() => setModal({ type: 'start', service })}
                          onStop={() => setModal({ type: 'stop', service })}
                          onRestart={() => setModal({ type: 'restart', service })}
                          onReinstall={() => setModal({ type: 'reinstall', service })}
                          onDelete={() => setModal({ type: 'delete', service })}
                          onUninstall={() => setModal({ type: 'uninstall', service })}
                          onLogs={() => setModal({ type: 'logs', service })}
                          onStats={() => setModal({ type: 'stats', service })}
                          onEdit={() => handleEdit(service)}
                          onSetUrl={() => handleSetUrl(service)}
                          onUpdate={() => handleUpdate(service)}
                          onUpdateVersion={() => setModal({ type: 'update', service })}
                          autoUpdateEnabled={
                            autoUpdateOverrides[service.service_name] ?? service.auto_update_enabled
                          }
                          autoUpdateMasterEnabled={appAutoUpdateMasterEnabled}
                          onToggleAutoUpdate={(enabled) => handleToggleAutoUpdate(service, enabled)}
                          migrationInstructionsHref={
                            service.service_name.startsWith(SERVICE_NAMES.KOLIBRI) &&
                            educationGen2Installed
                              ? getSupplyDepotDocLink(SERVICE_NAMES.KOLIBRI) || undefined
                              : undefined
                          }
                          migrationInstructionsText={
                            service.service_name === SERVICE_NAMES.KOLIBRI
                              ? 'How to migrate content to Gen 2'
                              : 'How to migrate content from Gen 1'
                          }
                          reverseProxyBaseDomain={reverseProxyBaseDomain}
                          installing={installingServiceNames.has(service.service_name)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {installingServices.length > 0 && (
                  <section>
                    <StyledSectionHeader
                      title={`Download in progress (${installingServices.length})`}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {installingServices.map((service) => (
                        <AppCard
                          key={service.service_name}
                          service={service}
                          openDropdown={openDropdown}
                          dropdownRef={dropdownRef}
                          onOpenDropdown={setOpenDropdown}
                          onInstall={() => setModal({ type: 'install', service })}
                          onStart={() => setModal({ type: 'start', service })}
                          onStop={() => setModal({ type: 'stop', service })}
                          onRestart={() => setModal({ type: 'restart', service })}
                          onReinstall={() => setModal({ type: 'reinstall', service })}
                          onDelete={() => setModal({ type: 'delete', service })}
                          onUninstall={() => setModal({ type: 'uninstall', service })}
                          onLogs={() => setModal({ type: 'logs', service })}
                          onStats={() => setModal({ type: 'stats', service })}
                          onEdit={() => handleEdit(service)}
                          onSetUrl={() => handleSetUrl(service)}
                          onUpdate={() => handleUpdate(service)}
                          onUpdateVersion={() => setModal({ type: 'update', service })}
                          reverseProxyBaseDomain={reverseProxyBaseDomain}
                          installing
                        />
                      ))}
                    </div>
                  </section>
                )}

                {availableServices.length > 0 && (
                  <section>
                    <StyledSectionHeader title={`Available (${availableServices.length})`} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {availableServices.map((service) => (
                        <AppCard
                          key={service.service_name}
                          service={service}
                          openDropdown={openDropdown}
                          dropdownRef={dropdownRef}
                          onOpenDropdown={setOpenDropdown}
                          onInstall={() => setModal({ type: 'install', service })}
                          onStart={() => setModal({ type: 'start', service })}
                          onStop={() => setModal({ type: 'stop', service })}
                          onRestart={() => setModal({ type: 'restart', service })}
                          onReinstall={() => setModal({ type: 'reinstall', service })}
                          onDelete={() => setModal({ type: 'delete', service })}
                          onUninstall={() => setModal({ type: 'uninstall', service })}
                          onLogs={() => setModal({ type: 'logs', service })}
                          onStats={() => setModal({ type: 'stats', service })}
                          onEdit={() => handleEdit(service)}
                          onSetUrl={() => handleSetUrl(service)}
                          onUpdate={() => handleUpdate(service)}
                          onUpdateVersion={() => setModal({ type: 'update', service })}
                          reverseProxyBaseDomain={reverseProxyBaseDomain}
                          installing={installingServiceNames.has(service.service_name)}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {/* Install modal */}
      {modal?.type === 'install' && (
        <StyledModal
          title={`Install ${modal.service.friendly_name ?? modal.service.service_name}`}
          open
          onCancel={() => {
            if (loading) return
            setModal(null)
          }}
          onConfirm={() => handleInstall(modal.service)}
          confirmText="Install"
          confirmIcon="IconDownload"
          confirmVariant="primary"
          confirmLoading={loading}
        >
          <div className="space-y-3 text-sm text-text-muted">
            <p>
              This will download and start{' '}
              <strong className="text-text-primary">{modal.service.friendly_name}</strong>
              {modal.service.ui_location && (
                <>
                  {' '}
                  on port <strong className="text-text-primary">{modal.service.ui_location}</strong>
                </>
              )}
              .
            </p>
            {modal.service.powered_by && (
              <p className="text-xs">Powered by {modal.service.powered_by}</p>
            )}

            {preflightLoading && (
              <div className="flex items-center gap-2 text-xs text-text-muted py-2">
                <span className="animate-spin inline-block w-3 h-3 border border-desert-green border-t-transparent rounded-full" />
                Checking for conflicts…
              </div>
            )}

            {!preflightLoading && preflight && hasPreflightWarnings && (
              <div className="space-y-2 pt-1">
                {preflight.portConflicts.map((c) => (
                  <Alert
                    key={c.port}
                    type="warning"
                    title={`Port ${c.port} already in use`}
                    message={`Currently bound by: ${c.usedBy}. Installation may fail.`}
                  />
                ))}
                {preflight.resourceWarnings.map((w, i) => (
                  <Alert key={i} type="warning" title="Resource warning" message={w} />
                ))}
                <label className="flex items-center gap-2 cursor-pointer select-none mt-2">
                  <input
                    type="checkbox"
                    checked={forceInstall}
                    onChange={(e) => setForceInstall(e.target.checked)}
                    className="accent-desert-orange h-4 w-4 rounded"
                  />
                  <span className="text-xs text-text-muted">I understand — install anyway</span>
                </label>
              </div>
            )}
          </div>
        </StyledModal>
      )}

      {/* Start modal */}
      {modal?.type === 'start' && (
        <StyledModal
          title={`Start ${modal.service.friendly_name ?? modal.service.service_name}`}
          open
          onCancel={() => {
            if (loading) return
            setModal(null)
          }}
          onConfirm={() => handleAffect(modal.service, 'start')}
          confirmText="Start"
          confirmIcon="IconPlayerPlay"
          confirmVariant="primary"
          confirmLoading={loading}
        >
          <p className="text-sm text-text-muted">This will start the container.</p>
        </StyledModal>
      )}

      {/* Stop modal */}
      {modal?.type === 'stop' && (
        <StyledModal
          title={`Stop ${modal.service.friendly_name ?? modal.service.service_name}`}
          open
          onCancel={() => {
            if (loading) return
            setModal(null)
          }}
          onConfirm={() => handleAffect(modal.service, 'stop')}
          confirmText="Stop"
          confirmIcon="IconPlayerStop"
          confirmVariant="action"
          confirmLoading={loading}
        >
          <p className="text-sm text-text-muted">
            The container will be stopped. Your data is preserved.
          </p>
        </StyledModal>
      )}

      {/* Restart modal */}
      {modal?.type === 'restart' && (
        <StyledModal
          title={`Restart ${modal.service.friendly_name ?? modal.service.service_name}`}
          open
          onCancel={() => {
            if (loading) return
            setModal(null)
          }}
          onConfirm={() => handleAffect(modal.service, 'restart')}
          confirmText="Restart"
          confirmIcon="IconRefresh"
          confirmVariant="action"
          confirmLoading={loading}
        >
          <p className="text-sm text-text-muted">
            The container will be briefly stopped and restarted.
          </p>
        </StyledModal>
      )}

      {/* Force reinstall modal */}
      {modal?.type === 'reinstall' && (
        <StyledModal
          title={`Force Reinstall ${modal.service.friendly_name ?? modal.service.service_name}`}
          open
          onCancel={() => {
            if (loading) return
            setModal(null)
          }}
          onConfirm={() => handleForceReinstall(modal.service)}
          confirmText="Wipe & Reinstall"
          confirmIcon="IconRefresh"
          confirmVariant="danger"
          confirmLoading={loading}
          icon={<IconAlertTriangle className="text-desert-red" size={40} />}
        >
          <div className="space-y-2 text-sm text-text-muted">
            <p className="font-semibold text-desert-red">
              This will delete all app data and cannot be undone.
            </p>
            <p>
              The container and its associated volumes will be removed, then a fresh installation
              will begin.
            </p>
          </div>
        </StyledModal>
      )}

      {/* Delete custom app modal */}
      {modal?.type === 'delete' && (
        <StyledModal
          title={`Delete ${modal.service.friendly_name ?? modal.service.service_name}`}
          open
          onCancel={() => {
            if (loading) return
            setRemoveImage(false)
            setModal(null)
          }}
          onConfirm={() => handleDelete(modal.service)}
          confirmText="Delete"
          confirmIcon="IconTrash"
          confirmVariant="danger"
          confirmLoading={loading}
          icon={<IconAlertTriangle className="text-desert-red" size={40} />}
        >
          <div className="space-y-3 text-sm text-text-muted">
            <p className="font-semibold text-desert-red">
              This will permanently remove this custom app.
            </p>
            <p>The container will be stopped and removed. Host volume data will remain on disk.</p>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={removeImage}
                onChange={(e) => setRemoveImage(e.target.checked)}
                className="accent-desert-red h-4 w-4 rounded"
              />
              <span className="text-text-muted text-xs">
                Also remove the Docker image to reclaim disk space
              </span>
            </label>
          </div>
        </StyledModal>
      )}

      {/* Uninstall curated app modal */}
      {modal?.type === 'uninstall' && (
        <StyledModal
          title={`Uninstall ${modal.service.friendly_name ?? modal.service.service_name}`}
          open
          onCancel={() => {
            if (loading) return
            setRemoveImage(false)
            setModal(null)
          }}
          onConfirm={() => handleUninstall(modal.service)}
          confirmText="Uninstall"
          confirmIcon="IconTrash"
          confirmVariant="danger"
          confirmLoading={loading}
          icon={<IconAlertTriangle className="text-desert-red" size={40} />}
        >
          <div className="space-y-3 text-sm text-text-muted">
            <p className="font-semibold text-desert-red">
              This will remove the app from this device.
            </p>
            <p>
              The container will be stopped and removed, and the app returns to the catalog below.
              App data under the storage folder stays on disk, so reinstalling brings it back as it
              was.
            </p>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={removeImage}
                onChange={(e) => setRemoveImage(e.target.checked)}
                className="accent-desert-red h-4 w-4 rounded"
              />
              <span className="text-text-muted text-xs">
                Also remove the Docker image to reclaim disk space
              </span>
            </label>
          </div>
        </StyledModal>
      )}

      {/* Logs modal */}
      {modal?.type === 'logs' && (
        <ServiceLogsModal
          serviceName={modal.service.service_name}
          friendlyName={modal.service.friendly_name ?? modal.service.service_name}
          open
          onClose={() => setModal(null)}
        />
      )}

      {/* Stats modal */}
      {modal?.type === 'stats' && (
        <ServiceStatsModal
          serviceName={modal.service.service_name}
          friendlyName={modal.service.friendly_name ?? modal.service.service_name}
          open
          onClose={() => setModal(null)}
        />
      )}

      {/* Versioned update modal (curated apps with an available update) */}
      {modal?.type === 'update' && (
        <UpdateServiceModal
          record={modal.service}
          currentTag={extractTag(modal.service.container_image)}
          latestVersion={modal.service.available_update_version!}
          onCancel={() => {
            if (loading) return
            setModal(null)
          }}
          onUpdate={(targetVersion) => {
            const service = modal.service
            setModal(null)
            handleUpdateService(service, targetVersion)
          }}
          showError={showError}
        />
      )}

      {/* Custom app creation modal */}
      <CustomAppModal
        open={customAppOpen}
        onClose={() => setCustomAppOpen(false)}
        onCreated={handleCustomAppCreated}
        showError={showError}
      />

      {/* Custom app edit modal */}
      <CustomAppModal
        open={!!editApp}
        mode="edit"
        initial={editApp}
        onClose={() => setEditApp(null)}
        onCreated={handleEdited}
        showError={showError}
      />

      {/* Custom launch URL modal */}
      <AppUrlModal
        open={!!urlApp}
        service={urlApp}
        onClose={() => setUrlApp(null)}
        onSaved={handleUrlSaved}
        showError={showError}
      />
    </SettingsLayout>
  )
}

// ── App Card component ────────────────────────────────────────────────────────

interface AppCardProps {
  service: ServiceSlim
  openDropdown: string | null
  dropdownRef: React.RefObject<HTMLDivElement | null>
  onOpenDropdown: (name: string | null) => void
  onInstall: () => void
  onStart: () => void
  onStop: () => void
  onRestart: () => void
  onReinstall: () => void
  onDelete: () => void
  onUninstall: () => void
  onLogs: () => void
  onStats: () => void
  onEdit: () => void
  onSetUrl: () => void
  onUpdate: () => void
  onUpdateVersion: () => void
  // Installed-only: per-app auto-update preference + toggle handler.
  autoUpdateEnabled?: boolean
  // Global master switch (Settings → Updates). When off, per-app toggles are inert.
  autoUpdateMasterEnabled?: boolean
  onToggleAutoUpdate?: (enabled: boolean) => void
  migrationInstructionsHref?: string
  migrationInstructionsText?: string
  reverseProxyBaseDomain?: string | null
  // True while this app's image is being pulled/started. Hides the Install button
  // and shows the "Installing" badge + "In progress…" indicator. Set optimistically
  // on the client (dispatchedInstalls) and durably via installation_status==='installing'.
  installing?: boolean
}

function AppCard({
  service,
  openDropdown,
  dropdownRef,
  onOpenDropdown,
  onInstall,
  onStart,
  onStop,
  onRestart,
  onReinstall,
  onDelete,
  onUninstall,
  onLogs,
  onStats,
  onEdit,
  onSetUrl,
  onUpdate,
  onUpdateVersion,
  autoUpdateEnabled,
  autoUpdateMasterEnabled,
  onToggleAutoUpdate,
  migrationInstructionsHref,
  migrationInstructionsText,
  reverseProxyBaseDomain,
  installing = false,
}: AppCardProps) {
  const isRunning = service.status === 'running'
  const isStopped = service.installed && !isRunning
  const isInstalling = service.installation_status === 'installing' || installing
  const catColor = service.category
    ? (CATEGORY_COLORS[service.category] ?? CATEGORY_COLORS.custom)
    : CATEGORY_COLORS.custom
  const isDropdownOpen = openDropdown === service.service_name
  // Port pill: an ui_location may carry an explicit scheme ("https:8480") — show just the port,
  // with a lock when it's served over HTTPS, rather than the raw "https:8480" string.
  const uiIsPath = !!service.ui_location && service.ui_location.startsWith('/')
  const uiIsHttps = /^https:/.test(service.ui_location || '')
  const uiPort =
    service.ui_location && !uiIsPath ? service.ui_location.replace(/^https?:/, '') : null
  // Per-app documentation link (in-app docs page, anchored to this app's section). Null for apps
  // without a doc section (custom apps, undocumented catalog apps) so the Docs item is hidden.
  const docLink = getSupplyDepotDocLink(service.service_name)

  // Subtitle under the app name: the powered-by name plus the installed image tag
  // (e.g. "Kiwix · 3.7.0"). Only installed apps have a meaningful running version; a
  // not-yet-installed catalog entry shows just the powered-by name. Null when neither exists.
  const version = service.installed ? extractTag(service.container_image) : ''
  const subtitle =
    !service.powered_by && !version ? null : (
      <p className="text-xs text-text-muted truncate">
        {service.powered_by}
        {service.powered_by && version ? ' · ' : ''}
        {version ? <span className="font-mono">{version}</span> : null}
      </p>
    )

  function toggleDropdown(e: React.MouseEvent) {
    e.stopPropagation()
    onOpenDropdown(isDropdownOpen ? null : service.service_name)
  }

  return (
    <div
      className={`relative flex flex-col rounded-xl border p-4 bg-surface-primary shadow-sm transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 ${
        service.installed
          ? 'border-desert-stone-light'
          : 'border-desert-stone-lighter hover:border-desert-stone-light'
      }`}
    >
      {/* Installed accent spine (rounded to follow the card corners — the card no longer clips
          overflow so the Manage dropdown can open above the card without being cut off) */}
      {service.installed ? (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-desert-green rounded-l-xl" />
      ) : null}

      {/* Top row: icon + status badge */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-desert-green-lighter border border-desert-green-light flex items-center justify-center flex-shrink-0">
            {service.icon ? (
              <DynamicIcon
                icon={service.icon as DynamicIconName}
                className="h-7 w-7 text-desert-green"
              />
            ) : (
              <IconBrandDocker className="h-7 w-7 text-text-muted" />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-text-primary text-sm leading-tight truncate">
              {service.friendly_name ?? service.service_name}
            </p>
            {subtitle}
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex-shrink-0 ml-2">
          {isInstalling ? (
            <span className="flex items-center gap-1 text-xs text-desert-orange">
              <span className="animate-spin inline-block w-3 h-3 border border-desert-orange border-t-transparent rounded-full" />
              Installing
            </span>
          ) : isRunning ? (
            <span className="flex items-center gap-1 text-xs text-desert-green">
              <span className="h-2 w-2 rounded-full bg-desert-green" />
              Running
            </span>
          ) : isStopped ? (
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <span className="h-2 w-2 rounded-full bg-text-muted" />
              Stopped
            </span>
          ) : null}
        </div>
      </div>

      {/* Description */}
      {service.description && (
        <p className="text-xs text-text-muted leading-relaxed mb-3 flex-1 line-clamp-2">
          {service.description}
        </p>
      )}

      {/* Metadata row: category badge + port pill */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {service.category && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${catColor}`}>
            {toTitleCase(service.category)}
          </span>
        )}
        {service.is_custom ? (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-surface-secondary text-text-muted border border-surface-secondary">
            custom
          </span>
        ) : null}
        {service.is_user_modified && !service.is_custom ? (
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium bg-desert-tan-lighter text-desert-tan-dark border border-desert-tan-light"
            title="You've customized this app, so it won't be overwritten by catalog updates."
          >
            modified
          </span>
        ) : null}
        {service.is_deprecated ? (
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium bg-desert-orange-lighter text-desert-orange-dark border border-desert-orange-light"
            title="This is a legacy version that's no longer maintained. Install the current Education Platform from the catalog, then uninstall this one."
          >
            legacy
          </span>
        ) : null}
        {uiPort && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-surface-secondary text-text-muted font-mono">
            {uiIsHttps ? '🔒 ' : ''}:{uiPort}
          </span>
        )}
        {service.available_update_version && !service.is_custom && (
          <button
            type="button"
            onClick={onUpdateVersion}
            title={`Update to ${service.available_update_version}`}
            className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold bg-desert-orange text-white shadow-sm cursor-pointer transition-colors hover:bg-desert-orange-dark"
          >
            <IconArrowUp className="h-3 w-3" />
            Update available
          </button>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {!service.installed && !isInstalling && (
          <StyledButton
            size="sm"
            variant="primary"
            icon="IconDownload"
            onClick={onInstall}
            fullWidth
          >
            Install
          </StyledButton>
        )}

        {service.installed ? (
          <>
            {/* Open button — shown when the app has a default location or a user-set custom URL */}
            {(service.ui_path || service.ui_location || service.custom_url) && (
              <a
                href={getServiceLink(
                  service.ui_location || '',
                  service.custom_url,
                  service.ui_path,
                  reverseProxyBaseDomain
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1"
              >
                <StyledButton size="sm" variant="primary" icon="IconExternalLink" fullWidth>
                  Open
                </StyledButton>
              </a>
            )}

            {/* Manage dropdown */}
            <div className="relative" ref={isDropdownOpen ? dropdownRef : null}>
              <StyledButton
                size="sm"
                variant="outline"
                onClick={toggleDropdown}
                icon="IconChevronDown"
              >
                Manage
              </StyledButton>

              {isDropdownOpen && (
                <div className="absolute right-0 bottom-full mb-1 w-44 bg-surface-primary border border-surface-secondary rounded-lg shadow-xl z-20 overflow-hidden">
                  {docLink && (
                    <a
                      href={docLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors text-left cursor-pointer text-text-primary hover:bg-surface-secondary"
                    >
                      <IconBook className="h-4 w-4" />
                      Docs
                    </a>
                  )}
                  {isStopped && (
                    <DropdownItem
                      icon={<IconPlayerPlay className="h-4 w-4" />}
                      label="Start"
                      onClick={onStart}
                    />
                  )}
                  {isRunning && (
                    <DropdownItem
                      icon={<IconPlayerStop className="h-4 w-4" />}
                      label="Stop"
                      onClick={onStop}
                    />
                  )}
                  <DropdownItem
                    icon={<IconRefresh className="h-4 w-4" />}
                    label="Restart"
                    onClick={onRestart}
                  />
                  <DropdownItem
                    icon={<IconFileText className="h-4 w-4" />}
                    label="Logs"
                    onClick={onLogs}
                  />
                  <DropdownItem
                    icon={<IconChartBar className="h-4 w-4" />}
                    label="Stats"
                    onClick={onStats}
                  />
                  <DropdownItem
                    icon={<IconPencil className="h-4 w-4" />}
                    label="Edit"
                    onClick={onEdit}
                  />
                  <DropdownItem
                    icon={<IconWorld className="h-4 w-4" />}
                    label="Set custom URL"
                    onClick={onSetUrl}
                  />
                  {migrationInstructionsHref ? (
                    <a
                      href={migrationInstructionsHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors text-left cursor-pointer text-text-primary hover:bg-surface-secondary"
                    >
                      <IconBook className="h-4 w-4" />
                      {migrationInstructionsText || 'Migration instructions'}
                    </a>
                  ) : null}
                  {!service.is_custom && onToggleAutoUpdate ? (
                    autoUpdateMasterEnabled ? (
                      <DropdownItem
                        icon={
                          <IconClockBolt
                            className={`h-4 w-4 ${autoUpdateEnabled ? 'text-desert-green' : ''}`}
                          />
                        }
                        label={`Auto-update: ${autoUpdateEnabled ? 'On' : 'Off'}`}
                        onClick={() => onToggleAutoUpdate(!autoUpdateEnabled)}
                      />
                    ) : (
                      <DropdownItem
                        icon={<IconClockBolt className="h-4 w-4" />}
                        label="App auto-updates off — open Settings"
                        onClick={() => router.visit('/settings/update')}
                      />
                    )
                  ) : null}
                  {service.available_update_version && !service.is_custom ? (
                    <DropdownItem
                      icon={<IconArrowUp className="h-4 w-4 text-desert-green" />}
                      label={`Update to ${service.available_update_version}`}
                      onClick={onUpdateVersion}
                    />
                  ) : null}
                  {service.is_custom ? (
                    <DropdownItem
                      icon={<IconCloudDownload className="h-4 w-4" />}
                      label="Update (pull latest)"
                      onClick={onUpdate}
                    />
                  ) : null}
                  <DropdownItem
                    icon={<IconRefresh className="h-4 w-4 text-desert-orange" />}
                    label="Force Reinstall"
                    onClick={onReinstall}
                    danger
                  />
                  {service.is_custom ? (
                    <DropdownItem
                      icon={<IconTrash className="h-4 w-4 text-desert-red" />}
                      label="Delete"
                      onClick={onDelete}
                      danger
                    />
                  ) : (
                    <DropdownItem
                      icon={<IconTrash className="h-4 w-4 text-desert-red" />}
                      label="Uninstall"
                      onClick={onUninstall}
                      danger
                    />
                  )}
                </div>
              )}
            </div>
          </>
        ) : null}

        {isInstalling && !service.installed && (
          <div className="flex-1 flex items-center justify-center text-xs text-text-muted gap-1 py-1">
            <span className="animate-spin inline-block w-3 h-3 border border-desert-green border-t-transparent rounded-full" />
            In progress…
          </div>
        )}
      </div>
    </div>
  )
}

function DropdownItem({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors text-left cursor-pointer ${
        danger
          ? 'text-desert-red hover:bg-desert-red/10'
          : 'text-text-primary hover:bg-surface-secondary'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
