import { Head, router } from '@inertiajs/react'
import { useState } from 'react'
import { IconCheck, IconLock } from '@tabler/icons-react'
import SettingsLayout from '~/layouts/SettingsLayout'
import StyledButton from '~/components/StyledButton'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import Alert from '~/components/Alert'
import Input from '~/components/inputs/Input'
import api from '~/lib/api'
import { useNotifications } from '~/context/NotificationContext'

interface SecretsProps {
  secrets: {
    huggingFaceTokenConfigured: boolean
    huggingFaceTokenEnvOverride: boolean
    registryUsername: string
    registryPasswordConfigured: boolean
    vpnUsername: string
    vpnPasswordConfigured: boolean
    n8nApiKeyConfigured: boolean
  }
}

function Status({ configured }: { configured: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${
        configured ? 'bg-desert-green/10 text-desert-green' : 'bg-surface-secondary text-text-muted'
      }`}
    >
      {configured && <IconCheck className="size-3.5" />}
      {configured ? 'Configured' : 'Not configured'}
    </span>
  )
}

export default function SecretsPage({ secrets }: SecretsProps) {
  const { addNotification } = useNotifications()
  const [huggingFaceToken, setHuggingFaceToken] = useState('')
  const [registryUsername, setRegistryUsername] = useState(secrets.registryUsername)
  const [registryPassword, setRegistryPassword] = useState('')
  const [vpnUsername, setVpnUsername] = useState(secrets.vpnUsername)
  const [vpnPassword, setVpnPassword] = useState('')
  const [n8nApiKey, setN8nApiKey] = useState('')
  const [saving, setSaving] = useState<string | null>(null)

  async function save(group: string, updates: Array<[string, string]>, reset: () => void) {
    if (updates.length === 0) {
      addNotification({ message: 'Enter a replacement value before saving.', type: 'info' })
      return
    }
    setSaving(group)
    try {
      for (const [key, value] of updates) {
        const result = await api.updateSetting(key, value)
        if (!result?.success) throw new Error(result?.message || 'Failed to save secret.')
      }
      reset()
      addNotification({ message: 'Secret settings updated.', type: 'success' })
      router.reload({ only: ['secrets'] })
    } catch (error) {
      addNotification({
        message: error instanceof Error ? error.message : 'Failed to save secret.',
        type: 'error',
      })
    } finally {
      setSaving(null)
    }
  }

  return (
    <SettingsLayout>
      <Head title="Secrets | Project NOMAD" />
      <div className="xl:pl-72 w-full">
        <main className="px-6 sm:px-12 py-6 max-w-4xl space-y-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <IconLock className="size-8 text-desert-green" />
              <h1 className="text-4xl font-semibold">Secrets</h1>
            </div>
            <p className="text-text-secondary">
              Credentials are encrypted before they are stored. Existing values are never displayed,
              and leaving a secret field blank preserves its current value.
            </p>
          </div>

          <section>
            <div className="flex items-center justify-between gap-3 mb-4">
              <StyledSectionHeader title="Hugging Face" />
              <Status configured={secrets.huggingFaceTokenConfigured} />
            </div>
            <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-6 space-y-4">
              <p className="text-sm text-text-secondary">
                Pocket Voice Cloning requires a Hugging Face read token from an account that has
                accepted the Pocket TTS model terms. Saving a replacement token automatically
                recreates the installed voice-cloning container.
              </p>
              {secrets.huggingFaceTokenEnvOverride && (
                <Alert
                  type="info"
                  title="Environment fallback configured"
                  message="HF_TOKEN is available from the Admin environment. A token saved here takes precedence for managed Pocket TTS containers."
                />
              )}
              <div className="flex flex-col sm:flex-row items-end gap-3">
                <div className="flex-1 w-full">
                  <Input
                    name="huggingFaceToken"
                    type="password"
                    autoComplete="off"
                    label="Hugging Face Token"
                    placeholder={
                      secrets.huggingFaceTokenConfigured
                        ? 'Configured — enter a replacement'
                        : 'hf_...'
                    }
                    value={huggingFaceToken}
                    onChange={(event) => setHuggingFaceToken(event.target.value)}
                  />
                </div>
                <StyledButton
                  variant="primary"
                  icon="IconKey"
                  loading={saving === 'huggingFace'}
                  disabled={saving !== null || !huggingFaceToken.trim()}
                  onClick={() =>
                    save(
                      'huggingFace',
                      [['secrets.huggingFaceToken', huggingFaceToken.trim()]],
                      () => setHuggingFaceToken('')
                    )
                  }
                >
                  Save Token
                </StyledButton>
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3 mb-4">
              <StyledSectionHeader title="Private Container Registry" />
              <Status configured={secrets.registryPasswordConfigured} />
            </div>
            <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-6 space-y-4">
              <p className="text-sm text-text-secondary">
                Credentials used to pull private Supply Depot images.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  name="registryUsername"
                  label="Registry Username"
                  value={registryUsername}
                  onChange={(event) => setRegistryUsername(event.target.value)}
                />
                <Input
                  name="registryPassword"
                  type="password"
                  autoComplete="off"
                  label="Registry Password or Token"
                  placeholder={
                    secrets.registryPasswordConfigured
                      ? 'Configured — enter a replacement'
                      : 'Access token or password'
                  }
                  value={registryPassword}
                  onChange={(event) => setRegistryPassword(event.target.value)}
                />
              </div>
              <div className="flex justify-end">
                <StyledButton
                  variant="primary"
                  loading={saving === 'registry'}
                  disabled={saving !== null}
                  onClick={() => {
                    const updates: Array<[string, string]> = []
                    if (
                      registryUsername.trim() &&
                      registryUsername.trim() !== secrets.registryUsername
                    ) {
                      updates.push(['registry.giteaUsername', registryUsername.trim()])
                    }
                    if (registryPassword) updates.push(['registry.giteaPassword', registryPassword])
                    void save('registry', updates, () => setRegistryPassword(''))
                  }}
                >
                  Save Registry Credentials
                </StyledButton>
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3 mb-4">
              <StyledSectionHeader title="VPN Provider" />
              <Status configured={secrets.vpnPasswordConfigured} />
            </div>
            <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-6 space-y-4">
              <p className="text-sm text-text-secondary">
                Surfshark manual OpenVPN credentials used by the VPN Gateway.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  name="vpnUsername"
                  label="Surfshark Username"
                  value={vpnUsername}
                  onChange={(event) => setVpnUsername(event.target.value)}
                />
                <Input
                  name="vpnPassword"
                  type="password"
                  autoComplete="off"
                  label="Surfshark Password"
                  placeholder={
                    secrets.vpnPasswordConfigured
                      ? 'Configured — enter a replacement'
                      : 'Service password'
                  }
                  value={vpnPassword}
                  onChange={(event) => setVpnPassword(event.target.value)}
                />
              </div>
              <div className="flex justify-end">
                <StyledButton
                  variant="primary"
                  loading={saving === 'vpn'}
                  disabled={saving !== null}
                  onClick={() => {
                    const updates: Array<[string, string]> = []
                    if (vpnUsername.trim() && vpnUsername.trim() !== secrets.vpnUsername) {
                      updates.push(['vpn.openvpnUser', vpnUsername.trim()])
                    }
                    if (vpnPassword) updates.push(['vpn.openvpnPassword', vpnPassword])
                    void save('vpn', updates, () => setVpnPassword(''))
                  }}
                >
                  Save VPN Credentials
                </StyledButton>
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3 mb-4">
              <StyledSectionHeader title="n8n Automations" />
              <Status configured={secrets.n8nApiKeyConfigured} />
            </div>
            <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-6 space-y-4">
              <p className="text-sm text-text-secondary">
                API key used by NOMAD to create and run workflows in n8n.
              </p>
              <div className="flex flex-col sm:flex-row items-end gap-3">
                <div className="flex-1 w-full">
                  <Input
                    name="n8nApiKey"
                    type="password"
                    autoComplete="off"
                    label="n8n API Key"
                    placeholder={
                      secrets.n8nApiKeyConfigured
                        ? 'Configured — enter a replacement'
                        : 'Paste n8n API key'
                    }
                    value={n8nApiKey}
                    onChange={(event) => setN8nApiKey(event.target.value)}
                  />
                </div>
                <StyledButton
                  variant="primary"
                  icon="IconKey"
                  loading={saving === 'n8n'}
                  disabled={saving !== null || !n8nApiKey.trim()}
                  onClick={() =>
                    save('n8n', [['automation.n8nApiKey', n8nApiKey.trim()]], () =>
                      setN8nApiKey('')
                    )
                  }
                >
                  Save API Key
                </StyledButton>
              </div>
            </div>
          </section>

          <Alert
            type="info"
            title="Replacement-only fields"
            message="Secret fields are intentionally blank after loading. Saving another section cannot erase an existing secret, and blank secret fields are never submitted."
          />
        </main>
      </div>
    </SettingsLayout>
  )
}
