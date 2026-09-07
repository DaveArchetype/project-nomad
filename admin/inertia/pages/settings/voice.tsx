import { Head } from '@inertiajs/react'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconDownload,
  IconTrash,
  IconLoader2,
  IconCheck,
  IconUpload,
  IconDeviceFloppy,
} from '@tabler/icons-react'
import SettingsLayout from '~/layouts/SettingsLayout'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import StyledButton from '~/components/StyledButton'
import Switch from '~/components/inputs/Switch'
import Input from '~/components/inputs/Input'
import Alert from '~/components/Alert'
import SpeakButton from '~/components/chat/SpeakButton'
import api from '~/lib/api'
import { useNotifications } from '~/context/NotificationContext'

interface VoiceSettings {
  enabled: boolean
  audioSource: string
  wakeWordPreset: string
  customWakeWordModelPath: string
  wakeWordSensitivity: string
  sttModelSize: string
  sttLanguage: string
  vadSensitivity: string
  retentionDays: string
  ttsEnabled: boolean
  ttsEngine: string
  ttsVoice: string
  ttsAutoReadReplies: boolean
  ttsSpeechRate: string
  ttsXttsLanguage: string
  recapEnabled: boolean
  recapScheduleTime: string
  recapTimezone: string
  recapModel: string
}

const POCKET_TTS_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
]

export default function VoiceSettingsPage(props: { voice: { settings: VoiceSettings } }) {
  const { addNotification } = useNotifications()
  const s = props.voice.settings

  const [enabled, setEnabled] = useState(s.enabled)
  const [audioSource, setAudioSource] = useState(s.audioSource)
  const [wakeWordPreset, setWakeWordPreset] = useState(s.wakeWordPreset)
  const [wakeWordSensitivity, setWakeWordSensitivity] = useState(s.wakeWordSensitivity)
  const [sttModelSize, setSttModelSize] = useState(s.sttModelSize)
  const [sttLanguage, setSttLanguage] = useState(s.sttLanguage)
  const [vadSensitivity, setVadSensitivity] = useState(s.vadSensitivity)
  const [retentionDays, setRetentionDays] = useState(s.retentionDays)
  const [ttsEnabled, setTtsEnabled] = useState(s.ttsEnabled)
  const [ttsEngine, setTtsEngine] = useState(s.ttsEngine || 'piper')
  const [ttsVoice, setTtsVoice] = useState(s.ttsVoice)
  const [ttsAutoReadReplies, setTtsAutoReadReplies] = useState(s.ttsAutoReadReplies)
  const [ttsSpeechRate, setTtsSpeechRate] = useState(s.ttsSpeechRate)
  const [ttsXttsLanguage, setTtsXttsLanguage] = useState(
    POCKET_TTS_LANGUAGES.some((language) => language.code === s.ttsXttsLanguage)
      ? s.ttsXttsLanguage
      : 'en'
  )
  const [recapEnabled, setRecapEnabled] = useState(s.recapEnabled)
  const [recapScheduleTime, setRecapScheduleTime] = useState(s.recapScheduleTime)
  const [recapModel, setRecapModel] = useState(s.recapModel)
  const [isGeneratingRecap, setIsGeneratingRecap] = useState(false)

  const [downloadingVoice, setDownloadingVoice] = useState<string | null>(null)
  const [deletingVoice, setDeletingVoice] = useState<string | null>(null)
  const [uploadingPiperVoice, setUploadingPiperVoice] = useState(false)
  const [cloningXttsVoice, setCloningXttsVoice] = useState(false)
  const [deletingXttsVoice, setDeletingXttsVoice] = useState<string | null>(null)
  const [xttsCloneName, setXttsCloneName] = useState('')

  const { data: status } = useQuery({
    queryKey: ['voice', 'status'],
    queryFn: () => api.getVoiceStatus(),
    refetchInterval: 15000,
  })

  const { data: wakeWordPresets } = useQuery({
    queryKey: ['voice', 'wakeword-presets'],
    queryFn: () => api.getWakeWordPresets(),
    enabled: Boolean(status?.gateway.online),
  })

  const queryClient = useQueryClient()

  const { data: ttsVoices } = useQuery({
    queryKey: ['voice', 'tts-voices'],
    queryFn: () => api.getTtsVoices(),
    enabled: Boolean(status?.tts.online),
  })

  const { data: xttsVoices } = useQuery({
    queryKey: ['voice', 'xtts-voices'],
    queryFn: () => api.getXttsVoices(),
    enabled: Boolean(status?.xtts?.online),
  })

  async function handleDownloadVoice(voice: string) {
    setDownloadingVoice(voice)
    try {
      const res = await api.downloadTtsVoice(voice)
      if (res?.success) {
        addNotification({ message: res.message, type: 'success' })
        queryClient.invalidateQueries({ queryKey: ['voice', 'tts-voices'] })
      } else {
        addNotification({ message: res?.message || 'Download failed.', type: 'error' })
      }
    } catch {
      addNotification({ message: 'Failed to download voice.', type: 'error' })
    } finally {
      setDownloadingVoice(null)
    }
  }

  async function handleDeleteVoice(voice: string) {
    if (voice === ttsVoice && ttsEngine === 'piper') {
      addNotification({
        message: 'Cannot delete the currently selected voice. Switch to another first.',
        type: 'error',
      })
      return
    }
    setDeletingVoice(voice)
    try {
      const res = await api.deleteTtsVoice(voice)
      if (res?.success) {
        addNotification({ message: res.message, type: 'success' })
        queryClient.invalidateQueries({ queryKey: ['voice', 'tts-voices'] })
      } else {
        addNotification({ message: res?.message || 'Delete failed.', type: 'error' })
      }
    } catch {
      addNotification({ message: 'Failed to delete voice.', type: 'error' })
    } finally {
      setDeletingVoice(null)
    }
  }

  async function handleUploadPiperVoice(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length < 2) {
      addNotification({
        message: 'Select both an .onnx and an .onnx.json file.',
        type: 'error',
      })
      e.target.value = ''
      return
    }
    const onnxFile = Array.from(files).find((f) => f.name.endsWith('.onnx'))
    const jsonFile = Array.from(files).find((f) => f.name.endsWith('.json'))
    if (!onnxFile || !jsonFile) {
      addNotification({
        message: 'Please select one .onnx file and one .onnx.json config file.',
        type: 'error',
      })
      e.target.value = ''
      return
    }
    setUploadingPiperVoice(true)
    try {
      const res = await api.uploadTtsVoice(onnxFile, jsonFile)
      if (res?.success) {
        addNotification({ message: res.message, type: 'success' })
        queryClient.invalidateQueries({ queryKey: ['voice', 'tts-voices'] })
      } else {
        addNotification({ message: res?.message || 'Upload failed.', type: 'error' })
      }
    } catch {
      addNotification({ message: 'Failed to upload voice.', type: 'error' })
    } finally {
      setUploadingPiperVoice(false)
      e.target.value = ''
    }
  }

  async function handleCloneXttsVoice(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const name = xttsCloneName.trim()
    if (!name) {
      addNotification({ message: 'Enter a name for the cloned voice first.', type: 'error' })
      e.target.value = ''
      return
    }
    setCloningXttsVoice(true)
    try {
      const res = await api.cloneXttsVoice(name, file)
      if (res?.success) {
        addNotification({ message: res.message, type: 'success' })
        setXttsCloneName('')
        queryClient.invalidateQueries({ queryKey: ['voice', 'xtts-voices'] })
      } else {
        addNotification({ message: res?.message || 'Clone failed.', type: 'error' })
      }
    } catch {
      addNotification({ message: 'Failed to clone voice.', type: 'error' })
    } finally {
      setCloningXttsVoice(false)
      e.target.value = ''
    }
  }

  async function handleDeleteXttsVoice(voice: string) {
    if (voice === ttsVoice && ttsEngine === 'xtts') {
      addNotification({
        message: 'Cannot delete the currently selected voice. Switch to another first.',
        type: 'error',
      })
      return
    }
    setDeletingXttsVoice(voice)
    try {
      const res = await api.deleteXttsVoice(voice)
      if (res?.success) {
        addNotification({ message: res.message, type: 'success' })
        queryClient.invalidateQueries({ queryKey: ['voice', 'xtts-voices'] })
      } else {
        addNotification({ message: res?.message || 'Delete failed.', type: 'error' })
      }
    } catch {
      addNotification({ message: 'Failed to delete voice.', type: 'error' })
    } finally {
      setDeletingXttsVoice(null)
    }
  }

  const { data: recaps, refetch: refetchRecaps } = useQuery({
    queryKey: ['voice', 'recaps'],
    queryFn: () => api.listRecaps(14),
  })

  const updateSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean | string }) => {
      return await api.updateSetting(key, value)
    },
  })

  function save(key: string, value: boolean | string) {
    updateSettingMutation.mutate({ key, value })
  }

  const [forceSavingXtts, setForceSavingXtts] = useState(false)
  async function forceSaveXtts() {
    setForceSavingXtts(true)
    try {
      await Promise.all([
        api.updateSetting('tts.engine', ttsEngine),
        api.updateSetting('tts.voice', ttsVoice),
        api.updateSetting('tts.xttsLanguage', ttsXttsLanguage),
        api.updateSetting('tts.speechRate', ttsSpeechRate),
        api.updateSetting('tts.enabled', ttsEnabled),
        api.updateSetting('tts.autoReadReplies', ttsAutoReadReplies),
      ])
      addNotification({ message: 'Pocket TTS settings saved.', type: 'success' })
    } catch {
      addNotification({ message: 'Failed to save Pocket TTS settings.', type: 'error' })
    } finally {
      setForceSavingXtts(false)
    }
  }

  const [forceSavingPiper, setForceSavingPiper] = useState(false)
  async function forceSavePiper() {
    setForceSavingPiper(true)
    try {
      await Promise.all([
        api.updateSetting('tts.engine', ttsEngine),
        api.updateSetting('tts.voice', ttsVoice),
        api.updateSetting('tts.speechRate', ttsSpeechRate),
        api.updateSetting('tts.enabled', ttsEnabled),
        api.updateSetting('tts.autoReadReplies', ttsAutoReadReplies),
      ])
      addNotification({ message: 'Piper TTS settings saved.', type: 'success' })
    } catch {
      addNotification({ message: 'Failed to save Piper TTS settings.', type: 'error' })
    } finally {
      setForceSavingPiper(false)
    }
  }

  async function handleUploadWakeWordModel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const res = await api.uploadWakeWordModel(file)
      if (res?.success) {
        addNotification({ message: res.message, type: 'success' })
        setWakeWordPreset('custom')
        save('voice.wakeWordPreset', 'custom')
      } else {
        addNotification({ message: res?.message || 'Upload failed.', type: 'error' })
      }
    } catch {
      addNotification({ message: 'Failed to upload wake word model.', type: 'error' })
    } finally {
      e.target.value = ''
    }
  }

  async function handleRemoveCustomModel() {
    const res = await api.deleteWakeWordModel()
    if (res?.success) {
      addNotification({ message: res.message, type: 'success' })
      setWakeWordPreset('hey_jarvis')
      save('voice.wakeWordPreset', 'hey_jarvis')
    }
  }

  async function handleGenerateRecap() {
    setIsGeneratingRecap(true)
    try {
      const res = await api.generateRecap()
      if (res) {
        addNotification({ message: 'Daily recap generated.', type: 'success' })
        refetchRecaps()
      } else {
        addNotification({
          message: 'No ambient recordings found for yesterday, or generation failed.',
          type: 'error',
        })
      }
    } finally {
      setIsGeneratingRecap(false)
    }
  }

  const gatewayOnline = status?.gateway.online ?? false
  const ttsOnline = status?.tts.online ?? false
  const xttsOnline = status?.xtts?.online ?? false

  return (
    <SettingsLayout>
      <Head title="Voice Assistant | Project NOMAD" />
      <div className="xl:pl-72 w-full">
        <main className="px-6 sm:px-12 py-6 max-w-4xl space-y-10">
          <div>
            <h1 className="text-4xl font-semibold mb-2">Voice Assistant</h1>
            <p className="text-text-secondary">
              Ambient listening, wake-word detection, and text-to-speech. Piper and Pocket TTS run
              locally on CPU so they do not compete with other GPU workloads.
            </p>
          </div>

          {!gatewayOnline && (
            <Alert
              type="warning"
              title="Voice Gateway unavailable"
              message="Add the `voice-gateway` service from install/management_compose.yaml to your docker-compose.yml, then run `docker compose up -d voice-gateway` to enable ambient listening and wake-word detection."
            />
          )}
          {!ttsOnline && (
            <Alert
              type="warning"
              title="Text-to-Speech unavailable"
              message="Install the Text-to-Speech service from the Supply Depot to enable read-aloud replies and recap narration."
            />
          )}

          <section>
            <StyledSectionHeader title="General" />
            <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-4 sm:p-6 space-y-4">
              <Switch
                checked={enabled}
                onChange={(v) => {
                  setEnabled(v)
                  save('voice.enabled', v)
                }}
                label="Enable Voice Assistant"
                description="Master switch. When on, a discreet microphone icon appears in the navbar on Home, Settings, and Chat — click it to start/stop ambient listening for that browser session."
              />
              <div>
                <label className="block text-base font-medium text-text-primary mb-1.5">
                  Audio source
                </label>
                <select
                  value={audioSource}
                  onChange={(e) => {
                    setAudioSource(e.target.value)
                    save('voice.audioSource', e.target.value)
                  }}
                  className="w-full sm:w-64 px-3 py-2 border border-border-default rounded-md bg-surface-primary text-sm"
                >
                  <option value="browser">Browser microphone</option>
                  <option value="host">Host-attached microphone (advanced)</option>
                  <option value="both">Both</option>
                </select>
                <p className="text-sm text-text-muted mt-1">
                  &quot;Host-attached&quot; requires a microphone physically connected to the NOMAD
                  server and passed through to the Voice Gateway container — hardware setup varies
                  and is best-effort.
                </p>
              </div>
            </div>
          </section>

          <section>
            <StyledSectionHeader title="Wake Word" />
            <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-4 sm:p-6 space-y-4">
              <Alert
                type="info"
                title="Custom wake phrases require a trained model"
                message='openWakeWord ships with a handful of pretrained phrases (e.g. "hey jarvis"). A fully custom phrase like "Nomad" requires training your own model (see the openWakeWord training notebook) and uploading it below.'
              />
              <div>
                <label className="block text-base font-medium text-text-primary mb-1.5">
                  Wake word
                </label>
                <select
                  value={wakeWordPreset}
                  onChange={(e) => {
                    setWakeWordPreset(e.target.value)
                    save('voice.wakeWordPreset', e.target.value)
                  }}
                  className="w-full sm:w-64 px-3 py-2 border border-border-default rounded-md bg-surface-primary text-sm"
                >
                  {(
                    wakeWordPresets?.presets ?? [
                      'alexa',
                      'hey_jarvis',
                      'hey_mycroft',
                      'hey_rhasspy',
                    ]
                  ).map((p) => (
                    <option key={p} value={p}>
                      {p.replace(/_/g, ' ')}
                    </option>
                  ))}
                  {wakeWordPresets?.hasCustomModel && (
                    <option value="custom">Custom (uploaded)</option>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-base font-medium text-text-primary mb-1.5">
                  Sensitivity ({wakeWordSensitivity})
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={wakeWordSensitivity}
                  onChange={(e) => setWakeWordSensitivity(e.target.value)}
                  onMouseUp={() => save('voice.wakeWordSensitivity', wakeWordSensitivity)}
                  onTouchEnd={() => save('voice.wakeWordSensitivity', wakeWordSensitivity)}
                  className="w-full sm:w-64"
                />
                <p className="text-sm text-text-muted mt-1">
                  Higher values trigger more easily, but with more false positives.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-block">
                  <span className="sr-only">Upload custom wake word model</span>
                  <input
                    type="file"
                    accept=".onnx"
                    onChange={handleUploadWakeWordModel}
                    className="text-sm"
                  />
                </label>
                {wakeWordPresets?.hasCustomModel && (
                  <StyledButton variant="secondary" onClick={handleRemoveCustomModel}>
                    Remove custom model
                  </StyledButton>
                )}
              </div>
            </div>
          </section>

          <section>
            <StyledSectionHeader title="Speech-to-Text" />
            <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-4 sm:p-6 space-y-4">
              <div>
                <label className="block text-base font-medium text-text-primary mb-1.5">
                  Model size
                </label>
                <select
                  value={sttModelSize}
                  onChange={(e) => {
                    setSttModelSize(e.target.value)
                    save('stt.modelSize', e.target.value)
                  }}
                  className="w-full sm:w-64 px-3 py-2 border border-border-default rounded-md bg-surface-primary text-sm"
                >
                  <option value="tiny">Tiny (fastest, least accurate)</option>
                  <option value="base">Base (recommended)</option>
                  <option value="small">Small</option>
                  <option value="medium">Medium (slowest, most accurate)</option>
                </select>
                <p className="text-sm text-text-muted mt-1">
                  Larger models need a restart of the Voice Gateway to take effect.
                </p>
              </div>
              <Input
                name="sttLanguage"
                label="Language"
                helpText='BCP-47 code (e.g. "en"), or "auto" to detect automatically.'
                value={sttLanguage}
                onChange={(e) => setSttLanguage(e.target.value)}
                onBlur={() => save('stt.language', sttLanguage)}
                className="sm:w-64"
              />
              <div>
                <label className="block text-base font-medium text-text-primary mb-1.5">
                  Voice activity sensitivity ({vadSensitivity})
                </label>
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={1}
                  value={vadSensitivity}
                  onChange={(e) => setVadSensitivity(e.target.value)}
                  onMouseUp={() => save('stt.vadSensitivity', vadSensitivity)}
                  onTouchEnd={() => save('stt.vadSensitivity', vadSensitivity)}
                  className="w-full sm:w-64"
                />
                <p className="text-sm text-text-muted mt-1">
                  Higher filters out more background noise, but may clip quiet speech.
                </p>
              </div>
              <Input
                name="retentionDays"
                label="Ambient transcript retention (days)"
                helpText="Only the transcript text is stored (never raw audio). 0 = keep forever."
                type="number"
                min={0}
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                onBlur={() => save('voice.retentionDays', retentionDays)}
                className="sm:w-64"
              />
            </div>
          </section>

          <section>
            <StyledSectionHeader title="Text-to-Speech" />
            <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-4 sm:p-6 space-y-4">
              <Switch
                checked={ttsEnabled}
                onChange={(v) => {
                  setTtsEnabled(v)
                  save('tts.enabled', v)
                }}
                label="Enable Text-to-Speech"
                description="Adds a speaker button to assistant chat replies and enables daily recap narration."
              />
              <Switch
                checked={ttsAutoReadReplies}
                onChange={(v) => {
                  setTtsAutoReadReplies(v)
                  save('tts.autoReadReplies', v)
                }}
                label="Automatically read replies aloud"
                description="Play each assistant reply as soon as it finishes streaming, without clicking the speaker button."
                disabled={!ttsEnabled}
              />

              <div className="border-t border-border-subtle pt-4">
                <label className="block text-base font-medium text-text-primary mb-1.5">
                  TTS Engine
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <label
                    className={`flex-1 rounded-md border-2 p-3 cursor-pointer transition-colors ${
                      ttsEngine === 'piper'
                        ? 'border-desert-green bg-desert-green/5'
                        : 'border-border-subtle hover:border-border-default'
                    }`}
                  >
                    <input
                      type="radio"
                      name="ttsEngine"
                      value="piper"
                      checked={ttsEngine === 'piper'}
                      onChange={(e) => {
                        setTtsEngine(e.target.value)
                        save('tts.engine', e.target.value)
                        const piperVoices = ttsVoices?.downloaded ?? ['en_US-lessac-medium']
                        if (piperVoices.length > 0 && !piperVoices.includes(ttsVoice)) {
                          setTtsVoice(piperVoices[0])
                          save('tts.voice', piperVoices[0])
                        }
                      }}
                      className="sr-only"
                    />
                    <div className="text-sm font-medium text-text-primary">Piper (CPU)</div>
                    <div className="text-xs text-text-muted mt-0.5">
                      Lightweight, offline, ~100+ voices. No GPU needed.
                    </div>
                  </label>
                  <label
                    className={`flex-1 rounded-md border-2 p-3 cursor-pointer transition-colors ${
                      ttsEngine === 'xtts'
                        ? 'border-desert-green bg-desert-green/5'
                        : 'border-border-subtle hover:border-border-default'
                    } ${!xttsOnline ? 'opacity-50' : ''}`}
                  >
                    <input
                      type="radio"
                      name="ttsEngine"
                      value="xtts"
                      checked={ttsEngine === 'xtts'}
                      onChange={(e) => {
                        setTtsEngine(e.target.value)
                        save('tts.engine', e.target.value)
                        const xttsVoiceList = xttsVoices?.voices ?? []
                        if (xttsVoiceList.length > 0 && !xttsVoiceList.includes(ttsVoice)) {
                          setTtsVoice(xttsVoiceList[0])
                          save('tts.voice', xttsVoiceList[0])
                        }
                      }}
                      disabled={!xttsOnline}
                      className="sr-only"
                    />
                    <div className="text-sm font-medium text-text-primary">
                      Pocket TTS Voice Cloning (CPU)
                    </div>
                    <div className="text-xs text-text-muted mt-0.5">
                      Fast, low-latency voice cloning optimized for CPU.
                    </div>
                  </label>
                </div>
                {!xttsOnline && (
                  <p className="text-sm text-text-muted mt-2">
                    Pocket Voice Cloning is unavailable. Install or start it from the Supply Depot.
                  </p>
                )}
                {ttsEngine === 'xtts' && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={forceSaveXtts}
                      disabled={forceSavingXtts}
                      className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium bg-desert-green/10 text-desert-green hover:bg-desert-green/20 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {forceSavingXtts ? (
                        <IconLoader2 className="size-4 animate-spin" />
                      ) : (
                        <IconDeviceFloppy className="size-4" />
                      )}
                      <span>{forceSavingXtts ? 'Saving…' : 'Save Pocket TTS settings'}</span>
                    </button>
                  </div>
                )}
                {ttsEngine === 'piper' && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={forceSavePiper}
                      disabled={forceSavingPiper}
                      className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium bg-desert-green/10 text-desert-green hover:bg-desert-green/20 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {forceSavingPiper ? (
                        <IconLoader2 className="size-4 animate-spin" />
                      ) : (
                        <IconDeviceFloppy className="size-4" />
                      )}
                      <span>{forceSavingPiper ? 'Saving…' : 'Save Piper settings'}</span>
                    </button>
                  </div>
                )}
              </div>

              {ttsEngine === 'xtts' && (
                <div>
                  <label className="block text-base font-medium text-text-primary mb-1.5">
                    Pocket TTS Language
                  </label>
                  <select
                    value={ttsXttsLanguage}
                    onChange={(e) => {
                      setTtsXttsLanguage(e.target.value)
                      save('tts.xttsLanguage', e.target.value)
                    }}
                    className="w-full sm:w-64 px-3 py-2 border border-border-default rounded-md bg-surface-primary text-sm"
                  >
                    {POCKET_TTS_LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-sm text-text-muted mt-1">
                    Language for synthesis. The cloned voice sample can be in any language.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-base font-medium text-text-primary mb-1.5">
                  Voice
                </label>
                <select
                  value={ttsVoice}
                  onChange={(e) => {
                    setTtsVoice(e.target.value)
                    save('tts.voice', e.target.value)
                  }}
                  className="w-full sm:w-64 px-3 py-2 border border-border-default rounded-md bg-surface-primary text-sm"
                >
                  {ttsEngine === 'piper'
                    ? (ttsVoices?.downloaded ?? ['en_US-lessac-medium']).map((v) => (
                        <option key={v} value={v}>
                          {v.replace(/_/g, ' ')}
                        </option>
                      ))
                    : (xttsVoices?.voices ?? []).map((v) => (
                        <option key={v} value={v}>
                          {v.replace(/_/g, ' ')}
                        </option>
                      ))}
                </select>
                <p className="text-sm text-text-muted mt-1">
                  {ttsEngine === 'piper'
                    ? 'Only downloaded voices appear here. Download more below.'
                    : xttsVoices && xttsVoices.voices.length > 0
                      ? 'Cloned voices appear here. Clone more below.'
                      : 'No cloned voices yet. Upload an audio sample below to create one.'}
                </p>
              </div>
              {ttsEngine === 'piper' && (
                <div>
                  <label className="block text-base font-medium text-text-primary mb-1.5">
                    Speech rate ({ttsSpeechRate}x)
                  </label>
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.1}
                    value={ttsSpeechRate}
                    onChange={(e) => setTtsSpeechRate(e.target.value)}
                    onMouseUp={() => save('tts.speechRate', ttsSpeechRate)}
                    onTouchEnd={() => save('tts.speechRate', ttsSpeechRate)}
                    className="w-full sm:w-64"
                  />
                </div>
              )}

              {ttsEngine === 'piper' ? (
                <div className="border-t border-border-subtle pt-4">
                  <h3 className="text-sm font-semibold text-text-primary mb-2">
                    Piper voice library
                  </h3>
                  <p className="text-sm text-text-muted mb-3">
                    Download additional Piper voices (100+ available across 35 languages) or upload
                    your own .onnx + .onnx.json files. Downloaded voices appear in the selector
                    above. Files are ~50-100MB each.
                  </p>
                  <div className="max-h-72 overflow-y-auto rounded-md border border-border-subtle divide-y divide-border-subtle">
                    {(ttsVoices?.voices ?? []).map((voice) => {
                      const isDownloaded = (ttsVoices?.downloaded ?? []).includes(voice)
                      const isCustom = (ttsVoices?.custom ?? []).includes(voice)
                      const isSelected = voice === ttsVoice
                      const isDownloading = downloadingVoice === voice
                      const isDeleting = deletingVoice === voice
                      return (
                        <div
                          key={voice}
                          className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-surface-secondary/50 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-text-primary truncate">
                                {voice.replace(/_/g, ' ')}
                              </span>
                              {isDownloaded && (
                                <IconCheck className="size-4 text-desert-green shrink-0" />
                              )}
                              {isSelected && (
                                <span className="text-xs text-desert-green font-medium shrink-0">
                                  (selected)
                                </span>
                              )}
                              {isCustom && (
                                <span className="text-xs text-blue-500 font-medium shrink-0">
                                  custom
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-text-muted">
                              {voice.split('-').slice(-1)[0]} quality
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isDownloaded ? (
                              <>
                                <SpeakButton
                                  text="Hello, this is a voice preview."
                                  voice={voice}
                                  className="text-text-muted hover:text-desert-green"
                                />
                                {!isSelected && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteVoice(voice)}
                                    disabled={isDeleting}
                                    className="text-text-muted hover:text-red-500 transition-colors disabled:opacity-50 cursor-pointer"
                                    title="Delete voice"
                                  >
                                    {isDeleting ? (
                                      <IconLoader2 className="size-4 animate-spin" />
                                    ) : (
                                      <IconTrash className="size-4" />
                                    )}
                                  </button>
                                )}
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleDownloadVoice(voice)}
                                disabled={isDownloading}
                                className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium bg-desert-green/10 text-desert-green hover:bg-desert-green/20 transition-colors disabled:opacity-50 cursor-pointer"
                              >
                                {isDownloading ? (
                                  <IconLoader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <IconDownload className="size-3.5" />
                                )}
                                {isDownloading ? 'Downloading…' : 'Download'}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {ttsVoices && ttsVoices.voices.length === 0 && (
                      <div className="px-3 py-4 text-sm text-text-muted text-center">
                        No voices available. Make sure the TTS service is running.
                      </div>
                    )}
                  </div>

                  <div className="mt-4">
                    <h4 className="text-sm font-semibold text-text-primary mb-2">
                      Upload custom Piper voice
                    </h4>
                    <p className="text-sm text-text-muted mb-2">
                      Select both the <code className="text-xs">.onnx</code> model file and its{' '}
                      <code className="text-xs">.onnx.json</code> config file together (hold
                      Ctrl/Cmd to multi-select).
                    </p>
                    <label className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium bg-desert-green/10 text-desert-green hover:bg-desert-green/20 transition-colors cursor-pointer disabled:opacity-50">
                      {uploadingPiperVoice ? (
                        <IconLoader2 className="size-4 animate-spin" />
                      ) : (
                        <IconUpload className="size-4" />
                      )}
                      <span>{uploadingPiperVoice ? 'Uploading…' : 'Upload .onnx + .json'}</span>
                      <input
                        type="file"
                        accept=".onnx,.json"
                        multiple
                        onChange={handleUploadPiperVoice}
                        disabled={uploadingPiperVoice}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="border-t border-border-subtle pt-4">
                  <h3 className="text-sm font-semibold text-text-primary mb-2">
                    Voice cloning (Pocket TTS)
                  </h3>
                  <Alert
                    type="info"
                    title="Audio sample best practices"
                    message="For best results: 3-15 seconds of clean, flowing speech. Mono WAV is ideal. Avoid background music, long pauses, or breathy sounds at the start/end. Pocket TTS reproduces the sample's audio quality, including background noise."
                  />

                  <div className="mt-4">
                    <h4 className="text-sm font-semibold text-text-primary mb-2">
                      Clone a new voice
                    </h4>
                    <div className="flex flex-col sm:flex-row gap-3 items-start">
                      <Input
                        name="xttsCloneName"
                        label="Voice name"
                        helpText="e.g. morgan_freeman, narrator, my_voice"
                        value={xttsCloneName}
                        onChange={(e) => setXttsCloneName(e.target.value)}
                        className="sm:w-48"
                      />
                      <div className="flex flex-col gap-1 pt-6">
                        <label className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium bg-desert-green/10 text-desert-green hover:bg-desert-green/20 transition-colors cursor-pointer disabled:opacity-50">
                          {cloningXttsVoice ? (
                            <IconLoader2 className="size-4 animate-spin" />
                          ) : (
                            <IconUpload className="size-4" />
                          )}
                          <span>{cloningXttsVoice ? 'Cloning…' : 'Upload audio sample'}</span>
                          <input
                            type="file"
                            accept=".wav,.mp3,.flac,.ogg,.m4a"
                            onChange={handleCloneXttsVoice}
                            disabled={cloningXttsVoice || !xttsCloneName.trim()}
                            className="hidden"
                          />
                        </label>
                        {!xttsCloneName.trim() && (
                          <span className="text-xs text-text-muted">
                            Enter a name first to enable upload.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <h4 className="text-sm font-semibold text-text-primary mb-2">Cloned voices</h4>
                    <div className="max-h-72 overflow-y-auto rounded-md border border-border-subtle divide-y divide-border-subtle">
                      {(xttsVoices?.voices ?? []).map((voice) => {
                        const isSelected = voice === ttsVoice
                        const isDeleting = deletingXttsVoice === voice
                        return (
                          <div
                            key={voice}
                            onClick={() => {
                              setTtsVoice(voice)
                              save('tts.voice', voice)
                            }}
                            className={`flex items-center justify-between gap-3 px-3 py-2.5 transition-colors cursor-pointer ${
                              isSelected ? 'bg-desert-green/5' : 'hover:bg-surface-secondary/50'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-text-primary truncate">
                                  {voice.replace(/_/g, ' ')}
                                </span>
                                {isSelected && (
                                  <span className="text-xs text-desert-green font-medium shrink-0">
                                    (selected)
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-text-muted">Cloned voice</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <SpeakButton
                                text="Hello, this is a voice preview."
                                voice={voice}
                                engine="xtts"
                                language={ttsXttsLanguage}
                                className="text-text-muted hover:text-desert-green"
                              />
                              {!isSelected && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteXttsVoice(voice)}
                                  disabled={isDeleting}
                                  className="text-text-muted hover:text-red-500 transition-colors disabled:opacity-50 cursor-pointer"
                                  title="Delete voice"
                                >
                                  {isDeleting ? (
                                    <IconLoader2 className="size-4 animate-spin" />
                                  ) : (
                                    <IconTrash className="size-4" />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                      {(!xttsVoices || xttsVoices.voices.length === 0) && (
                        <div className="px-3 py-4 text-sm text-text-muted text-center">
                          No cloned voices yet. Upload an audio sample above to create one.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section>
            <StyledSectionHeader title="Daily Recap" />
            <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-4 sm:p-6 space-y-4">
              <Switch
                checked={recapEnabled}
                onChange={(v) => {
                  setRecapEnabled(v)
                  save('recap.enabled', v)
                }}
                label="Enable nightly recap"
                description="Summarizes each day's ambient transcripts into a short recap you can ask Chat about later (e.g. 'what happened yesterday?')."
              />
              <Input
                name="recapScheduleTime"
                label="Schedule time"
                helpText="24-hour HH:MM, server local time."
                value={recapScheduleTime}
                onChange={(e) => setRecapScheduleTime(e.target.value)}
                onBlur={() => save('recap.scheduleTime', recapScheduleTime)}
                className="sm:w-48"
              />
              <Input
                name="recapModel"
                label="Summarization model"
                helpText="Leave blank to reuse whichever model you last used in Chat."
                value={recapModel}
                onChange={(e) => setRecapModel(e.target.value)}
                onBlur={() => save('recap.model', recapModel)}
                className="sm:w-64"
              />
              <StyledButton onClick={handleGenerateRecap} disabled={isGeneratingRecap}>
                {isGeneratingRecap ? 'Generating…' : "Generate yesterday's recap now"}
              </StyledButton>

              {recaps && recaps.length > 0 && (
                <div className="mt-4 border-t border-border-subtle pt-4 space-y-3">
                  <h3 className="text-sm font-semibold text-text-primary">Recent recaps</h3>
                  {recaps.map((r) => (
                    <div key={r.id} className="flex items-start gap-3 text-sm">
                      <div className="flex-1">
                        <div className="font-medium text-text-primary">{r.recap_date}</div>
                        <p className="text-text-secondary">{r.summary}</p>
                      </div>
                      {ttsOnline && (
                        <SpeakButton
                          text={r.summary}
                          className="text-text-muted hover:text-desert-green mt-1"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </SettingsLayout>
  )
}
