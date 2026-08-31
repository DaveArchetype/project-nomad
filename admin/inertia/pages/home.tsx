import {
  IconBolt,
  IconBox,
  IconHelp,
  IconMapRoute,
  IconPill,
  IconSettings,
  IconWifiOff,
  IconArrowUpRight,
} from '@tabler/icons-react'
import { Head, Link, usePage } from '@inertiajs/react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, MouseEvent as ReactMouseEvent } from 'react'
import AppLayout from '~/layouts/AppLayout'
import { getServiceLink } from '~/lib/navigation'
import { ServiceSlim } from '../../types/services'
import DynamicIcon, { DynamicIconName } from '~/components/DynamicIcon'
import { useSystemSetting } from '~/hooks/useSystemSetting'
import { useReverseProxyBaseDomain } from '~/hooks/useReverseProxyBaseDomain'
import WhatsNewBanner from '~/components/WhatsNewBanner'
import { SERVICE_NAMES } from '../../constants/service_names'

// Maps is a Core Capability (display_order: 4)
const MAPS_ITEM: DashboardItem = {
  label: 'Maps',
  to: '/maps',
  target: '',
  description: 'View offline maps',
  icon: <IconMapRoute size={26} />,
  installed: true,
  displayOrder: 4,
  poweredBy: null,
  category: 'core',
}

// Drug Reference + "When to use what" — offline medical reference tiles.
// icon and displayOrder here are a reasonable default; both are open for the
// maintainer to re-pick to fit the dashboard's ordering conventions.
const DRUG_REFERENCE_ITEM: DashboardItem = {
  label: 'Drug Reference',
  to: '/drug-reference',
  target: '',
  description:
    'Offline FDA drug labels — search by drug name, or by situation (burn, fever, diarrhea)',
  icon: <IconPill size={26} />,
  installed: true,
  displayOrder: 5,
  poweredBy: null,
  category: 'core',
}

// System items shown after all apps
const SYSTEM_ITEMS: DashboardItem[] = [
  {
    label: 'Easy Setup',
    to: '/easy-setup',
    target: '',
    description: 'Not sure where to start? Use the setup wizard to quickly configure your NOMAD!',
    icon: <IconBolt size={26} />,
    installed: true,
    displayOrder: 50,
    poweredBy: null,
    category: 'system',
  },
  {
    label: 'Supply Depot',
    to: '/supply-depot',
    target: '',
    description: 'Browse and install curated apps, or add your own Docker container',
    icon: <IconBox size={26} />,
    installed: true,
    displayOrder: 51,
    poweredBy: null,
    category: 'system',
  },
  {
    label: 'Docs',
    to: '/docs/home',
    target: '',
    description: 'Read Project NOMAD manuals and guides',
    icon: <IconHelp size={26} />,
    installed: true,
    displayOrder: 52,
    poweredBy: null,
    category: 'system',
  },
  {
    label: 'Settings',
    to: '/settings/system',
    target: '',
    description: 'Configure your NOMAD settings',
    icon: <IconSettings size={26} />,
    installed: true,
    displayOrder: 53,
    poweredBy: null,
    category: 'system',
  },
]

interface DashboardItem {
  label: string
  to: string
  target: string
  description: string
  icon: ReactNode
  installed: boolean
  displayOrder: number
  poweredBy: string | null
  category: string | null
}

// Per-category icon background + text color. Falls back to the default green
// accent for unknown / null categories. All tokens come from app.css so dark
// mode keeps working with no extra CSS.
const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  ai: { bg: 'bg-desert-orange-lighter', text: 'text-desert-orange-dark' },
  education: { bg: 'bg-desert-olive-lighter', text: 'text-desert-olive-dark' },
  utility: { bg: 'bg-desert-stone-lighter', text: 'text-desert-stone-dark' },
  productivity: { bg: 'bg-desert-tan-lighter', text: 'text-desert-tan-dark' },
  media: { bg: 'bg-desert-red-lighter', text: 'text-desert-red-dark' },
  networking: { bg: 'bg-desert-green-lighter', text: 'text-desert-green' },
  security: { bg: 'bg-desert-red-lighter', text: 'text-desert-red-dark' },
  core: { bg: 'bg-desert-green-lighter', text: 'text-desert-green' },
  system: { bg: 'bg-desert-green-lighter', text: 'text-desert-green' },
}

const DEFAULT_CATEGORY_COLOR = CATEGORY_COLORS.core

function categoryColor(category: string | null) {
  return (category && CATEGORY_COLORS[category]) || DEFAULT_CATEGORY_COLOR
}

function DashboardTile({
  item,
  shouldHighlight,
}: {
  item: DashboardItem
  shouldHighlight: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [isClamped, setIsClamped] = useState(false)
  const descRef = useRef<HTMLParagraphElement>(null)
  const isExternal = item.target === '_blank'
  const colors = categoryColor(item.category)

  useLayoutEffect(() => {
    const el = descRef.current
    if (!el) return
    setIsClamped(el.scrollHeight > el.clientHeight + 1)
  }, [item.description, expanded])

  const toggleExpand = (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setExpanded((v) => !v)
  }

  const tileContent = (
    <div
      className={`group relative rounded-2xl border border-border-subtle p-6 bg-surface-primary shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-1 hover:ring-1 hover:ring-desert-green-light/40 cursor-pointer flex flex-col min-h-44 ${
        shouldHighlight ? 'border-desert-orange-light' : ''
      }`}
    >
      {shouldHighlight && (
        <span className="absolute -top-2.5 left-4 flex items-center justify-center">
          <span
            className="animate-ping absolute inline-flex h-5 w-16 rounded-full bg-desert-orange-light opacity-75"
            style={{ animationDuration: '1.5s' }}
          ></span>
          <span className="relative inline-flex items-center rounded-full px-2.5 py-0.5 bg-desert-orange-light text-xs font-semibold text-white shadow-sm">
            Start here!
          </span>
        </span>
      )}

      <div className="flex items-start justify-between mb-4">
        <div
          className={`flex items-center justify-center w-12 h-12 rounded-xl ${colors.bg} ${colors.text} shrink-0`}
        >
          {item.icon}
        </div>
        {isExternal && (
          <IconArrowUpRight
            size={18}
            className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
          />
        )}
      </div>

      <h3 className="font-semibold text-lg text-text-primary leading-tight mb-1">{item.label}</h3>
      {item.poweredBy && (
        <p className="text-xs text-desert-green font-medium mb-1">{item.poweredBy}</p>
      )}
      <p
        ref={descRef}
        className={`text-sm text-text-secondary flex-1 ${expanded ? '' : 'line-clamp-3'}`}
      >
        {item.description}
      </p>
      {isClamped && (
        <button
          type="button"
          onClick={toggleExpand}
          className="self-start mt-1 text-xs font-medium text-desert-green hover:text-desert-green-darker transition-colors cursor-pointer"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )

  return isExternal ? (
    <a key={item.label} href={item.to} target="_blank" rel="noopener noreferrer">
      {tileContent}
    </a>
  ) : (
    <Link key={item.label} href={item.to}>
      {tileContent}
    </Link>
  )
}

function DashboardSection({
  title,
  items,
  shouldHighlightEasySetup,
}: {
  title: string
  items: DashboardItem[]
  shouldHighlightEasySetup: boolean
}) {
  if (items.length === 0) return null

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-desert-green">
          {title}
        </h2>
        <span className="h-px flex-1 bg-border-subtle" aria-hidden="true" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 items-stretch">
        {items.map((item) => {
          const isEasySetup = item.label === 'Easy Setup'
          const shouldHighlight = isEasySetup && shouldHighlightEasySetup
          return <DashboardTile key={item.label} item={item} shouldHighlight={shouldHighlight} />
        })}
      </div>
    </section>
  )
}

export default function Home(props: {
  system: {
    services: ServiceSlim[]
  }
  // Server-computed: true when the offline FDA drug dataset is installed or
  // installing (curated Medicine tier). Gates the two medical-reference tiles
  // below so they only appear once the data exists.
  drugReferenceInstalled: boolean
}) {
  const { aiAssistantName } = usePage<{ aiAssistantName: string }>().props
  const reverseProxyBaseDomain = useReverseProxyBaseDomain()

  // Check if user has visited Easy Setup
  const { data: easySetupVisited } = useSystemSetting({
    key: 'ui.hasVisitedEasySetup',
  })
  const shouldHighlightEasySetup = easySetupVisited?.value
    ? String(easySetupVisited.value) !== 'true'
    : false

  // Add installed services (non-dependency services only). Services whose only
  // "interface" is a settings-page redirect (ui_location under /settings/) have
  // no dedicated web UI, so they are hidden from the dashboard — e.g. TTS and
  // Voice Gateway, which only surface through /settings/voice.
  const appItems: DashboardItem[] = props.system.services
    .filter(
      (service) =>
        service.installed &&
        (service.ui_path || service.ui_location || service.custom_url) &&
        !(service.ui_location ?? '').startsWith('/settings/')
    )
    .map((service) => ({
      // Inject custom AI Assistant name if this is the chat service
      label:
        service.service_name === SERVICE_NAMES.OLLAMA && aiAssistantName
          ? aiAssistantName
          : service.friendly_name || service.service_name,
      to:
        service.ui_path || service.ui_location || service.custom_url
          ? getServiceLink(
              service.ui_location || '',
              service.custom_url,
              service.ui_path,
              reverseProxyBaseDomain
            )
          : '#',
      target: '_blank',
      description:
        service.description ||
        `Access the ${service.friendly_name || service.service_name} application`,
      icon: service.icon ? (
        <DynamicIcon icon={service.icon as DynamicIconName} className="!size-7" />
      ) : (
        <IconWifiOff size={26} />
      ),
      installed: service.installed,
      displayOrder: service.display_order ?? 100,
      poweredBy: service.powered_by ?? null,
      category: service.category ?? null,
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder)

  // Core Capabilities: Maps (always) + Drug Reference (gated by the offline
  // FDA drug dataset being installed/installing via the curated Medicine tier).
  const coreItems: DashboardItem[] = [MAPS_ITEM]
  if (props.drugReferenceInstalled) {
    coreItems.push(DRUG_REFERENCE_ITEM)
  }
  coreItems.sort((a, b) => a.displayOrder - b.displayOrder)

  const systemItems: DashboardItem[] = [...SYSTEM_ITEMS].sort(
    (a, b) => a.displayOrder - b.displayOrder
  )

  return (
    <AppLayout>
      <Head title="Command Center" />
      <WhatsNewBanner />
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-10">
        <DashboardSection
          title="Apps"
          items={appItems}
          shouldHighlightEasySetup={shouldHighlightEasySetup}
        />
        <DashboardSection
          title="Core Capabilities"
          items={coreItems}
          shouldHighlightEasySetup={shouldHighlightEasySetup}
        />
        <DashboardSection
          title="System"
          items={systemItems}
          shouldHighlightEasySetup={shouldHighlightEasySetup}
        />
      </div>
    </AppLayout>
  )
}
