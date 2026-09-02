import {
  ACCENT_PRESET_IDS,
  DENSITY_IDS,
  THEME_IDS,
  type AccentPresetId,
  type DensityId,
  type ThemeId,
} from '../../constants/themes'

export type { AccentPresetId, DensityId, ThemeId }

export interface ThemeDefinition {
  id: ThemeId
  name: string
  description: string
  mode: 'light' | 'dark'
  swatches: [string, string, string, string]
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'light',
    name: 'Day Ops',
    description: 'Warm sand default',
    mode: 'light',
    swatches: ['#f7eedc', '#424420', '#a84a12', '#8b7355'],
  },
  {
    id: 'paper',
    name: 'Paper',
    description: 'Crisp off-white',
    mode: 'light',
    swatches: ['#faf8f3', '#3a3a3a', '#c0392b', '#7f8c8d'],
  },
  {
    id: 'cream',
    name: 'Cream',
    description: 'Soft dairy tones',
    mode: 'light',
    swatches: ['#fdf6e3', '#586e75', '#cb4b16', '#b58900'],
  },
  {
    id: 'mist',
    name: 'Mist',
    description: 'Cool grey haze',
    mode: 'light',
    swatches: ['#f4f6f8', '#2d3748', '#3182ce', '#718096'],
  },
  {
    id: 'frost',
    name: 'Frost',
    description: 'Icy blue-white',
    mode: 'light',
    swatches: ['#f0f7ff', '#1a365d', '#2b6cb0', '#a0aec0'],
  },
  {
    id: 'rose',
    name: 'Rose',
    description: 'Blush petal',
    mode: 'light',
    swatches: ['#fff5f7', '#831843', '#be185d', '#f472b6'],
  },
  {
    id: 'sage',
    name: 'Sage',
    description: 'Muted garden green',
    mode: 'light',
    swatches: ['#f0f4ec', '#3d4a2a', '#6b8e4e', '#a3b18a'],
  },
  {
    id: 'sand',
    name: 'Sand',
    description: 'Desert dune',
    mode: 'light',
    swatches: ['#f5ecd9', '#6b5d3f', '#c8965a', '#d4b896'],
  },
  {
    id: 'linen',
    name: 'Linen',
    description: 'Natural fiber',
    mode: 'light',
    swatches: ['#faf6f0', '#4a4036', '#a0522d', '#c9b99f'],
  },
  {
    id: 'porcelain',
    name: 'Porcelain',
    description: 'Glazed ceramic',
    mode: 'light',
    swatches: ['#fbfcfd', '#1e293b', '#0ea5e9', '#94a3b8'],
  },
  {
    id: 'blossom',
    name: 'Blossom',
    description: 'Spring orchard',
    mode: 'light',
    swatches: ['#fff0f6', '#9d174d', '#ec4899', '#f9a8d4'],
  },
  {
    id: 'honey',
    name: 'Honey',
    description: 'Golden amber',
    mode: 'light',
    swatches: ['#fffbeb', '#78350f', '#d97706', '#fbbf24'],
  },
  {
    id: 'seashell',
    name: 'Seashell',
    description: 'Coastal pearl',
    mode: 'light',
    swatches: ['#fdfbf7', '#455a64', '#26a69a', '#b0bec5'],
  },
  {
    id: 'meadow',
    name: 'Meadow',
    description: 'Sunlit grass',
    mode: 'light',
    swatches: ['#f7faf5', '#2d5016', '#4d7c0f', '#84cc16'],
  },
  {
    id: 'dark',
    name: 'Night Ops',
    description: 'Warm charcoal',
    mode: 'dark',
    swatches: ['#1c1b16', '#f7eedc', '#c85815', '#8f8f82'],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Deep night blue',
    mode: 'dark',
    swatches: ['#0f172a', '#e2e8f0', '#3b82f6', '#64748b'],
  },
  {
    id: 'slate',
    name: 'Slate',
    description: 'Cool stone grey',
    mode: 'dark',
    swatches: ['#1e293b', '#f1f5f9', '#6366f1', '#94a3b8'],
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    description: 'Pure volcanic black',
    mode: 'dark',
    swatches: ['#0a0a0a', '#fafafa', '#ef4444', '#737373'],
  },
  {
    id: 'charcoal',
    name: 'Charcoal',
    description: 'Smoky graphite',
    mode: 'dark',
    swatches: ['#1a1a1a', '#ededed', '#f97316', '#525252'],
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Deep woodland',
    mode: 'dark',
    swatches: ['#1a2e1a', '#e8f5e9', '#4caf50', '#81c784'],
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Abyssal teal',
    mode: 'dark',
    swatches: ['#0c2a2a', '#e0f7f7', '#14b8a6', '#5eead4'],
  },
  {
    id: 'plum',
    name: 'Plum',
    description: 'Ripe orchard',
    mode: 'dark',
    swatches: ['#2d1b2e', '#fce7f3', '#a855f7', '#c084fc'],
  },
  {
    id: 'ruby',
    name: 'Ruby',
    description: 'Jeweled crimson',
    mode: 'dark',
    swatches: ['#2a0a0a', '#fee2e2', '#dc2626', '#f87171'],
  },
  {
    id: 'copper',
    name: 'Copper',
    description: 'Burnished metal',
    mode: 'dark',
    swatches: ['#2b1d10', '#fef3c7', '#d97706', '#fbbf24'],
  },
  {
    id: 'emerald',
    name: 'Emerald',
    description: 'Polished gem',
    mode: 'dark',
    swatches: ['#0a2818', '#d1fae5', '#10b981', '#34d399'],
  },
  {
    id: 'indigo',
    name: 'Indigo',
    description: 'Twilight bloom',
    mode: 'dark',
    swatches: ['#1a1a3a', '#e0e7ff', '#6366f1', '#818cf8'],
  },
  {
    id: 'carbon',
    name: 'Carbon',
    description: 'Industrial dark',
    mode: 'dark',
    swatches: ['#18181b', '#fafafa', '#a1a1aa', '#71717a'],
  },
]

export interface AccentPreset {
  id: AccentPresetId
  name: string
  shades: { dark: string; main: string; light: string; lighter: string }
  swatch: string
}

export const ACCENT_PRESETS: AccentPreset[] = [
  {
    id: 'orange',
    name: 'Desert Orange',
    swatch: '#a84a12',
    shades: { dark: '#8a3d0f', main: '#a84a12', light: '#c85815', lighter: '#e69556' },
  },
  {
    id: 'green',
    name: 'Olive Green',
    swatch: '#6d7042',
    shades: { dark: '#5a5c3a', main: '#6d7042', light: '#858a55', lighter: '#a5ab7d' },
  },
  {
    id: 'blue',
    name: 'Ocean Blue',
    swatch: '#2563eb',
    shades: { dark: '#1e40af', main: '#2563eb', light: '#3b82f6', lighter: '#93c5fd' },
  },
  {
    id: 'violet',
    name: 'Iris Violet',
    swatch: '#7c3aed',
    shades: { dark: '#5b21b6', main: '#7c3aed', light: '#8b5cf6', lighter: '#c4b5fd' },
  },
  {
    id: 'rose',
    name: 'Garden Rose',
    swatch: '#e11d48',
    shades: { dark: '#9f1239', main: '#e11d48', light: '#f43f5e', lighter: '#fda4af' },
  },
  {
    id: 'amber',
    name: 'Honey Amber',
    swatch: '#d97706',
    shades: { dark: '#92400e', main: '#d97706', light: '#f59e0b', lighter: '#fcd34d' },
  },
  {
    id: 'teal',
    name: 'Lagoon Teal',
    swatch: '#0d9488',
    shades: { dark: '#115e59', main: '#0d9488', light: '#14b8a6', lighter: '#5eead4' },
  },
  {
    id: 'crimson',
    name: 'Crimson',
    swatch: '#b91c1c',
    shades: { dark: '#7f1d1d', main: '#b91c1c', light: '#dc2626', lighter: '#fca5a5' },
  },
  {
    id: 'sky',
    name: 'Sky',
    swatch: '#0284c7',
    shades: { dark: '#075985', main: '#0284c7', light: '#0ea5e9', lighter: '#7dd3fc' },
  },
  {
    id: 'lime',
    name: 'Citrus Lime',
    swatch: '#65a30d',
    shades: { dark: '#3f6212', main: '#65a30d', light: '#84cc16', lighter: '#bef264' },
  },
]

export const DENSITY_OPTIONS: { id: DensityId; name: string; description: string }[] = [
  { id: 'comfortable', name: 'Comfortable', description: 'Spacious default layout' },
  { id: 'compact', name: 'Compact', description: 'Tighter spacing, more content per screen' },
]

export const DEFAULT_THEME: ThemeId = 'light'
export const DEFAULT_ACCENT = 'default'
export const DEFAULT_DENSITY: DensityId = 'comfortable'

export function getThemeDefinition(id: ThemeId): ThemeDefinition {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export function getAccentPreset(id: AccentPresetId): AccentPreset | undefined {
  return ACCENT_PRESETS.find((p) => p.id === id)
}

export function isAccentPresetId(value: string): value is AccentPresetId {
  return (ACCENT_PRESET_IDS as readonly string[]).includes(value)
}

export function isDensityId(value: string): value is DensityId {
  return (DENSITY_IDS as readonly string[]).includes(value)
}

export function isThemeId(value: string): value is ThemeId {
  return (THEME_IDS as readonly string[]).includes(value)
}

export type AccentValue = 'default' | AccentPresetId | `#${string}`
