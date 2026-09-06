import { useEffect, useState } from 'react'
import StyledButton from '~/components/StyledButton'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import Switch from '~/components/inputs/Switch'
import Input from '~/components/inputs/Input'
import api from '~/lib/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNotifications } from '~/context/NotificationContext'
import { useAppAutoUpdateStatus } from '~/hooks/useAppAutoUpdateStatus'

const COOLOFF_OPTIONS = [
  { value: 24, label: '24 hours (1 day)' },
  { value: 48, label: '48 hours (2 days)' },
  { value: 72, label: '72 hours (3 days)' },
  { value: 168, label: '7 days' },
]

export default function AppAutoUpdateSection() {
  const { addNotification } = useNotifications()
  const queryClient = useQueryClient()
  const { data: status, isLoading } = useAppAutoUpdateStatus()

  const [windowStart, setWindowStart] = useState('02:00')
  const [windowEnd, setWindowEnd] = useState('05:00')
  const [cooloff, setCooloff] = useState(72)

  useEffect(() => {
    if (status) {
      setWindowStart(status.windowStart)
      setWindowEnd(status.windowEnd)
      setCooloff(status.cooloffHours)
    }
  }, [status?.windowStart, status?.windowEnd, status?.cooloffHours])

  const enabled = status?.enabled ?? false

  const toggleMutation = useMutation({
    mutationFn: (value: boolean) => api.updateSetting('appAutoUpdate.enabled', value),
    onSuccess: (_data, value) => {
      queryClient.invalidateQueries({ queryKey: ['app-auto-update-status'] })
      addNotification({
        type: 'success',
        message: value ? 'App automatic updates enabled.' : 'App automatic updates disabled.',
      })
    },
    onError: () => {
      addNotification({ type: 'error', message: 'Failed to update app auto-update setting.' })
    },
  })

  const handleSaveSchedule = async () => {
    try {
      await api.updateSetting('autoUpdate.windowStart', windowStart)
      await api.updateSetting('autoUpdate.windowEnd', windowEnd)
      await api.updateSetting('autoUpdate.cooloffHours', String(cooloff))
      queryClient.invalidateQueries({ queryKey: ['app-auto-update-status'] })
      addNotification({ type: 'success', message: 'Auto-update schedule saved.' })
    } catch {
      addNotification({ type: 'error', message: 'Failed to save auto-update schedule.' })
    }
  }

  return (
    <>
      <StyledSectionHeader title="Automatic App Updates" className="mt-8" />
      <div className="bg-surface-primary rounded-lg border shadow-md overflow-hidden mt-6 p-6">
        <Switch
          checked={enabled}
          onChange={(value) => toggleMutation.mutate(value)}
          disabled={toggleMutation.isPending || isLoading}
          label="Enable Automatic App Updates"
          description="Automatically install minor and patch updates for apps you've opted in (toggle each app in Supply Depot). Major versions always require a manual update."
        />

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            name="autoUpdateWindowStart"
            label="Window Start"
            type="time"
            value={windowStart}
            onChange={(e) => setWindowStart(e.target.value)}
            disabled={!enabled}
            helpText="Local server time"
          />
          <Input
            name="autoUpdateWindowEnd"
            label="Window End"
            type="time"
            value={windowEnd}
            onChange={(e) => setWindowEnd(e.target.value)}
            disabled={!enabled}
            helpText="Local server time"
          />
          <div>
            <label
              htmlFor="autoUpdateCooloff"
              className="block text-base/6 font-medium text-text-primary"
            >
              Cool-off Period
            </label>
            <p className="mt-1 text-sm text-text-muted">Delay after a release is published</p>
            <select
              id="autoUpdateCooloff"
              value={cooloff}
              onChange={(e) => setCooloff(Number(e.target.value))}
              disabled={!enabled}
              className="mt-1.5 block w-full rounded-md bg-surface-primary px-3 py-2 text-base text-text-primary border border-border-default focus:outline-2 focus:-outline-offset-2 focus:outline-primary sm:text-sm/6 disabled:opacity-50"
            >
              {COOLOFF_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <StyledButton
            variant="primary"
            size="sm"
            onClick={handleSaveSchedule}
            disabled={!enabled}
          >
            Save Schedule
          </StyledButton>
        </div>

        {enabled && status && (
          <div className="mt-6 pt-4 border-t border-desert-stone-light text-sm">
            <p className="text-desert-stone mb-3">
              <span className="font-medium">Update window: </span>
              {status.windowStart}–{status.windowEnd} (
              {status.withinWindow ? 'currently inside' : 'currently outside'}); cool-off{' '}
              {status.cooloffHours}h.
              {status.lastResult && (
                <>
                  {' '}
                  <span className="font-medium">Last run: </span>
                  {status.lastResult}
                  {status.lastAttemptAt
                    ? ` (${new Date(status.lastAttemptAt).toLocaleString()})`
                    : ''}
                </>
              )}
            </p>

            {status.apps.length === 0 ? (
              <p className="text-desert-stone-dark">
                No apps are opted in yet. Enable auto-update on individual apps from the Supply
                Depot.
              </p>
            ) : (
              <ul className="space-y-2">
                {status.apps.map((app) => (
                  <li
                    key={app.service_name}
                    className="flex items-start justify-between gap-4 rounded-md bg-surface-secondary px-3 py-2"
                  >
                    <div>
                      <p className="font-medium text-text-primary">
                        {app.friendly_name || app.service_name}
                      </p>
                      <p className="text-desert-stone">
                        {app.current_version}
                        {app.available_update_version
                          ? ` → ${app.available_update_version}`
                          : ' (up to date)'}
                      </p>
                      {app.auto_disabled_reason && (
                        <p className="text-desert-red mt-0.5">{app.auto_disabled_reason}</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 text-xs font-medium ${
                        app.eligible ? 'text-desert-green' : 'text-desert-stone'
                      }`}
                    >
                      {app.reason}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </>
  )
}
