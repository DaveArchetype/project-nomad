import { Head, router, usePage } from '@inertiajs/react'
import { useRef, useState } from 'react'
import StyledTable from '~/components/StyledTable'
import SettingsLayout from '~/layouts/SettingsLayout'
import { NomadOllamaModel } from '../../../types/ollama'
import StyledButton from '~/components/StyledButton'
import useServiceInstalledStatus from '~/hooks/useServiceInstalledStatus'
import Alert from '~/components/Alert'
import { useNotifications } from '~/context/NotificationContext'
import api from '~/lib/api'
import { useModals } from '~/context/ModalContext'
import StyledModal from '~/components/StyledModal'
import type { NomadInstalledModel } from '../../../types/ollama'
import { SERVICE_NAMES } from '../../../constants/service_names'
import Switch from '~/components/inputs/Switch'
import Select from '~/components/inputs/Select'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import { useMutation, useQuery } from '@tanstack/react-query'
import Input from '~/components/inputs/Input'
import { IconSearch, IconRefresh, IconChevronDown } from '@tabler/icons-react'
import { formatBytes } from '~/lib/util'
import useDebounce from '~/hooks/useDebounce'
import ActiveModelDownloads from '~/components/ActiveModelDownloads'
import { useSystemInfo } from '~/hooks/useSystemInfo'

export default function ModelsPage(props: {
  models: {
    availableModels: NomadOllamaModel[]
    installedModels: NomadInstalledModel[]
    settings: {
      chatSuggestionsEnabled: boolean
      aiAssistantCustomName: string
      remoteOllamaUrl: string
      ollamaFlashAttention: boolean
      ollamaKvCacheType: string
      ollamaNumCtx: string
      autoThinking: boolean
      embedPauseAfterChatMinutes: string
      embedConcurrency: string
      maxConcurrentEmbeds: string
      qdrantUpsertConcurrency: string
      embeddingBatchSize: string
      zimWorkerCount: string
      qdrantIndexingThreshold: string
      teiIdleStopMinutes: string
    }
  }
}) {
  const { aiAssistantName } = usePage<{ aiAssistantName: string }>().props
  const { isInstalled } = useServiceInstalledStatus(SERVICE_NAMES.OLLAMA)
  const { addNotification } = useNotifications()
  const { openModal, closeAllModals } = useModals()
  const { debounce } = useDebounce()
  const { data: systemInfo } = useSystemInfo({})

  const [gpuBannerDismissed, setGpuBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem('nomad:gpu-banner-dismissed') === 'true'
    } catch {
      return false
    }
  })
  const [reinstalling, setReinstalling] = useState(false)

  const handleDismissGpuBanner = () => {
    setGpuBannerDismissed(true)
    try {
      localStorage.setItem('nomad:gpu-banner-dismissed', 'true')
    } catch {}
  }

  const executeReinstallOllama = async () => {
    closeAllModals()
    setReinstalling(true)
    try {
      const response = await api.forceReinstallService('nomad_ollama')
      if (!response || !response.success) {
        throw new Error(response?.message || 'Force reinstall failed')
      }
      addNotification({
        message: `${aiAssistantName} is being reinstalled with GPU support. This page will reload shortly.`,
        type: 'success',
      })
      try {
        localStorage.removeItem('nomad:gpu-banner-dismissed')
      } catch {}
      setTimeout(() => window.location.reload(), 5000)
    } catch (error) {
      addNotification({
        message: `Failed to reinstall: ${error instanceof Error ? error.message : 'Unknown error'}`,
        type: 'error',
      })
      setReinstalling(false)
    }
  }

  const handleForceReinstallOllama = () => {
    openModal(
      <StyledModal
        title="Reinstall AI Assistant?"
        onConfirm={executeReinstallOllama}
        onCancel={closeAllModals}
        open={true}
        confirmText="Reinstall"
        cancelText="Cancel"
      >
        <p className="text-text-primary">
          This will recreate the {aiAssistantName} container with GPU support enabled. Your
          downloaded models will be preserved. The service will be briefly unavailable during
          reinstall.
        </p>
      </StyledModal>,
      'gpu-health-force-reinstall-modal'
    )
  }

  const promptReinstallForSettingChange = (settingLabel: string) => {
    openModal(
      <StyledModal
        title="Reinstall to apply changes?"
        onConfirm={executeReinstallOllama}
        onCancel={closeAllModals}
        open={true}
        confirmText="Reinstall now"
        cancelText="Later"
      >
        <p className="text-text-primary">
          <strong>{settingLabel}</strong> was saved, but it only takes effect after reinstalling the{' '}
          {aiAssistantName} — the setting is applied when the Ollama container is recreated. Your
          downloaded models will be preserved. The service will be briefly unavailable during
          reinstall.
        </p>
        <p className="text-text-muted mt-2">
          You can reinstall later from the GPU banner at the top of this page if you prefer.
        </p>
      </StyledModal>,
      'setting-change-reinstall-prompt-modal'
    )
  }
  const [chatSuggestionsEnabled, setChatSuggestionsEnabled] = useState(
    props.models.settings.chatSuggestionsEnabled
  )
  const [ollamaFlashAttention, setOllamaFlashAttention] = useState(
    props.models.settings.ollamaFlashAttention
  )
  const [ollamaKvCacheType, setOllamaKvCacheType] = useState(
    props.models.settings.ollamaKvCacheType
  )
  const [ollamaNumCtx, setOllamaNumCtx] = useState(props.models.settings.ollamaNumCtx)
  const [autoThinking, setAutoThinking] = useState(props.models.settings.autoThinking)
  const [aiAssistantCustomName, setAiAssistantCustomName] = useState(
    props.models.settings.aiAssistantCustomName
  )
  const [remoteOllamaUrl, setRemoteOllamaUrl] = useState(props.models.settings.remoteOllamaUrl)
  const [remoteOllamaError, setRemoteOllamaError] = useState<string | null>(null)
  const [remoteOllamaSaving, setRemoteOllamaSaving] = useState(false)
  const [embedPauseAfterChatMinutes, setEmbedPauseAfterChatMinutes] = useState(
    props.models.settings.embedPauseAfterChatMinutes
  )
  const [embedConcurrency, setEmbedConcurrency] = useState(props.models.settings.embedConcurrency)
  const [maxConcurrentEmbeds, setMaxConcurrentEmbeds] = useState(
    props.models.settings.maxConcurrentEmbeds
  )
  const [qdrantUpsertConcurrency, setQdrantUpsertConcurrency] = useState(
    props.models.settings.qdrantUpsertConcurrency
  )
  const [embeddingBatchSize, setEmbeddingBatchSize] = useState(
    props.models.settings.embeddingBatchSize
  )
  const [zimWorkerCount, setZimWorkerCount] = useState(props.models.settings.zimWorkerCount)
  const [qdrantIndexingThreshold, setQdrantIndexingThreshold] = useState(
    props.models.settings.qdrantIndexingThreshold
  )
  const [teiIdleStopMinutes, setTeiIdleStopMinutes] = useState(
    props.models.settings.teiIdleStopMinutes
  )
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false)

  async function handleSaveRemoteOllama() {
    setRemoteOllamaError(null)
    setRemoteOllamaSaving(true)
    try {
      const res = await api.configureRemoteOllama(remoteOllamaUrl || null)
      if (res?.success) {
        addNotification({ message: res.message, type: 'success' })
        router.reload()
      }
    } catch (error: any) {
      const msg =
        error?.response?.data?.message || error?.message || 'Failed to configure remote Ollama.'
      setRemoteOllamaError(msg)
    } finally {
      setRemoteOllamaSaving(false)
    }
  }

  async function handleClearRemoteOllama() {
    setRemoteOllamaError(null)
    setRemoteOllamaSaving(true)
    try {
      const res = await api.configureRemoteOllama(null)
      if (res?.success) {
        setRemoteOllamaUrl('')
        addNotification({ message: 'Remote Ollama configuration cleared.', type: 'success' })
        router.reload()
      }
    } catch (error: any) {
      setRemoteOllamaError(error?.message || 'Failed to clear remote Ollama.')
    } finally {
      setRemoteOllamaSaving(false)
    }
  }

  const [query, setQuery] = useState('')
  const [queryUI, setQueryUI] = useState('')
  const [limit, setLimit] = useState(15)
  const [sortBy, setSortBy] = useState<'pulls' | 'name' | 'recent'>('pulls')
  const [tagSortBy, setTagSortBy] = useState<Record<string, 'size' | 'name'>>({})
  const [tagSortDir, setTagSortDir] = useState<Record<string, 'asc' | 'desc'>>({})

  const debouncedSetQuery = debounce((val: string) => {
    setQuery(val)
  }, 300)

  const forceRefreshRef = useRef(false)
  const [isForceRefreshing, setIsForceRefreshing] = useState(false)

  const {
    data: availableModelData,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['ollama', 'availableModels', query, limit, sortBy],
    queryFn: async () => {
      const force = forceRefreshRef.current
      forceRefreshRef.current = false
      const res = await api.getAvailableModels({
        query,
        recommendedOnly: false,
        limit,
        force: force || undefined,
        sort: sortBy,
      })
      if (!res) {
        return {
          models: [],
          hasMore: false,
        }
      }
      return res
    },
    initialData: { models: props.models.availableModels, hasMore: false },
  })

  async function handleForceRefresh() {
    forceRefreshRef.current = true
    setIsForceRefreshing(true)
    await refetch()
    setIsForceRefreshing(false)
    addNotification({ message: 'Model list refreshed from remote.', type: 'success' })
  }

  async function handleInstallModel(modelName: string) {
    try {
      const res = await api.downloadModel(modelName)
      if (res.success) {
        addNotification({
          message: `Model download initiated for ${modelName}. It may take some time to complete.`,
          type: 'success',
        })
      }
    } catch (error) {
      console.error('Error installing model:', error)
      addNotification({
        message: `There was an error installing the model: ${modelName}. Please try again.`,
        type: 'error',
      })
    }
  }

  async function handleDeleteModel(modelName: string) {
    try {
      const res = await api.deleteModel(modelName)
      if (res.success) {
        addNotification({
          message: `Model deleted: ${modelName}.`,
          type: 'success',
        })
      }
      closeAllModals()
      router.reload()
    } catch (error) {
      console.error('Error deleting model:', error)
      addNotification({
        message: `There was an error deleting the model: ${modelName}. Please try again.`,
        type: 'error',
      })
    }
  }

  async function confirmDeleteModel(model: string) {
    openModal(
      <StyledModal
        title="Delete Model?"
        onConfirm={() => {
          handleDeleteModel(model)
        }}
        onCancel={closeAllModals}
        open={true}
        confirmText="Delete"
        cancelText="Cancel"
        confirmVariant="primary"
      >
        <p className="text-text-primary">
          Are you sure you want to delete this model? You will need to download it again if you want
          to use it in the future.
        </p>
      </StyledModal>,
      'confirm-delete-model-modal'
    )
  }

  const updateSettingMutation = useMutation({
    mutationFn: async ({
      key,
      value,
    }: {
      key: string
      value: boolean | string
      requiresReinstall?: boolean
      settingLabel?: string
    }) => {
      return await api.updateSetting(key, value)
    },
    onSuccess: (_data, variables) => {
      addNotification({
        message: 'Setting updated successfully.',
        type: 'success',
      })
      if (variables.requiresReinstall) {
        promptReinstallForSettingChange(variables.settingLabel ?? 'This setting')
      }
    },
    onError: (error) => {
      console.error('Error updating setting:', error)
      addNotification({
        message: 'There was an error updating the setting. Please try again.',
        type: 'error',
      })
    },
  })

  function parseTagSize(size: string): number {
    if (!size || size === 'Unknown' || size === 'N/A') return 0
    const multiplier = size.endsWith('KB')
      ? 1 / 1_000
      : size.endsWith('MB')
        ? 1 / 1_000_000
        : size.endsWith('GB')
          ? 1
          : size.endsWith('TB')
            ? 1_000
            : 0
    return parseFloat(size) * multiplier
  }

  function getSortedTags(
    modelName: string,
    tags: (typeof props.models.availableModels)[0]['tags']
  ) {
    const by = tagSortBy[modelName] || 'size'
    const dir = tagSortDir[modelName] || 'asc'
    return [...tags].sort((a, b) => {
      let cmp: number
      if (by === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else {
        cmp = parseTagSize(a.size) - parseTagSize(b.size)
      }
      return dir === 'desc' ? -cmp : cmp
    })
  }

  function toggleTagSort(modelName: string, by: 'size' | 'name') {
    const currentBy = tagSortBy[modelName]
    const currentDir = tagSortDir[modelName]
    if (currentBy === by) {
      setTagSortDir({ ...tagSortDir, [modelName]: currentDir === 'asc' ? 'desc' : 'asc' })
    } else {
      setTagSortBy({ ...tagSortBy, [modelName]: by })
      setTagSortDir({ ...tagSortDir, [modelName]: 'asc' })
    }
  }

  return (
    <SettingsLayout>
      <Head title={`${aiAssistantName} Settings | Project NOMAD`} />
      <div className="xl:pl-72 w-full">
        <main className="px-4 sm:px-6 lg:px-12 py-6">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold mb-4">{aiAssistantName}</h1>
          <p className="text-text-muted mb-4">
            Easily manage the {aiAssistantName}'s settings and installed models. We recommend
            starting with smaller models first to see how they perform on your system before moving
            on to larger ones.
          </p>
          {!isInstalled && (
            <Alert
              title={`${aiAssistantName}'s dependencies are not installed. Please install them to manage AI models.`}
              type="warning"
              variant="solid"
              className="!mt-6"
            />
          )}
          {isInstalled &&
            systemInfo?.gpuHealth?.status === 'passthrough_failed' &&
            !gpuBannerDismissed && (
              <Alert
                type="warning"
                variant="bordered"
                title="GPU Not Accessible"
                message={`Your system has ${systemInfo?.gpuHealth?.gpuVendor === 'amd' ? 'an AMD' : 'an NVIDIA'} GPU, but ${aiAssistantName} can't access it. AI is running on CPU only, which is significantly slower.`}
                className="!mt-6"
                dismissible={true}
                onDismiss={handleDismissGpuBanner}
                buttonProps={{
                  children: `Fix: Reinstall ${aiAssistantName}`,
                  icon: 'IconRefresh',
                  variant: 'action',
                  size: 'sm',
                  onClick: handleForceReinstallOllama,
                  loading: reinstalling,
                  disabled: reinstalling,
                }}
              />
            )}

          <StyledSectionHeader title="Settings" className="mt-8 mb-4" />
          <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-4 sm:p-6">
            <div className="space-y-4">
              <Switch
                checked={chatSuggestionsEnabled}
                onChange={(newVal) => {
                  setChatSuggestionsEnabled(newVal)
                  updateSettingMutation.mutate({ key: 'chat.suggestionsEnabled', value: newVal })
                }}
                label="Chat Suggestions"
                description="Display AI-generated conversation starters in the chat interface"
              />
              <Switch
                checked={ollamaFlashAttention}
                onChange={(newVal) => {
                  setOllamaFlashAttention(newVal)
                  updateSettingMutation.mutate({
                    key: 'ai.ollamaFlashAttention',
                    value: newVal,
                    requiresReinstall: true,
                    settingLabel: 'Flash Attention',
                  })
                }}
                label="Flash Attention"
                description="Enables OLLAMA_FLASH_ATTENTION=1 for improved memory efficiency. Disable if you experience instability. Takes effect after reinstalling the AI Assistant."
              />
              <Select
                name="ollamaKvCacheType"
                label="KV Cache Quantization"
                value={ollamaKvCacheType || 'f16'}
                onChange={(val) => {
                  setOllamaKvCacheType(val)
                  updateSettingMutation.mutate({
                    key: 'ai.ollamaKvCacheType',
                    value: val,
                    requiresReinstall: true,
                    settingLabel: 'KV Cache Quantization',
                  })
                }}
                options={[
                  { value: 'f16', label: 'FP16 (default, most VRAM, best quality)' },
                  { value: 'q8_0', label: 'INT8 q8_0 (half VRAM, negligible quality loss)' },
                  { value: 'q4_0', label: 'INT4 q4_0 (quarter VRAM, modest quality loss)' },
                  { value: 'q4_1', label: 'q4_1 (quarter VRAM, slightly better than q4_0)' },
                  { value: 'q5_0', label: 'q5_0 (between q4_0 and q8_0)' },
                  { value: 'q5_1', label: 'q5_1 (between q4_1 and q8_0)' },
                  { value: 'iq4_nl', label: 'iq4_nl (4-bit, non-linear, model-dependent)' },
                ]}
                helpText="Quantizes the KV (context) cache to reduce VRAM. Requires Flash Attention to take effect — Ollama silently falls back to FP16 otherwise. q8_0 is the safe default (half the cache VRAM, near-zero quality loss); q4_0 quarters it with modest loss. Takes effect after reinstalling the AI Assistant."
              />
              <Switch
                checked={autoThinking}
                onChange={(newVal) => {
                  setAutoThinking(newVal)
                  updateSettingMutation.mutate({ key: 'ai.autoThinking', value: newVal })
                }}
                label="Use thinking automatically when a model supports it"
                description="Sets the default for models that can think. You can still turn thinking on or off for an individual model in the chat window."
              />
              <Input
                name="ollamaNumCtx"
                label="Context window (tokens)"
                type="number"
                helpText="The context window (num_ctx) sent to Ollama on every chat request. Larger values fit longer conversations and more RAG context, but allocate a bigger KV cache (more VRAM). Lower this for large models that would otherwise run out of VRAM. Empty = default 262144 (256k)."
                placeholder="262144"
                value={ollamaNumCtx}
                onChange={(e) => setOllamaNumCtx(e.target.value)}
                onBlur={() =>
                  updateSettingMutation.mutate({
                    key: 'ai.ollamaNumCtx',
                    value: ollamaNumCtx,
                  })
                }
              />
              <Input
                name="aiAssistantCustomName"
                label="Assistant Name"
                helpText="Give your AI assistant a custom name that will be used in the chat interface and other areas of the application."
                placeholder="AI Assistant"
                value={aiAssistantCustomName}
                onChange={(e) => setAiAssistantCustomName(e.target.value)}
                onBlur={() =>
                  updateSettingMutation.mutate({
                    key: 'ai.assistantCustomName',
                    value: aiAssistantCustomName,
                  })
                }
              />
            </div>
          </div>

          <div className="mt-12">
            <button
              type="button"
              onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
              className="w-full flex items-center justify-between p-4 bg-surface-primary rounded-lg border-2 border-border-subtle hover:bg-surface-secondary transition-colors"
            >
              <div className="flex items-center gap-3 text-left">
                <div className="w-1 h-6 bg-desert-green" />
                <div>
                  <h2 className="text-2xl font-bold text-desert-green">
                    Advanced Indexing &amp; Embedding
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    Fine-tune how knowledge-base content is chunked, embedded, and stored. Defaults
                    work well for most systems — only change these if you understand the tradeoffs.
                  </p>
                </div>
              </div>
              <IconChevronDown
                className={`w-6 h-6 text-desert-green shrink-0 transition-transform ml-4 ${
                  showAdvancedSettings ? 'rotate-180' : ''
                }`}
              />
            </button>

            {showAdvancedSettings && (
              <div className="bg-surface-primary rounded-lg border-2 border-border-subtle border-t-0 p-4 sm:p-6 space-y-4">
                <Input
                  name="embedPauseAfterChatMinutes"
                  label="Embedding pause after chat (minutes)"
                  type="number"
                  helpText="When you send a chat message, background embedding pauses for this many minutes so chat inference isn't slowed by embedding work. 0 = resume immediately. Default 15."
                  placeholder="15"
                  value={embedPauseAfterChatMinutes}
                  onChange={(e) => setEmbedPauseAfterChatMinutes(e.target.value)}
                  onBlur={() =>
                    updateSettingMutation.mutate({
                      key: 'rag.embedPauseAfterChatMinutes',
                      value: embedPauseAfterChatMinutes,
                    })
                  }
                />
                <Input
                  name="embeddingBatchSize"
                  label="Embedding batch size"
                  type="number"
                  helpText="Chunks per embed request sent to TEI/Ollama. Each chunk is ~2000 tokens after capping. TEI auto-sub-batches to respect its token limit, so higher values are safe but may increase latency. Default 8."
                  placeholder="8"
                  value={embeddingBatchSize}
                  onChange={(e) => setEmbeddingBatchSize(e.target.value)}
                  onBlur={() =>
                    updateSettingMutation.mutate({
                      key: 'rag.embeddingBatchSize',
                      value: embeddingBatchSize,
                    })
                  }
                />
                <Input
                  name="embedConcurrency"
                  label="Embed concurrency"
                  type="number"
                  helpText="Concurrent embed requests sent to TEI per flush. Each request carries up to the batch size above. Higher keeps the GPU fed; lower if you see HTTP 429s or OOM. Default 16."
                  placeholder="16"
                  value={embedConcurrency}
                  onChange={(e) => setEmbedConcurrency(e.target.value)}
                  onBlur={() =>
                    updateSettingMutation.mutate({
                      key: 'rag.embedConcurrency',
                      value: embedConcurrency,
                    })
                  }
                />
                <Input
                  name="maxConcurrentEmbeds"
                  label="Max concurrent embed flushes"
                  type="number"
                  helpText="Concurrent flushes in flight during ZIM streaming. Higher overlaps CPU article extraction with GPU embedding, but uses more memory. Default 4."
                  placeholder="4"
                  value={maxConcurrentEmbeds}
                  onChange={(e) => setMaxConcurrentEmbeds(e.target.value)}
                  onBlur={() =>
                    updateSettingMutation.mutate({
                      key: 'rag.maxConcurrentEmbeds',
                      value: maxConcurrentEmbeds,
                    })
                  }
                />
                <Input
                  name="qdrantUpsertConcurrency"
                  label="Qdrant upsert concurrency"
                  type="number"
                  helpText="Concurrent batched writes to the Qdrant vector database. Higher parallelizes vector storage; lower if Qdrant is overwhelmed. Default 8."
                  placeholder="8"
                  value={qdrantUpsertConcurrency}
                  onChange={(e) => setQdrantUpsertConcurrency(e.target.value)}
                  onBlur={() =>
                    updateSettingMutation.mutate({
                      key: 'rag.qdrantUpsertConcurrency',
                      value: qdrantUpsertConcurrency,
                    })
                  }
                />
                <Input
                  name="zimWorkerCount"
                  label="ZIM worker threads"
                  type="number"
                  helpText="Threads for parallel HTML parsing during ZIM ingestion. 0 = auto-detect (min(CPU cores - 1, 8)). Default 0."
                  placeholder="0"
                  value={zimWorkerCount}
                  onChange={(e) => setZimWorkerCount(e.target.value)}
                  onBlur={() =>
                    updateSettingMutation.mutate({
                      key: 'rag.zimWorkerCount',
                      value: zimWorkerCount,
                    })
                  }
                />
                <Input
                  name="qdrantIndexingThreshold"
                  label="Qdrant indexing threshold"
                  type="number"
                  helpText="Defers HNSW indexing during bulk ingest for faster writes. Set very high (e.g. 1000000) during large ingests, then clear or set to 20000 afterward to trigger indexing. Empty = Qdrant default (20000)."
                  placeholder=""
                  value={qdrantIndexingThreshold}
                  onChange={(e) => setQdrantIndexingThreshold(e.target.value)}
                  onBlur={() =>
                    updateSettingMutation.mutate({
                      key: 'rag.qdrantIndexingThreshold',
                      value: qdrantIndexingThreshold,
                    })
                  }
                />
                <Input
                  name="teiIdleStopMinutes"
                  label="TEI idle auto-stop (minutes)"
                  type="number"
                  helpText="Stop TEI (frees ~1GB VRAM) after this many minutes of no chat/embedding activity. TEI restarts automatically when you open chat or an embedding job starts. 0 = TEI always on. Default 5."
                  placeholder="5"
                  value={teiIdleStopMinutes}
                  onChange={(e) => setTeiIdleStopMinutes(e.target.value)}
                  onBlur={() =>
                    updateSettingMutation.mutate({
                      key: 'rag.teiIdleStopMinutes',
                      value: teiIdleStopMinutes,
                    })
                  }
                />
              </div>
            )}
          </div>

          <StyledSectionHeader title="Installed Models" className="mt-12 mb-4" />
          <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-4 sm:p-6">
            {props.models.installedModels.length === 0 ? (
              <p className="text-text-muted">
                No models installed. Browse the model catalog below to get started.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border-subtle">
                  <thead>
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                        Model
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                        Parameters
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                        Disk Size
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {props.models.installedModels.map((model) => (
                      <tr key={model.name} className="hover:bg-surface-secondary">
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-text-primary">
                            {model.name}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-text-secondary">
                            {model.details?.parameter_size || 'N/A'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-text-secondary">
                            {formatBytes(model.size)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <StyledButton
                            variant="danger"
                            size="sm"
                            onClick={() => confirmDeleteModel(model.name)}
                            icon="IconTrash"
                          >
                            Delete
                          </StyledButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <StyledSectionHeader title="Remote Connection" className="mt-8 mb-4" />
          <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-4 sm:p-6">
            <p className="text-sm text-text-secondary mb-4">
              Connect to any OpenAI-compatible API server — Ollama, LM Studio, llama.cpp, and others
              are all supported. For remote Ollama instances, the host must be started with{' '}
              <code className="bg-surface-secondary px-1 rounded">OLLAMA_HOST=0.0.0.0</code>.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
              <div className="flex-1">
                <Input
                  name="remoteOllamaUrl"
                  label="Remote Ollama/OpenAI API URL"
                  placeholder="http://192.168.1.100:11434  (or :1234 for OpenAI API Compatible Apps)"
                  value={remoteOllamaUrl}
                  onChange={(e) => {
                    setRemoteOllamaUrl(e.target.value)
                    setRemoteOllamaError(null)
                  }}
                />
                {remoteOllamaError && (
                  <p className="text-sm text-red-600 mt-1">{remoteOllamaError}</p>
                )}
              </div>
              <StyledButton
                variant="primary"
                onClick={handleSaveRemoteOllama}
                loading={remoteOllamaSaving}
                disabled={remoteOllamaSaving || !remoteOllamaUrl}
                className="mb-0.5 w-full sm:w-auto"
              >
                Save &amp; Test
              </StyledButton>
              {props.models.settings.remoteOllamaUrl && (
                <StyledButton
                  variant="danger"
                  onClick={handleClearRemoteOllama}
                  loading={remoteOllamaSaving}
                  disabled={remoteOllamaSaving}
                  className="mb-0.5 w-full sm:w-auto"
                >
                  Clear
                </StyledButton>
              )}
            </div>
          </div>

          <ActiveModelDownloads withHeader />

          <StyledSectionHeader title="Models" className="mt-12 mb-4" />
          <Alert
            type="info"
            variant="bordered"
            title="Model downloading is only supported when using a Ollama backend."
            message="If you are connected to an OpenAI API host (e.g. LM Studio), please download models directly in that application."
            className="mb-4"
          />
          <div className="flex flex-col sm:flex-row justify-start items-stretch sm:items-center gap-3 mt-4">
            <Input
              name="search"
              label=""
              placeholder="Search language models.."
              value={queryUI}
              onChange={(e) => {
                setQueryUI(e.target.value)
                debouncedSetQuery(e.target.value)
              }}
              className="w-full sm:w-1/3"
              leftIcon={<IconSearch className="w-5 h-5 text-text-muted" />}
            />
            <Select
              name="modelSort"
              label=""
              value={sortBy}
              onChange={(val) => setSortBy(val as 'pulls' | 'name' | 'recent')}
              options={[
                { value: 'pulls', label: 'Most pulled' },
                { value: 'recent', label: 'Recently updated' },
                { value: 'name', label: 'Name (A-Z)' },
              ]}
              className="w-full sm:w-48"
            />
            <StyledButton
              variant="secondary"
              onClick={handleForceRefresh}
              icon="IconRefresh"
              loading={isForceRefreshing}
              className="mt-1"
            >
              Refresh Models
            </StyledButton>
          </div>
          <StyledTable<NomadOllamaModel>
            className="font-semibold mt-4"
            rowLines={true}
            columns={[
              {
                accessor: 'name',
                title: 'Name',
                render(record) {
                  return (
                    <div className="flex flex-col">
                      <p className="text-lg font-semibold">{record.name}</p>
                      <p className="text-sm text-text-muted">{record.description}</p>
                    </div>
                  )
                },
              },
              {
                accessor: 'estimated_pulls',
                title: 'Estimated Pulls',
              },
              {
                accessor: 'model_last_updated',
                title: 'Last Updated',
              },
            ]}
            data={availableModelData?.models || []}
            loading={isFetching}
            expandable={{
              expandedRowRender: (record) => (
                <div className="pl-14">
                  <div className="bg-surface-primary overflow-hidden">
                    <table className="min-w-full divide-y divide-border-subtle">
                      <thead className="bg-surface-primary">
                        <tr>
                          <th
                            className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-primary select-none"
                            onClick={() => toggleTagSort(record.name, 'name')}
                          >
                            Tag{' '}
                            {tagSortBy[record.name] === 'name' &&
                              (tagSortDir[record.name] === 'desc' ? '↓' : '↑')}
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                            Input Type
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                            Context Size
                          </th>
                          <th
                            className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-primary select-none"
                            onClick={() => toggleTagSort(record.name, 'size')}
                          >
                            Model Size{' '}
                            {tagSortBy[record.name] === 'size' &&
                              (tagSortDir[record.name] === 'desc' ? '↓' : '↑')}
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-surface-primary divide-y divide-border-subtle">
                        {getSortedTags(record.name, record.tags).map((tag, tagIndex) => {
                          const isInstalled = props.models.installedModels.some(
                            (mod) => mod.name === tag.name
                          )
                          return (
                            <tr key={tagIndex} className="hover:bg-surface-secondary">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="text-sm font-medium text-text-primary">
                                  {tag.name}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="text-sm text-text-secondary">
                                  {tag.input || 'N/A'}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="text-sm text-text-secondary">
                                  {tag.context || 'N/A'}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="text-sm text-text-secondary">
                                  {tag.size || 'N/A'}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <StyledButton
                                  variant={isInstalled ? 'danger' : 'primary'}
                                  onClick={() => {
                                    if (!isInstalled) {
                                      handleInstallModel(tag.name)
                                    } else {
                                      confirmDeleteModel(tag.name)
                                    }
                                  }}
                                  icon={isInstalled ? 'IconTrash' : 'IconDownload'}
                                >
                                  {isInstalled ? 'Delete' : 'Install'}
                                </StyledButton>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ),
            }}
          />
          <div className="flex justify-center mt-6">
            {availableModelData?.hasMore && (
              <StyledButton
                variant="primary"
                onClick={() => {
                  setLimit((prev) => prev + 15)
                }}
              >
                Load More
              </StyledButton>
            )}
          </div>
        </main>
      </div>
    </SettingsLayout>
  )
}
