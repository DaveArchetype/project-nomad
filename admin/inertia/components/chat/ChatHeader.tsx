import { useEffect, useRef, useState } from 'react'
import { IconMenu2, IconAdjustmentsHorizontal, IconX } from '@tabler/icons-react'
import classNames from '~/lib/classNames'
import { formatBytes } from '~/lib/util'
import Switch from '~/components/inputs/Switch'
import InfoTooltip from '~/components/InfoTooltip'
import MicStatusIndicator from '~/components/layout/MicStatusIndicator'
import { NomadInstalledModel } from '../../../types/ollama'

interface ChatHeaderProps {
  activeSessionTitle: string
  isMobileSidebarOpen: boolean
  onOpenSidebar: () => void
  isInModal: boolean
  onClose: () => void
  installedModels: NomadInstalledModel[]
  isLoadingModels: boolean
  selectedModel: string
  pendingModelSwitch: string | null
  onUserSelectedModel: (model: string) => void
  selectedModelSupportsThinking: boolean
  effectiveThinking: (model: string) => boolean
  onSetModelThinking: (model: string, value: boolean) => void
  collectionFilter: string
  onCollectionFilterChange: (value: string) => void
  knownCollections: string[]
  remoteOllamaUrl: any
  remoteStatus: { connected?: boolean } | undefined
}

export default function ChatHeader({
  activeSessionTitle,
  isMobileSidebarOpen,
  onOpenSidebar,
  isInModal,
  onClose,
  installedModels,
  isLoadingModels,
  selectedModel,
  pendingModelSwitch,
  onUserSelectedModel,
  selectedModelSupportsThinking,
  effectiveThinking,
  onSetModelThinking,
  collectionFilter,
  onCollectionFilterChange,
  knownCollections,
  remoteOllamaUrl,
  remoteStatus,
}: ChatHeaderProps) {
  const [optionsOpen, setOptionsOpen] = useState(false)
  const optionsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!optionsOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) {
        setOptionsOpen(false)
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOptionsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [optionsOpen])

  const modelSelect = (
    <select
      id="model-select"
      value={pendingModelSwitch ?? selectedModel}
      onChange={(e) => onUserSelectedModel(e.target.value)}
      className="min-w-0 max-w-44 sm:max-w-none px-2 sm:px-3 py-1.5 border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-desert-green focus:border-transparent bg-surface-primary"
    >
      {installedModels.map((model) => (
        <option key={model.name} value={model.name}>
          {model.name}
          {model.size > 0 ? ` (${formatBytes(model.size)})` : ''}
        </option>
      ))}
    </select>
  )

  const collectionSelect = (
    <select
      id="collection-select"
      value={collectionFilter}
      onChange={(e) => onCollectionFilterChange(e.target.value)}
      className="px-3 py-1.5 border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-desert-green focus:border-transparent bg-surface-primary"
    >
      <option value="">All</option>
      {knownCollections.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  )

  const thinkingToggle = selectedModelSupportsThinking ? (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <span className="text-sm text-text-secondary select-none">Thinking:</span>
        <InfoTooltip
          position="bottom"
          align="right"
          text="When on, this model works through its reasoning before answering. Slower, but often better on tricky questions. Your choice is remembered for this model; the default for other models is set in AI Assistant settings."
        />
      </div>
      <Switch
        id="chat-thinking-toggle"
        checked={effectiveThinking(selectedModel)}
        onChange={(v) => onSetModelThinking(selectedModel, v)}
      />
    </div>
  ) : null

  const remoteBadge = remoteOllamaUrl ? (
    <span
      className={classNames(
        'text-xs rounded px-2 py-1 font-medium',
        remoteStatus?.connected === false
          ? 'text-red-700 bg-red-50 border border-red-200'
          : 'text-green-700 bg-green-50 border border-green-200'
      )}
    >
      {remoteStatus?.connected === false ? 'Remote Disconnected' : 'Remote Connected'}
    </span>
  ) : null

  return (
    <div className="relative px-3 sm:px-6 py-2 sm:py-3 border-b border-border-subtle bg-surface-secondary flex items-center justify-between gap-2 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          className="rounded-lg p-1.5 hover:bg-surface-primary focus:outline-none focus:ring-2 focus:ring-desert-green md:hidden"
          aria-label="Open conversation sidebar"
          aria-controls="chat-sidebar"
          aria-expanded={isMobileSidebarOpen}
          onClick={onOpenSidebar}
        >
          <IconMenu2 className="h-6 w-6 text-text-muted" aria-hidden="true" />
        </button>
        <h2 className="text-base sm:text-lg font-semibold text-text-primary truncate">
          {activeSessionTitle || 'New Chat'}
        </h2>
      </div>

      <div className="hidden md:flex items-center gap-2 sm:gap-4 min-w-0">
        {remoteBadge}
        <div className="flex items-center gap-2">
          <label htmlFor="collection-select" className="text-sm text-text-secondary">
            Search in:
          </label>
          {collectionSelect}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <label htmlFor="model-select" className="text-sm text-text-secondary">
            Model:
          </label>
          {isLoadingModels ? (
            <div className="text-sm text-text-muted">Loading models...</div>
          ) : installedModels.length === 0 ? (
            <div className="text-sm text-red-600">No models installed</div>
          ) : (
            modelSelect
          )}
        </div>
        {thinkingToggle}
        <MicStatusIndicator />
        {isInModal && (
          <button
            type="button"
            aria-label="Close chat"
            onClick={onClose}
            className="rounded-lg hover:bg-surface-secondary transition-colors"
          >
            <IconX className="h-6 w-6 text-text-muted" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex md:hidden items-center gap-2" ref={optionsRef}>
        <button
          type="button"
          aria-label="Chat options"
          aria-expanded={optionsOpen}
          onClick={() => setOptionsOpen((v) => !v)}
          className="rounded-lg p-1.5 hover:bg-surface-primary focus:outline-none focus:ring-2 focus:ring-desert-green"
        >
          <IconAdjustmentsHorizontal className="h-6 w-6 text-text-muted" aria-hidden="true" />
        </button>
        {isInModal && (
          <button
            type="button"
            aria-label="Close chat"
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-surface-primary"
          >
            <IconX className="h-6 w-6 text-text-muted" aria-hidden="true" />
          </button>
        )}
        {optionsOpen && (
          <div className="absolute right-3 top-full mt-1 z-30 w-72 max-w-[calc(100vw-1.5rem)] bg-surface-primary border border-border-subtle rounded-lg shadow-lg p-3 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="model-select-mobile" className="text-sm text-text-secondary">
                Model:
              </label>
              {isLoadingModels ? (
                <div className="text-sm text-text-muted">Loading models...</div>
              ) : installedModels.length === 0 ? (
                <div className="text-sm text-red-600">No models installed</div>
              ) : (
                <select
                  id="model-select-mobile"
                  value={pendingModelSwitch ?? selectedModel}
                  onChange={(e) => onUserSelectedModel(e.target.value)}
                  className="w-full px-3 py-1.5 border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-desert-green focus:border-transparent bg-surface-primary"
                >
                  {installedModels.map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.name}
                      {model.size > 0 ? ` (${formatBytes(model.size)})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="collection-select-mobile" className="text-sm text-text-secondary">
                Search in:
              </label>
              <select
                id="collection-select-mobile"
                value={collectionFilter}
                onChange={(e) => onCollectionFilterChange(e.target.value)}
                className="w-full px-3 py-1.5 border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-desert-green focus:border-transparent bg-surface-primary"
              >
                <option value="">All</option>
                {knownCollections.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {thinkingToggle}
            {remoteBadge}
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">Voice Assistant:</span>
              <MicStatusIndicator />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
