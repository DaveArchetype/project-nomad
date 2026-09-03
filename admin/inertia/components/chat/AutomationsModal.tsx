import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  IconX,
  IconPlus,
  IconTrash,
  IconPlayerPlay,
  IconRefresh,
  IconExternalLink,
} from '@tabler/icons-react'
import StyledButton from '~/components/StyledButton'
import { useNotifications } from '~/context/NotificationContext'
import { useReverseProxyBaseDomain } from '~/hooks/useReverseProxyBaseDomain'
import { getServiceLink } from '~/lib/navigation'
import api from '~/lib/api'
import type { Automation, AutomationTool, CreateAutomationInput } from '~/lib/api/automations'

interface AutomationsModalProps {
  onClose: () => void
}

export default function AutomationsModal({ onClose }: AutomationsModalProps) {
  const queryClient = useQueryClient()
  const { addNotification } = useNotifications()
  const reverseProxyBaseDomain = useReverseProxyBaseDomain()
  const n8nUrl = getServiceLink('8540', undefined, '/n8n', reverseProxyBaseDomain)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<CreateAutomationInput>({
    name: '',
    prompt: '',
    scheduleCron: '0 15 * * *',
    tools: [],
    deliverToChat: true,
    targetChatSessionId: 'new',
  })

  const { data: status } = useQuery({
    queryKey: ['automation-status'],
    queryFn: () => api.getAutomationStatus(),
  })

  const { data: automationsData, isLoading } = useQuery({
    queryKey: ['automations'],
    queryFn: () => api.listAutomations(),
    enabled: status?.n8nInstalled,
  })

  const { data: toolsData } = useQuery({
    queryKey: ['automation-tools'],
    queryFn: () => api.listAutomationTools(),
    enabled: status?.n8nInstalled,
  })

  const { data: defaultModelData } = useQuery({
    queryKey: ['automation-default-model'],
    queryFn: () => api.getAutomationDefaultModel(),
    enabled: status?.n8nInstalled,
  })

  const { data: chatsData } = useQuery({
    queryKey: ['automation-chats'],
    queryFn: () => api.listAutomationChats(),
    enabled: status?.n8nInstalled,
  })

  const createMutation = useMutation({
    mutationFn: (input: CreateAutomationInput) => api.createAutomation(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] })
      setShowForm(false)
      resetForm()
      addNotification({ message: 'Automation created', type: 'success', duration: 3000 })
    },
    onError: (err: any) => {
      addNotification({
        message: `Failed to create: ${err?.message ?? 'unknown error'}`,
        type: 'error',
        duration: 5000,
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CreateAutomationInput> }) =>
      api.updateAutomation(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] })
      setShowForm(false)
      setEditingId(null)
      resetForm()
      addNotification({ message: 'Automation updated', type: 'success', duration: 3000 })
    },
    onError: (err: any) => {
      addNotification({
        message: `Failed to update: ${err?.message ?? 'unknown error'}`,
        type: 'error',
        duration: 5000,
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAutomation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] })
      addNotification({ message: 'Automation deleted', type: 'success', duration: 3000 })
    },
    onError: (err: any) => {
      addNotification({
        message: `Failed to delete: ${err?.message ?? 'unknown error'}`,
        type: 'error',
        duration: 5000,
      })
    },
  })

  const runMutation = useMutation({
    mutationFn: (id: string) => api.runAutomation(id),
    onSuccess: () => {
      addNotification({ message: 'Automation triggered', type: 'success', duration: 3000 })
    },
    onError: (err: any) => {
      addNotification({
        message: `Failed to run: ${err?.message ?? 'unknown error'}`,
        type: 'error',
        duration: 5000,
      })
    },
  })

  function resetForm() {
    setFormData({
      name: '',
      prompt: '',
      scheduleCron: '0 15 * * *',
      tools: [],
      deliverToChat: true,
      targetChatSessionId: 'new',
    })
  }

  function startEdit(automation: Automation) {
    setEditingId(automation.id)
    setShowForm(true)
    setFormData({
      name: automation.name,
      prompt: automation.prompt,
      scheduleCron: automation.scheduleCron,
      model: automation.model,
      tools: automation.tools,
      deliverToChat: automation.deliverToChat,
      targetChatSessionId: automation.targetChatSessionId ?? 'new',
    })
  }

  function handleSubmit() {
    if (!formData.name.trim() || !formData.prompt.trim()) {
      addNotification({ message: 'Name and prompt are required', type: 'error', duration: 3000 })
      return
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, input: formData })
    } else {
      createMutation.mutate(formData)
    }
  }

  function toggleTool(toolName: string) {
    setFormData((prev) => ({
      ...prev,
      tools: prev.tools?.includes(toolName)
        ? prev.tools.filter((t) => t !== toolName)
        : [...(prev.tools ?? []), toolName],
    }))
  }

  const automations = automationsData?.automations ?? []
  const tools = toolsData?.tools ?? []
  const defaultModel = defaultModelData?.defaultModel ?? ''
  const installedModels = defaultModelData?.installedModels ?? []
  const chats = chatsData?.chats ?? []
  const n8nInstalled = status?.n8nInstalled ?? false
  const apiKeyConfigured = status?.n8nApiKeyConfigured ?? false

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm transition-opacity">
      <div className="bg-surface-primary rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-border-subtle shrink-0">
          <div>
            <h2 className="text-2xl font-semibold text-text-primary">Automations</h2>
            <p className="text-sm text-text-muted mt-1">
              Schedule AI prompts to run on a timer and deliver results to chat.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface-secondary rounded-lg transition-colors"
          >
            <IconX className="h-6 w-6 text-text-muted" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          {!n8nInstalled ? (
            <div className="text-center py-12">
              <p className="text-text-muted mb-4">
                The Automations engine (n8n) is not installed yet.
              </p>
              <StyledButton
                variant="primary"
                icon="IconDownload"
                onClick={() => (window.location.href = '/supply-depot')}
              >
                Install from Supply Depot
              </StyledButton>
            </div>
          ) : !apiKeyConfigured ? (
            <div className="text-center py-12">
              <p className="text-text-muted mb-4">
                n8n is installed but the API key isn't configured yet. Open n8n, create an API key
                in Settings → API, then paste it in the Automations settings page.
              </p>
              <div className="flex gap-3 justify-center">
                <StyledButton
                  variant="primary"
                  icon="IconExternalLink"
                  onClick={() => window.open(n8nUrl, '_blank')}
                >
                  Open n8n
                </StyledButton>
                <StyledButton
                  variant="outline"
                  onClick={() => (window.location.href = '/automations')}
                >
                  Open Automations Settings
                </StyledButton>
              </div>
            </div>
          ) : isLoading ? (
            <div className="py-16 text-center text-text-muted">Loading…</div>
          ) : showForm ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface-primary text-text-primary text-sm"
                  placeholder="e.g. Daily Topic Suggestions"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">Prompt</label>
                <textarea
                  value={formData.prompt}
                  onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface-primary text-text-primary text-sm resize-y"
                  placeholder="The prompt to run on schedule"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Schedule (cron)
                </label>
                <input
                  type="text"
                  value={formData.scheduleCron ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, scheduleCron: e.target.value || null })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface-primary text-text-primary text-sm font-mono"
                  placeholder="0 15 * * * (leave empty for manual only)"
                />
                <p className="text-xs text-text-muted mt-1">
                  Format: minute hour day month weekday. Empty = manual only.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">Model</label>
                <select
                  value={formData.model ?? ''}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value || undefined })}
                  className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface-primary text-text-primary text-sm"
                >
                  <option value="">
                    {defaultModel ? `Default (${defaultModel})` : 'Default (current chat model)'}
                  </option>
                  {installedModels.map((model: string) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>
              {tools.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">Tools</label>
                  <div className="flex flex-wrap gap-2">
                    {tools.map((tool: AutomationTool) => (
                      <button
                        key={tool.name}
                        type="button"
                        onClick={() => toggleTool(tool.name)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          formData.tools?.includes(tool.name)
                            ? 'bg-desert-green text-white'
                            : 'bg-surface-secondary text-text-muted hover:bg-surface-elevated'
                        }`}
                      >
                        {tool.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Output destination
                </label>
                <div className="flex items-center gap-2 mb-2">
                  <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={formData.deliverToChat !== false}
                      onChange={(e) =>
                        setFormData({ ...formData, deliverToChat: e.target.checked })
                      }
                    />
                    Deliver to chat
                  </label>
                </div>
                {formData.deliverToChat !== false && (
                  <select
                    value={formData.targetChatSessionId ?? 'new'}
                    onChange={(e) =>
                      setFormData({ ...formData, targetChatSessionId: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface-primary text-text-primary text-sm"
                  >
                    <option value="new">New chat (auto-created)</option>
                    {chats.map((chat: any) => (
                      <option key={chat.id} value={String(chat.id)}>
                        {chat.title}
                      </option>
                    ))}
                  </select>
                )}
                {formData.deliverToChat === false && (
                  <p className="text-xs text-text-muted py-2">
                    Output will not be posted to any chat. The automation runs silently.
                  </p>
                )}
              </div>
            </div>
          ) : automations.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              No automations yet. Create one to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {automations.map((automation: Automation) => (
                <div
                  key={automation.id}
                  className="rounded-lg border border-border-subtle p-4 hover:border-border-default transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-text-primary truncate">
                          {automation.name}
                        </h3>
                        {automation.isDefault && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-desert-green/10 text-desert-green font-medium">
                            default
                          </span>
                        )}
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            automation.active
                              ? 'bg-green-500/10 text-green-600'
                              : 'bg-surface-secondary text-text-muted'
                          }`}
                        >
                          {automation.active ? 'active' : 'inactive'}
                        </span>
                      </div>
                      <p className="text-sm text-text-muted mt-1 line-clamp-2">
                        {automation.prompt}
                      </p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
                        <span>{automation.scheduleCron ?? 'manual'}</span>
                        <span>·</span>
                        <span>{automation.model || 'default model'}</span>
                        {automation.tools.length > 0 && (
                          <>
                            <span>·</span>
                            <span>{automation.tools.join(', ')}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <StyledButton
                      variant="outline"
                      size="sm"
                      icon="IconPlayerPlay"
                      onClick={() => runMutation.mutate(automation.id)}
                      loading={runMutation.isPending}
                    >
                      Run
                    </StyledButton>
                    <StyledButton
                      variant="ghost"
                      size="sm"
                      icon="IconPencil"
                      onClick={() => startEdit(automation)}
                    >
                      Edit
                    </StyledButton>
                    <StyledButton
                      variant="ghost"
                      size="sm"
                      icon="IconTrash"
                      onClick={() => {
                        if (confirm(`Delete "${automation.name}"?`)) {
                          deleteMutation.mutate(automation.id)
                        }
                      }}
                    >
                      Delete
                    </StyledButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {n8nInstalled && apiKeyConfigured && (
          <div className="flex items-center justify-between gap-3 p-6 border-t border-border-subtle shrink-0">
            <StyledButton
              variant="ghost"
              size="sm"
              icon="IconExternalLink"
              onClick={() => window.open(n8nUrl, '_blank')}
            >
              Open n8n
            </StyledButton>
            <div className="flex items-center gap-3">
              {showForm && (
                <StyledButton
                  variant="outline"
                  onClick={() => {
                    setShowForm(false)
                    setEditingId(null)
                    resetForm()
                  }}
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  Cancel
                </StyledButton>
              )}
              <StyledButton
                variant="primary"
                icon={showForm ? 'IconCircleCheck' : 'IconPlus'}
                onClick={() => {
                  if (showForm) {
                    handleSubmit()
                  } else {
                    resetForm()
                    setEditingId(null)
                    setShowForm(true)
                  }
                }}
                loading={createMutation.isPending || updateMutation.isPending}
              >
                {showForm ? 'Save' : 'New Automation'}
              </StyledButton>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
