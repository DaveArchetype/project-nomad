import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '~/lib/api'
import { useSystemSetting } from '~/hooks/useSystemSetting'
import { DEFAULT_QUERY_REWRITE_MODEL } from '../../../../constants/ollama'
import { NomadInstalledModel } from '../../../../types/ollama'

interface UseChatModelsResult {
  installedModels: NomadInstalledModel[]
  isLoadingModels: boolean
  pendingModelSwitch: string | null
  handleUserSelectedModel: (model: string) => void
  handleConfirmModelSwitch: () => Promise<void>
  handleCancelModelSwitch: () => void
  selectedModelSupportsThinking: boolean
  selectedModelSupportsVision: boolean
  selectedModelSupportsTools: boolean
  effectiveThinking: (model: string) => boolean
  setModelThinking: (model: string, value: boolean) => void
  rewriteModelAvailable: boolean
  remoteOllamaUrlSetting: { value?: any } | undefined
  remoteStatus: { connected?: boolean } | undefined
}

interface UseChatModelsArgs {
  enabled: boolean
  activeSessionId: string | null
  selectedModel: string
  setSelectedModel: (model: string) => void
  abortStream: () => void
}

export function useChatModels({
  enabled,
  activeSessionId,
  selectedModel,
  setSelectedModel,
  abortStream,
}: UseChatModelsArgs): UseChatModelsResult {
  const [pendingModelSwitch, setPendingModelSwitch] = useState<string | null>(null)
  const [thinkingOverrides, setThinkingOverrides] = useState<Record<string, boolean>>({})
  const pageLoadNormalizedRef = useRef(false)

  const { data: lastModelSetting } = useSystemSetting({ key: 'chat.lastModel', enabled })
  const { data: remoteOllamaUrlSetting } = useSystemSetting({ key: 'ai.remoteOllamaUrl', enabled })
  const { data: autoThinkingSetting } = useSystemSetting({ key: 'ai.autoThinking', enabled })

  const autoThinkingDefault =
    autoThinkingSetting?.value === true || autoThinkingSetting?.value === 'true'

  const { data: remoteStatus } = useQuery({
    queryKey: ['remoteOllamaStatus'],
    queryFn: () => api.getRemoteOllamaStatus(),
    enabled: enabled && !!remoteOllamaUrlSetting?.value,
    refetchInterval: 15000,
  })

  const { data: installedModels = [], isLoading: isLoadingModels } = useQuery({
    queryKey: ['installedModels'],
    queryFn: () => api.getInstalledModels(),
    enabled,
    select: (data) => data || [],
  })

  useEffect(() => {
    if (installedModels.length === 0) return
    const next: Record<string, boolean> = {}
    for (const m of installedModels) {
      try {
        const stored = localStorage.getItem(`nomad:thinking:${m.name}`)
        if (stored !== null) next[m.name] = stored === 'true'
      } catch {}
    }
    setThinkingOverrides(next)
  }, [installedModels])

  const selectedModelSupportsThinking =
    installedModels.find((m) => m.name === selectedModel)?.thinking === true

  const selectedModelSupportsVision =
    installedModels.find((m) => m.name === selectedModel)?.vision === true

  const selectedModelSupportsTools =
    installedModels.find((m) => m.name === selectedModel)?.tools === true

  const effectiveThinking = useCallback(
    (model: string): boolean =>
      model in thinkingOverrides ? thinkingOverrides[model] : autoThinkingDefault,
    [thinkingOverrides, autoThinkingDefault]
  )

  const setModelThinking = useCallback((model: string, value: boolean) => {
    setThinkingOverrides((prev) => ({ ...prev, [model]: value }))
    try {
      localStorage.setItem(`nomad:thinking:${model}`, String(value))
    } catch {}
  }, [])

  const rewriteModelAvailable = useMemo(() => {
    return installedModels.some((model) => model.name === DEFAULT_QUERY_REWRITE_MODEL)
  }, [installedModels])

  useEffect(() => {
    if (installedModels.length > 0 && !selectedModel) {
      const lastModel = lastModelSetting?.value as string | undefined
      if (lastModel && installedModels.some((m) => m.name === lastModel)) {
        setSelectedModel(lastModel)
      } else {
        setSelectedModel(installedModels[0].name)
      }
    }
  }, [installedModels, selectedModel, lastModelSetting, setSelectedModel])

  useEffect(() => {
    if (selectedModel) {
      api.updateSetting('chat.lastModel', selectedModel)
    }
  }, [selectedModel])

  useEffect(() => {
    if (!enabled) return
    if (!selectedModel) return
    if (pageLoadNormalizedRef.current) return
    pageLoadNormalizedRef.current = true
    api.unloadChatModels(selectedModel).catch((err) => {
      console.warn('Failed to normalize loaded models on chat-page mount:', err)
    })
  }, [enabled, selectedModel])

  const handleUserSelectedModel = useCallback(
    (newModel: string) => {
      if (newModel === selectedModel) return
      if (!activeSessionId) {
        setSelectedModel(newModel)
        return
      }
      setPendingModelSwitch(newModel)
    },
    [selectedModel, activeSessionId, setSelectedModel]
  )

  const handleConfirmModelSwitch = useCallback(async () => {
    const newModel = pendingModelSwitch
    if (!newModel) return
    abortStream()
    setSelectedModel(newModel)
    setPendingModelSwitch(null)
    api.unloadChatModels(newModel, true).catch((err) => {
      console.warn('Failed to unload previous chat model:', err)
    })
    if (activeSessionId) {
      api.updateChatSession(activeSessionId, { model: newModel }).catch((err) => {
        console.warn('Failed to update session model:', err)
      })
    }
  }, [pendingModelSwitch, abortStream, setSelectedModel, activeSessionId])

  const handleCancelModelSwitch = useCallback(() => {
    setPendingModelSwitch(null)
  }, [])

  return {
    installedModels,
    isLoadingModels,
    pendingModelSwitch,
    handleUserSelectedModel,
    handleConfirmModelSwitch,
    handleCancelModelSwitch,
    selectedModelSupportsThinking,
    selectedModelSupportsVision,
    selectedModelSupportsTools,
    effectiveThinking,
    setModelThinking,
    rewriteModelAvailable,
    remoteOllamaUrlSetting,
    remoteStatus,
  }
}
