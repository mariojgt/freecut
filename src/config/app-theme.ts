export const APP_SETTINGS_STORAGE_KEY = 'freecut-settings'
export const SYSTEM_THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)'
export const APP_THEME_CHANGED_EVENT = 'freecut:theme-changed'

const APP_THEME_PREFERENCES = ['system', 'freecut-dark', 'midnight', 'light'] as const

export type AppThemePreference = (typeof APP_THEME_PREFERENCES)[number]
export type ResolvedAppTheme = Exclude<AppThemePreference, 'system'>

export const DEFAULT_APP_THEME: AppThemePreference = 'system'

export const APP_THEME_META_COLORS: Record<ResolvedAppTheme, string> = {
  'freecut-dark': '#262626',
  midnight: '#0b1020',
  light: '#f6f7f9',
}

export function normalizeAppThemePreference(value: unknown): AppThemePreference {
  return APP_THEME_PREFERENCES.includes(value as AppThemePreference)
    ? (value as AppThemePreference)
    : DEFAULT_APP_THEME
}

export function resolveAppTheme(
  preference: AppThemePreference,
  systemPrefersDark: boolean,
): ResolvedAppTheme {
  if (preference === 'system') {
    return systemPrefersDark ? 'freecut-dark' : 'light'
  }
  return preference
}

export function isDarkAppTheme(theme: ResolvedAppTheme): boolean {
  return theme !== 'light'
}
