import { useLayoutEffect } from 'react'
import { SYSTEM_THEME_MEDIA_QUERY } from '@/config/app-theme'
import { useSettingsStore } from '@/features/settings/stores/settings-store'
import { applyAppTheme } from './theme'

export function AppThemeController() {
  const appTheme = useSettingsStore((state) => state.appTheme)

  useLayoutEffect(() => {
    const mediaQuery =
      typeof window.matchMedia === 'function' ? window.matchMedia(SYSTEM_THEME_MEDIA_QUERY) : null
    const syncTheme = () => applyAppTheme(appTheme, mediaQuery?.matches ?? false)

    syncTheme()

    if (appTheme !== 'system' || !mediaQuery) return

    mediaQuery.addEventListener('change', syncTheme)
    return () => mediaQuery.removeEventListener('change', syncTheme)
  }, [appTheme])

  return null
}
