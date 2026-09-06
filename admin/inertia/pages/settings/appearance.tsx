import { useState } from 'react'
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

  const [selectedTheme, setSelectedTheme] = useState(theme)
  const [selectedAccent, setSelectedAccent] = useState<AccentValue>(accentColor)
  const [selectedDensity, setSelectedDensity] = useState(density)

  function handleThemeSelect(id: typeof theme) {
    setSelectedTheme(id)
  }

  function handleAccentSelect(value: AccentValue) {
    setSelectedAccent(value)
  }

  function handleDensitySelect(id: typeof density) {
    setSelectedDensity(id)
  }

  function handlePreview() {
    setPreviewTheme(selectedTheme)
    setPreviewAccent(selectedAccent)
    setPreviewDensity(selectedDensity)
  }

  function handleSave() {
    setTheme(selectedTheme)
    setAccentColor(selectedAccent)
    setDensity(selectedDensity)
    addNotification({ message: 'Appearance saved.', type: 'success' })
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
              Pick any combination of theme, accent, and density below. Click Preview to see it
              live, or Save to keep it.
            </span>
          </div>

          <StyledSectionHeader title="Theme" className="mt-8 mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {THEMES.map((t) => {
              const isSelected = selectedTheme === t.id
              const isSaved = theme === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => handleThemeSelect(t.id)}
                  className={classNames(
                    'group relative flex flex-col rounded-lg border-2 p-4 text-left transition-all cursor-pointer',
                    isSelected
                      ? 'border-desert-orange ring-2 ring-desert-orange/30'
                      : 'border-border-subtle hover:border-border-default hover:shadow-md'
                  )}
                  aria-pressed={isSelected}
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
                    {isSaved && <IconCheck className="size-5 text-desert-orange shrink-0" />}
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
                onClick={() => handleAccentSelect('default')}
                className={classNames(
                  'flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all cursor-pointer',
                  selectedAccent === 'default'
                    ? 'border-desert-orange ring-2 ring-desert-orange/30 text-text-primary'
                    : 'border-border-subtle hover:border-border-default text-text-secondary'
                )}
              >
                <div className="h-5 w-5 rounded-full border border-black/10 bg-linear-to-br from-desert-orange-dark via-desert-orange to-desert-orange-lighter" />
                Default
                {accentColor === 'default' && <IconCheck className="size-4 text-desert-orange" />}
              </button>
              {ACCENT_PRESETS.map((preset) => {
                const isSelected = selectedAccent === preset.id
                const isSaved = accentColor === preset.id
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleAccentSelect(preset.id)}
                    className={classNames(
                      'flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all cursor-pointer',
                      isSelected
                        ? 'border-desert-orange ring-2 ring-desert-orange/30 text-text-primary'
                        : 'border-border-subtle hover:border-border-default text-text-secondary'
                    )}
                  >
                    <div
                      className="h-5 w-5 rounded-full border border-black/10"
                      style={{ backgroundColor: preset.swatch }}
                    />
                    {preset.name}
                    {isSaved && <IconCheck className="size-4 text-desert-orange" />}
                  </button>
                )
              })}
              <div className="flex items-center gap-2 ml-2">
                <label
                  className={classNames(
                    'flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all cursor-pointer',
                    /^#[0-9a-fA-F]{6}$/.test(selectedAccent)
                      ? 'border-desert-orange ring-2 ring-desert-orange/30 text-text-primary'
                      : 'border-border-subtle hover:border-border-default text-text-secondary'
                  )}
                >
                  <IconColorSwatch className="size-4" />
                  Custom
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(selectedAccent) ? selectedAccent : '#a84a12'}
                    onChange={(e) => handleAccentSelect(e.target.value as AccentValue)}
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
                const isSelected = selectedDensity === opt.id
                const isSaved = density === opt.id
                return (
                  <button
                    key={opt.id}
                    onClick={() => handleDensitySelect(opt.id)}
                    className={classNames(
                      'flex flex-1 flex-col items-start rounded-lg border-2 p-4 text-left transition-all cursor-pointer',
                      isSelected
                        ? 'border-desert-orange ring-2 ring-desert-orange/30'
                        : 'border-border-subtle hover:border-border-default'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <IconSpacingVertical className="size-4 text-text-secondary" />
                      <span className="font-semibold text-text-primary">{opt.name}</span>
                      {isSaved && <IconCheck className="size-4 text-desert-orange" />}
                    </div>
                    <p className="text-xs text-text-muted">{opt.description}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-10 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <IconPalette className="size-4" />
              <span>Click Preview to try a combination, or Save to keep it.</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePreview}
                className="rounded-lg border-2 border-border-default px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-secondary transition-colors"
              >
                Preview
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-lg bg-desert-orange px-4 py-2 text-sm font-semibold text-white hover:bg-desert-orange-dark transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </main>
      </div>
    </SettingsLayout>
  )
}
