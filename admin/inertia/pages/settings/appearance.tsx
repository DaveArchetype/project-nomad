import { Head } from '@inertiajs/react'
import {
  IconCheck,
  IconPalette,
  IconColorSwatch,
  IconSpacingVertical,
  IconEye,
} from '@tabler/icons-react'
import SettingsLayout from '~/layouts/SettingsLayout'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import { useNotifications } from '~/context/NotificationContext'
import { useAppearanceContext } from '~/providers/ThemeProvider'
import { ACCENT_PRESETS, DENSITY_OPTIONS, THEMES, type AccentValue } from '~/lib/themes'
import classNames from 'classnames'

export default function AppearancePage() {
  const { addNotification } = useNotifications()
  const {
    theme,
    setTheme,
    accentColor,
    setAccentColor,
    density,
    setDensity,
    setPreviewTheme,
    setPreviewAccent,
    setPreviewDensity,
  } = useAppearanceContext()

  function handleThemeChange(id: typeof theme) {
    setTheme(id)
    addNotification({
      message: `Theme set to ${THEMES.find((t) => t.id === id)?.name}`,
      type: 'success',
    })
  }

  function handleAccentChange(value: AccentValue) {
    setAccentColor(value)
    if (value === 'default') {
      addNotification({ message: 'Accent color reset to theme default.', type: 'success' })
    } else {
      addNotification({ message: 'Accent color updated.', type: 'success' })
    }
  }

  function handleDensityChange(id: typeof density) {
    setDensity(id)
    addNotification({ message: `Density set to ${id}.`, type: 'success' })
  }

  return (
    <SettingsLayout>
      <Head title="Appearance | Project NOMAD" />
      <div className="xl:pl-72 w-full">
        <main className="px-12 py-6 max-w-5xl">
          <h1 className="text-4xl font-semibold mb-4">Appearance</h1>
          <p className="text-text-muted mb-4 text-lg">
            Personalize the look and feel of your Command Center. Choose a theme, an accent color,
            and a layout density.
          </p>
          <div className="mb-10 flex items-center gap-2 text-sm text-text-muted bg-surface-primary border border-border-subtle rounded-lg px-4 py-2.5">
            <IconEye className="size-4 shrink-0" />
            <span>
              Hover any option to preview it live across the app — click to apply and save.
            </span>
          </div>

          <StyledSectionHeader title="Theme" className="mt-8 mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {THEMES.map((t) => {
              const isActive = theme === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => handleThemeChange(t.id)}
                  onMouseEnter={() => setPreviewTheme(t.id)}
                  onMouseLeave={() => setPreviewTheme(null)}
                  onFocus={() => setPreviewTheme(t.id)}
                  onBlur={() => setPreviewTheme(null)}
                  className={classNames(
                    'group relative flex flex-col rounded-lg border-2 p-4 text-left transition-all cursor-pointer',
                    isActive
                      ? 'border-desert-orange ring-2 ring-desert-orange/30'
                      : 'border-border-subtle hover:border-border-default hover:shadow-md'
                  )}
                  aria-pressed={isActive}
                >
                  <div className="flex gap-1.5 mb-3">
                    {t.swatches.map((color, i) => (
                      <div
                        key={i}
                        className="h-8 w-8 rounded-md border border-black/10"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-text-primary">{t.name}</p>
                      <p className="text-xs text-text-muted">{t.description}</p>
                    </div>
                    {isActive && <IconCheck className="size-5 text-desert-orange shrink-0" />}
                  </div>
                  <span
                    className={classNames(
                      'mt-2 inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                      t.mode === 'dark'
                        ? 'bg-desert-stone-light/20 text-text-secondary'
                        : 'bg-desert-orange/10 text-desert-orange-dark'
                    )}
                  >
                    {t.mode}
                  </span>
                </button>
              )
            })}
          </div>

          <StyledSectionHeader title="Accent Color" className="mt-12 mb-4" />
          <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-6">
            <p className="text-sm text-text-secondary mb-4">
              Override the accent color used for buttons, links, and highlights. Pick a preset or
              choose a custom color. Select "Default" to use the theme's built-in accent.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => handleAccentChange('default')}
                onMouseEnter={() => setPreviewAccent('default')}
                onMouseLeave={() => setPreviewAccent(null)}
                onFocus={() => setPreviewAccent('default')}
                onBlur={() => setPreviewAccent(null)}
                className={classNames(
                  'flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all cursor-pointer',
                  accentColor === 'default'
                    ? 'border-desert-orange ring-2 ring-desert-orange/30 text-text-primary'
                    : 'border-border-subtle hover:border-border-default text-text-secondary'
                )}
              >
                <div className="h-5 w-5 rounded-full border border-black/10 bg-linear-to-br from-desert-orange-dark via-desert-orange to-desert-orange-lighter" />
                Default
                {accentColor === 'default' && <IconCheck className="size-4 text-desert-orange" />}
              </button>
              {ACCENT_PRESETS.map((preset) => {
                const isActive = accentColor === preset.id
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleAccentChange(preset.id)}
                    onMouseEnter={() => setPreviewAccent(preset.id)}
                    onMouseLeave={() => setPreviewAccent(null)}
                    onFocus={() => setPreviewAccent(preset.id)}
                    onBlur={() => setPreviewAccent(null)}
                    className={classNames(
                      'flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all cursor-pointer',
                      isActive
                        ? 'border-desert-orange ring-2 ring-desert-orange/30 text-text-primary'
                        : 'border-border-subtle hover:border-border-default text-text-secondary'
                    )}
                  >
                    <div
                      className="h-5 w-5 rounded-full border border-black/10"
                      style={{ backgroundColor: preset.swatch }}
                    />
                    {preset.name}
                    {isActive && <IconCheck className="size-4 text-desert-orange" />}
                  </button>
                )
              })}
              <div className="flex items-center gap-2 ml-2">
                <label
                  className={classNames(
                    'flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all cursor-pointer',
                    /^#[0-9a-fA-F]{6}$/.test(accentColor)
                      ? 'border-desert-orange ring-2 ring-desert-orange/30 text-text-primary'
                      : 'border-border-subtle hover:border-border-default text-text-secondary'
                  )}
                >
                  <IconColorSwatch className="size-4" />
                  Custom
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : '#a84a12'}
                    onInput={(e) =>
                      setPreviewAccent((e.target as HTMLInputElement).value as AccentValue)
                    }
                    onChange={(e) => handleAccentChange(e.target.value as AccentValue)}
                    className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                    aria-label="Custom accent color"
                  />
                </label>
              </div>
            </div>
          </div>

          <StyledSectionHeader title="Layout Density" className="mt-12 mb-4" />
          <div className="bg-surface-primary rounded-lg border-2 border-border-subtle p-6">
            <p className="text-sm text-text-secondary mb-4">
              Control how spacious the interface feels. Compact shrinks spacing and text globally,
              fitting more content per screen.
            </p>
            <div className="flex gap-3">
              {DENSITY_OPTIONS.map((opt) => {
                const isActive = density === opt.id
                return (
                  <button
                    key={opt.id}
                    onClick={() => handleDensityChange(opt.id)}
                    onMouseEnter={() => setPreviewDensity(opt.id)}
                    onMouseLeave={() => setPreviewDensity(null)}
                    onFocus={() => setPreviewDensity(opt.id)}
                    onBlur={() => setPreviewDensity(null)}
                    className={classNames(
                      'flex flex-1 flex-col items-start rounded-lg border-2 p-4 text-left transition-all cursor-pointer',
                      isActive
                        ? 'border-desert-orange ring-2 ring-desert-orange/30'
                        : 'border-border-subtle hover:border-border-default'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <IconSpacingVertical className="size-4 text-text-secondary" />
                      <span className="font-semibold text-text-primary">{opt.name}</span>
                      {isActive && <IconCheck className="size-4 text-desert-orange" />}
                    </div>
                    <p className="text-xs text-text-muted">{opt.description}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-10 flex items-center gap-2 text-sm text-text-muted">
            <IconPalette className="size-4" />
            <span>Preferences are saved automatically and synced across your devices.</span>
          </div>
        </main>
      </div>
    </SettingsLayout>
  )
}
