export const THEME_IDS = [
  'light',
  'paper',
  'cream',
  'mist',
  'frost',
  'rose',
  'sage',
  'sand',
  'linen',
  'porcelain',
  'blossom',
  'honey',
  'seashell',
  'meadow',
  'dark',
  'midnight',
  'slate',
  'obsidian',
  'charcoal',
  'forest',
  'ocean',
  'plum',
  'ruby',
  'copper',
  'emerald',
  'indigo',
  'carbon',
] as const

export type ThemeId = (typeof THEME_IDS)[number]

export const DENSITY_IDS = ['comfortable', 'compact'] as const
export type DensityId = (typeof DENSITY_IDS)[number]

export const ACCENT_PRESET_IDS = [
  'orange',
  'green',
  'blue',
  'violet',
  'rose',
  'amber',
  'teal',
  'crimson',
  'sky',
  'lime',
] as const
export type AccentPresetId = (typeof ACCENT_PRESET_IDS)[number]

export function isValidThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
}

export function isValidDensityId(value: unknown): value is DensityId {
  return typeof value === 'string' && (DENSITY_IDS as readonly string[]).includes(value)
}

export function isValidAccentValue(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (value === '' || value === 'default') return true
  if ((ACCENT_PRESET_IDS as readonly string[]).includes(value)) return true
  return /^#[0-9a-fA-F]{6}$/.test(value)
}
