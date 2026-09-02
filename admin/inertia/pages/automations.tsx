import { Head } from '@inertiajs/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  IconPlus,
  IconTrash,
  IconPlayerPlay,
  IconExternalLink,
  IconX,
  IconAutomation,
  IconKey,
} from '@tabler/icons-react'
import AppLayout from '~/layouts/AppLayout'
import StyledButton from '~/components/StyledButton'
import { useNotifications } from '~/context/NotificationContext'
import api from '~/lib/api'
import type { Automation, AutomationTool, CreateAutomationInput } from '~/lib/api/automations'

type AutomationsPageProps = {
  automations: {
    n8nInstalled: boolean
    enabled: boolean
    n8nApiKeyConfigured: boolean
  }
}

export default function AutomationsPage(props: AutomationsPageProps) {
  const queryClient = useQueryClient()
  const { addNotification } = useNotifications()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [formData, setFormData] = useState<CreateAutomationInput>({
    name: '',
    prompt: '',
    scheduleCron: '0 15 * * *',
    tools: [],
    targetChatSessionId: 'new',
  })

  const n8nInstalled = props.automations.n8nInstalled
  const apiKeyConfigured = props.automations.n8nApiKeyConfigured

  const { data: automationsData, isLoading } = useQuery({
    queryKey: ['automations'],
    queryFn: () => api.listAutomations(),
    enabled: n8nInstalled && apiKeyConfigured,
  })

  const { data: toolsData } = useQuery({
    queryKey: ['automation-tools'],
    queryFn: () => api.listAutomationTools(),
    enabled: n8nInstalled && apiKeyConfigured,
  })

  const { data: defaultModelData } = useQuery({
    queryKey: ['automation-default-model'],
    queryFn: () => api.getAutomationDefaultModel(),
    enabled: n8nInstalled && apiKeyConfigured,
  })

  const { data: chatsData } = useQuery({
    queryKey: ['automation-chats'],
    queryFn: () => api.listAutomationChats(),
    enabled: n8nInstalled && apiKeyConfigured,
  })

  const createMutation = useMutation({
    mutationFn: (input: CreateAutomationInput) => api.createAutomation(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] })
      setShowForm(false)
      resetForm()
      addNotification({ message: 'Automation created', type: 'success', duration: 3000 })
    },
    onError: (err: any) =>
      addNotification({
        message: `Failed to create: ${err?.message ?? 'unknown error'}`,
        type: 'error',
        duration: 5000,
      }),
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
    onError: (err: any) =>
      addNotification({
        message: `Failed to update: ${err?.message ?? 'unknown error'}`,
        type: 'error',
        duration: 5000,
      }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAutomation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] })
      addNotification({ message: 'Automation deleted', type: 'success', duration: 3000 })
    },
    onError: (err: any) =>
      addNotification({
        message: `Failed to delete: ${err?.message ?? 'unknown error'}`,
        type: 'error',
        duration: 5000,
      }),
  })

  const runMutation = useMutation({
    mutationFn: (id: string) => api.runAutomation(id),
    onSuccess: () =>
      addNotification({ message: 'Automation triggered', type: 'success', duration: 3000 }),
    onError: (err: any) =>
      addNotification({
        message: `Failed to run: ${err?.message ?? 'unknown error'}`,
        type: 'error',
        duration: 5000,
      }),
  })

  const apiKeyMutation = useMutation({
    mutationFn: (key: string) => api.saveN8nApiKey(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-status'] })
      queryClient.invalidateQueries({ queryKey: ['automations'] })
      setShowApiKeyInput(false)
      setApiKey('')
      addNotification({ message: 'API key saved', type: 'success', duration: 3000 })
    },
    onError: (err: any) =>
      addNotification({
        message: `Failed to save key: ${err?.message ?? 'unknown error'}`,
        type: 'error',
        duration: 5000,
      }),
  })

  function resetForm() {
    setFormData({
      name: '',
      prompt: '',
      scheduleCron: '0 15 * * *',
      tools: [],
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
      targetChatSessionId: automation.targetChatSessionId,
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
  const chats = chatsData?.chats ?? []

  return (
    <AppLayout>
      <Head title="Automations" />
      <div className="max-w-300 mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconAutomation size={32} className="text-desert-green" />
            <div>
              <h1 className="text-2xl font-semibold text-text-primary">Automations</h1>
              <p className="text-sm text-text-muted">
                Schedule AI prompts to run on a timer and deliver results to chat.
              </p>
            </div>
          </div>
          {n8nInstalled && apiKeyConfigured && (
            <div className="flex items-center gap-2">
              <StyledButton
                variant="ghost"
                size="sm"
                icon="IconExternalLink"
                onClick={() => window.open('/n8n', '_blank')}
              >
                Open n8n
              </StyledButton>
              <StyledButton
                variant="primary"
                icon="IconPlus"
                onClick={() => {
                  resetForm()
                  setEditingId(null)
                  setShowForm(true)
                }}
              >
                New Automation
              </StyledButton>
            </div>
          )}
        </div>

        {!n8nInstalled ? (
          <div className="rounded-lg border border-border-subtle p-12 text-center">
            <IconAutomation size={48} className="mx-auto text-text-muted mb-4" />
            <h2 className="text-lg font-medium text-text-primary mb-2">
              Automations engine not installed
            </h2>
            <p className="text-text-muted mb-6 max-w-md mx-auto">
              Install the n8n service from the Supply Depot to enable scheduled AI prompt
              automations.
            </p>
            <StyledButton
              variant="primary"
              icon="IconDownload"
              onClick={() => (window.location.href = '/supply-depot')}
            >
              Go to Supply Depot
            </StyledButton>
          </div>
        ) : !apiKeyConfigured ? (
          <div className="rounded-lg border border-border-subtle p-12 text-center">
            <IconKey size={48} className="mx-auto text-text-muted mb-4" />
            <h2 className="text-lg font-medium text-text-primary mb-2">Connect n8n to NOMAD</h2>
            <p className="text-text-muted mb-6 max-w-lg mx-auto">
              n8n is installed. To let NOMAD manage workflows, create an API key in n8n (Settings →
              API) and paste it here.
            </p>
            <div className="flex gap-3 justify-center mb-4">
              <StyledButton
                variant="primary"
                icon="IconExternalLink"
                onClick={() => window.open('/n8n', '_blank')}
              >
                Open n8n
              </StyledButton>
            </div>
            {showApiKeyInput ? (
              <div className="max-w-md mx-auto space-y-3">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface-primary text-text-primary text-sm"
                  placeholder="Paste n8n API key"
                />
                <div className="flex gap-2 justify-center">
                  <StyledButton
                    variant="primary"
                    icon="IconKey"
                    onClick={() => apiKeyMutation.mutate(apiKey)}
                    loading={apiKeyMutation.isPending}
                    disabled={!apiKey.trim()}
                  >
                    Save Key
                  </StyledButton>
                  <StyledButton
                    variant="outline"
                    onClick={() => {
                      setShowApiKeyInput(false)
                      setApiKey('')
                    }}
                  >
                    Cancel
                  </StyledButton>
                </div>
              </div>
            ) : (
              <StyledButton
                variant="outline"
                icon="IconKey"
                onClick={() => setShowApiKeyInput(true)}
              >
                Enter API Key
              </StyledButton>
            )}
          </div>
        ) : showForm ? (
          <div className="rounded-lg border border-border-subtle p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text-primary">
                {editingId ? 'Edit Automation' : 'New Automation'}
              </h2>
              <button
                onClick={() => {
                  setShowForm(false)
                  setEditingId(null)
                  resetForm()
                }}
                className="p-2 hover:bg-surface-secondary rounded-lg transition-colors"
              >
                <IconX className="h-5 w-5 text-text-muted" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  placeholder="0 15 * * *"
                />
                <p className="text-xs text-text-muted mt-1">
                  minute hour day month weekday. Empty = manual only.
                </p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">Prompt</label>
              <textarea
                value={formData.prompt}
                onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                rows={5}
                className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface-primary text-text-primary text-sm resize-y"
                placeholder="The prompt to run on schedule"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">Model</label>
                <input
                  type="text"
                  value={formData.model ?? ''}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface-primary text-text-primary text-sm"
                  placeholder={defaultModel ? `Default: ${defaultModel}` : 'Current chat model'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Output destination
                </label>
                <select
                  value={formData.targetChatSessionId ?? 'new'}
                  onChange={(e) =>
                    setFormData({ ...formData, targetChatSessionId: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface-primary text-text-primary text-sm"
                >
                  <option value="new">New chat (auto)</option>
                  {chats.map((chat: any) => (
                    <option key={chat.id} value={String(chat.id)}>
                      {chat.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">Tools</label>
                <div className="flex flex-wrap gap-1.5">
                  {tools.length === 0 ? (
                    <span className="text-xs text-text-muted">No tools available</span>
                  ) : (
                    tools.map((tool: AutomationTool) => (
                      <button
                        key={tool.name}
                        type="button"
                        onClick={() => toggleTool(tool.name)}
                        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                          formData.tools?.includes(tool.name)
                            ? 'bg-desert-green text-white'
                            : 'bg-surface-secondary text-text-muted hover:bg-surface-elevated'
                        }`}
                      >
                        {tool.name}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
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
              <StyledButton
                variant="primary"
                icon="IconCircleCheck"
                onClick={handleSubmit}
                loading={createMutation.isPending || updateMutation.isPending}
              >
                {editingId ? 'Update' : 'Create'}
              </StyledButton>
            </div>
          </div>
        ) : isLoading ? (
          <div className="py-16 text-center text-text-muted">Loading automations…</div>
        ) : automations.length === 0 ? (
          <div className="rounded-lg border border-border-subtle p-12 text-center">
            <p className="text-text-muted mb-4">No automations yet.</p>
            <StyledButton
              variant="primary"
              icon="IconPlus"
              onClick={() => {
                resetForm()
                setEditingId(null)
                setShowForm(true)
              }}
            >
              Create your first automation
            </StyledButton>
          </div>
        ) : (
          <div className="space-y-3">
            {automations.map((automation: Automation) => (
              <div
                key={automation.id}
                className="rounded-lg border border-border-subtle p-4 hover:border-border-default transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-text-primary">{automation.name}</h3>
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
                    <p className="text-sm text-text-muted mt-1 line-clamp-2">{automation.prompt}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-text-muted flex-wrap">
                      <span className="font-mono">{automation.scheduleCron ?? 'manual'}</span>
                      <span>·</span>
                      <span>{automation.model || 'default model'}</span>
                      {automation.tools.length > 0 && (
                        <>
                          <span>·</span>
                          <span>{automation.tools.join(', ')}</span>
                        </>
                      )}
                      {automation.lastRunAt && (
                        <>
                          <span>·</span>
                          <span>last run: {new Date(automation.lastRunAt).toLocaleString()}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => runMutation.mutate(automation.id)}
                      disabled={runMutation.isPending}
                      className="p-2 rounded-lg hover:bg-surface-secondary transition-colors text-text-muted hover:text-text-primary"
                      title="Run now"
                    >
                      <IconPlayerPlay className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => startEdit(automation)}
                      className="p-2 rounded-lg hover:bg-surface-secondary transition-colors text-text-muted hover:text-text-primary"
                      title="Edit"
                    >
                      <IconX className="h-4 w-4 rotate-45" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete "${automation.name}"?`)) {
                          deleteMutation.mutate(automation.id)
                        }
                      }}
                      className="p-2 rounded-lg hover:bg-red-500/10 transition-colors text-text-muted hover:text-red-600"
                      title="Delete"
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
