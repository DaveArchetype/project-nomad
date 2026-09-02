import { useState, useEffect, useCallback } from 'react'
import api from '~/lib/api'
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  DEFAULT_DENSITY,
  DEFAULT_THEME,
  isAccentPresetId,
  isDensityId,
  isThemeId,
  type AccentValue,
  type DensityId,
  type ThemeId,
} from '~/lib/themes'

const THEME_KEY = 'nomad:theme'
const ACCENT_KEY = 'nomad:accentColor'
const ACCENT_SHADES_KEY = 'nomad:accentShades'
const DENSITY_KEY = 'nomad:density'

export interface AccentShades {
  dark: string
  main: string
  light: string
  lighter: string
}

function getInitialTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored && isThemeId(stored)) return stored
  } catch {}
  return DEFAULT_THEME
}

function getInitialAccent(): AccentValue {
  try {
    const stored = localStorage.getItem(ACCENT_KEY)
    if (!stored || stored === 'default') return 'default'
    if (isAccentPresetId(stored)) return stored
    if (/^#[0-9a-fA-F]{6}$/.test(stored)) return stored as `#${string}`
  } catch {}
  return DEFAULT_ACCENT as AccentValue
}

function getInitialDensity(): DensityId {
  try {
    const stored = localStorage.getItem(DENSITY_KEY)
    if (stored && isDensityId(stored)) return stored
  } catch {}
  return DEFAULT_DENSITY
}

function deriveShadesFromHex(hex: string): AccentShades {
  return {
    dark: `color-mix(in srgb, ${hex} 75%, black)`,
    main: hex,
    light: `color-mix(in srgb, ${hex} 85%, white)`,
    lighter: `color-mix(in srgb, ${hex} 65%, white)`,
  }
}

export function resolveAccentShades(accent: AccentValue): AccentShades | null {
  if (accent === 'default' || accent === '') return null
  if (isAccentPresetId(accent)) {
    const preset = ACCENT_PRESETS.find((p) => p.id === accent)
    return preset ? preset.shades : null
  }
  if (/^#[0-9a-fA-F]{6}$/.test(accent)) {
    return deriveShadesFromHex(accent)
  }
  return null
}

function applyAccentShades(shades: AccentShades | null) {
  const root = document.documentElement
  if (!shades) {
    root.style.removeProperty('--color-desert-orange-dark')
    root.style.removeProperty('--color-desert-orange')
    root.style.removeProperty('--color-desert-orange-light')
    root.style.removeProperty('--color-desert-orange-lighter')
    return
  }
  root.style.setProperty('--color-desert-orange-dark', shades.dark)
  root.style.setProperty('--color-desert-orange', shades.main)
  root.style.setProperty('--color-desert-orange-light', shades.light)
  root.style.setProperty('--color-desert-orange-lighter', shades.lighter)
}

export function useAppearance() {
  const [theme, setThemeState] = useState<ThemeId>(getInitialTheme)
  const [accentColor, setAccentState] = useState<AccentValue>(getInitialAccent)
  const [density, setDensityState] = useState<DensityId>(getInitialDensity)

  const [previewTheme, setPreviewThemeState] = useState<ThemeId | null>(null)
  const [previewAccent, setPreviewAccentState] = useState<AccentValue | null>(null)
  const [previewDensity, setPreviewDensityState] = useState<DensityId | null>(null)

  const setTheme = useCallback((newTheme: ThemeId) => {
    setThemeState(newTheme)
    setPreviewThemeState(null)
    document.documentElement.setAttribute('data-theme', newTheme)
    try {
      localStorage.setItem(THEME_KEY, newTheme)
    } catch {}
    api.updateSetting('ui.theme', newTheme).catch(() => {})
  }, [])

  const setAccentColor = useCallback((newAccent: AccentValue) => {
    setAccentState(newAccent)
    setPreviewAccentState(null)
    const shades = resolveAccentShades(newAccent)
    applyAccentShades(shades)
    try {
      localStorage.setItem(ACCENT_KEY, newAccent)
      if (shades) {
        localStorage.setItem(ACCENT_SHADES_KEY, JSON.stringify(shades))
      } else {
        localStorage.removeItem(ACCENT_SHADES_KEY)
      }
    } catch {}
    api.updateSetting('ui.accentColor', newAccent).catch(() => {})
  }, [])

  const setDensity = useCallback((newDensity: DensityId) => {
    setDensityState(newDensity)
    setPreviewDensityState(null)
    document.documentElement.setAttribute('data-density', newDensity)
    try {
      localStorage.setItem(DENSITY_KEY, newDensity)
    } catch {}
    api.updateSetting('ui.density', newDensity).catch(() => {})
  }, [])

  const setPreviewTheme = useCallback(
    (id: ThemeId | null) => {
      setPreviewThemeState(id)
      document.documentElement.setAttribute('data-theme', id ?? theme)
    },
    [theme]
  )

  const setPreviewAccent = useCallback(
    (value: AccentValue | null) => {
      setPreviewAccentState(value)
      if (value === null) {
        applyAccentShades(resolveAccentShades(accentColor))
      } else {
        applyAccentShades(resolveAccentShades(value))
      }
    },
    [accentColor]
  )

  const setPreviewDensity = useCallback(
    (id: DensityId | null) => {
      setPreviewDensityState(id)
      document.documentElement.setAttribute('data-density', id ?? density)
    },
    [density]
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.setAttribute('data-density', density)
    applyAccentShades(resolveAccentShades(accentColor))
  }, [])

  return {
    theme,
    setTheme,
    accentColor,
    setAccentColor,
    density,
    setDensity,
    previewTheme,
    setPreviewTheme,
    previewAccent,
    setPreviewAccent,
    previewDensity,
    setPreviewDensity,
  }
}
