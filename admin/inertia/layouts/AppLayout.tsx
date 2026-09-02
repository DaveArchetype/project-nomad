import { useState } from 'react'
import type { ReactNode } from 'react'
import Footer from '~/components/Footer'
import ChatButton from '~/components/chat/ChatButton'
import ChatModal from '~/components/chat/ChatModal'
import useServiceInstalledStatus from '~/hooks/useServiceInstalledStatus'
import { SERVICE_NAMES } from '../../constants/service_names'
import { Link, router } from '@inertiajs/react'
import { IconArrowLeft, IconBug } from '@tabler/icons-react'
import classNames from 'classnames'
import DebugInfoModal from '~/components/DebugInfoModal'
import MicStatusIndicator from '~/components/layout/MicStatusIndicator'

export default function AppLayout({
  children,
  compact = false,
}: {
  children: ReactNode
  /**
   * Compact header for focused tool pages (e.g. Drug Reference): a small inline
   * logo + title instead of the full-height branding block, so the tool's own
   * controls sit near the top of the viewport instead of ~230px down.
   */
  compact?: boolean
}) {
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [debugModalOpen, setDebugModalOpen] = useState(false)
  const aiAssistantInstalled = useServiceInstalledStatus(SERVICE_NAMES.OLLAMA)

  const isHome = window.location.pathname === '/home'

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className={classNames(
          'sticky top-0 z-30 flex items-center justify-between gap-3 px-4',
          'bg-surface-primary/90 backdrop-blur border-b border-border-subtle',
          compact ? 'py-2' : 'py-3'
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => router.visit('/home')}
            className="flex items-center gap-2 cursor-pointer shrink-0"
            aria-label="Go to Command Center home"
          >
            <img
              src="/project_nomad_logo.webp"
              alt="Project NOMAD Logo"
              className={compact ? 'h-7 w-7' : 'h-8 w-8'}
            />
            <span className="font-semibold text-lg text-desert-green leading-none whitespace-nowrap">
              Command Center
            </span>
          </button>

          {!isHome && (
            <>
              <span className="h-5 w-px bg-border-default shrink-0" aria-hidden="true" />
              <Link
                href="/home"
                className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-desert-green transition-colors whitespace-nowrap"
              >
                <IconArrowLeft size={16} />
                <span>Back to Home</span>
              </Link>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setDebugModalOpen(true)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors text-desert-stone hover:text-desert-green-darker cursor-pointer"
            aria-label="Open debug info"
            title="Debug Info"
          >
            <IconBug className="size-4" />
            <span className="hidden sm:inline">Debug Info</span>
          </button>
          <MicStatusIndicator />
        </div>
      </header>

      {!compact && isHome && (
        <div
          className="flex flex-col items-center justify-center gap-2 py-8 cursor-pointer"
          onClick={() => router.visit('/home')}
        >
          <img src="/project_nomad_logo.webp" alt="Project NOMAD Logo" className="h-20 w-20" />
          <h1 className="font-bold text-3xl text-desert-green leading-tight">Command Center</h1>
          <p className="text-base text-text-secondary">Your offline-first command center</p>
        </div>
      )}

      <div className="flex-1 w-full bg-desert">{children}</div>
      <Footer />

      {aiAssistantInstalled && (
        <>
          <ChatButton onClick={() => setIsChatOpen(true)} />
          <ChatModal open={isChatOpen} onClose={() => setIsChatOpen(false)} />
        </>
      )}

      <DebugInfoModal open={debugModalOpen} onClose={() => setDebugModalOpen(false)} />
    </div>
  )
}
