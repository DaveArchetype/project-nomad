import { createContext, useContext } from 'react'
import { useAppearance } from '~/hooks/useAppearance'
import type { AccentValue, DensityId, ThemeId } from '~/lib/themes'

interface AppearanceContextType {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
  accentColor: AccentValue
  setAccentColor: (accent: AccentValue) => void
  density: DensityId
  setDensity: (density: DensityId) => void
  previewTheme: ThemeId | null
  setPreviewTheme: (id: ThemeId | null) => void
  previewAccent: AccentValue | null
  setPreviewAccent: (value: AccentValue | null) => void
  previewDensity: DensityId | null
  setPreviewDensity: (id: DensityId | null) => void
}

const AppearanceContext = createContext<AppearanceContextType>({
  theme: 'light',
  setTheme: () => {},
  accentColor: 'default',
  setAccentColor: () => {},
  density: 'comfortable',
  setDensity: () => {},
  previewTheme: null,
  setPreviewTheme: () => {},
  previewAccent: null,
  setPreviewAccent: () => {},
  previewDensity: null,
  setPreviewDensity: () => {},
})

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const appearanceState = useAppearance()
  return <AppearanceContext.Provider value={appearanceState}>{children}</AppearanceContext.Provider>
}

export function useAppearanceContext() {
  return useContext(AppearanceContext)
}
