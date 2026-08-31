import {
  APP_SETTINGS_STORAGE_KEY,
  APP_THEME_CHANGED_EVENT,
  APP_THEME_META_COLORS,
  DEFAULT_APP_THEME,
  SYSTEM_THEME_MEDIA_QUERY,
  isDarkAppTheme,
  normalizeAppThemePreference,
  resolveAppTheme,
  type AppThemePreference,
  type ResolvedAppTheme,
} from '@/config/app-theme'

type ThemeStorage = Pick<Storage, 'getItem'>

interface PersistedSettingsEnvelope {
  state?: {
    appTheme?: unknown
  }
}

export interface AppliedAppTheme {
  preference: AppThemePreference
  resolvedTheme: ResolvedAppTheme
}

function getBrowserStorage(): ThemeStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readPersistedAppTheme(
  storage: ThemeStorage | null = getBrowserStorage(),
): AppThemePreference {
  if (!storage) return DEFAULT_APP_THEME

  try {
    const raw = storage.getItem(APP_SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_APP_THEME
    const persisted = JSON.parse(raw) as PersistedSettingsEnvelope
    return normalizeAppThemePreference(persisted.state?.appTheme)
  } catch {
    return DEFAULT_APP_THEME
  }
}

function getSystemPrefersDark(targetWindow: Pick<Window, 'matchMedia'> = window): boolean {
  return typeof targetWindow.matchMedia === 'function'
    ? targetWindow.matchMedia(SYSTEM_THEME_MEDIA_QUERY).matches
    : false
}

function updateThemeColorMeta(targetDocument: Document, theme: ResolvedAppTheme): void {
  let meta = targetDocument.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = targetDocument.createElement('meta')
    meta.name = 'theme-color'
    targetDocument.head.append(meta)
  }
  meta.content = APP_THEME_META_COLORS[theme]
}

export function applyAppTheme(
  preference: AppThemePreference,
  systemPrefersDark: boolean,
  targetDocument: Document = document,
): AppliedAppTheme {
  const resolvedTheme = resolveAppTheme(preference, systemPrefersDark)
  const root = targetDocument.documentElement
  const dark = isDarkAppTheme(resolvedTheme)

  root.dataset.themePreference = preference
  root.dataset.theme = resolvedTheme
  root.classList.toggle('dark', dark)
  root.classList.toggle('light', !dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  updateThemeColorMeta(targetDocument, resolvedTheme)

  const detail = { preference, resolvedTheme }
  const eventTarget = targetDocument.defaultView
  if (eventTarget?.CustomEvent) {
    eventTarget.dispatchEvent(
      new eventTarget.CustomEvent<AppliedAppTheme>(APP_THEME_CHANGED_EVENT, { detail }),
    )
  }

  return detail
}

export function applyInitialAppTheme(
  targetDocument: Document = document,
  targetWindow: Pick<Window, 'localStorage' | 'matchMedia'> = window,
): AppliedAppTheme {
  let storage: ThemeStorage | null = null
  try {
    storage = targetWindow.localStorage
  } catch {
    // Storage can be unavailable in private browsing. The default still applies.
  }

  return applyAppTheme(
    readPersistedAppTheme(storage),
    getSystemPrefersDark(targetWindow),
    targetDocument,
  )
}
