// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { APP_SETTINGS_STORAGE_KEY, APP_THEME_CHANGED_EVENT } from '@/config/app-theme'
import { applyAppTheme, readPersistedAppTheme } from './theme'

describe('app theme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('class')
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-preference')
    document.documentElement.removeAttribute('style')
    document.head.innerHTML = '<meta name="theme-color" content="#111827">'
  })

  it('reads and validates the persisted Zustand setting', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ state: { appTheme: 'midnight' }, version: 3 })),
    }

    expect(readPersistedAppTheme(storage)).toBe('midnight')
    expect(storage.getItem).toHaveBeenCalledWith(APP_SETTINGS_STORAGE_KEY)

    storage.getItem.mockReturnValue(JSON.stringify({ state: { appTheme: 'unknown' } }))
    expect(readPersistedAppTheme(storage)).toBe('system')
  })

  it('resolves system light and updates the document chrome', () => {
    const listener = vi.fn()
    window.addEventListener(APP_THEME_CHANGED_EVENT, listener)

    expect(applyAppTheme('system', false)).toEqual({
      preference: 'system',
      resolvedTheme: 'light',
    })
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.themePreference).toBe('system')
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#f6f7f9')
    expect(listener).toHaveBeenCalledOnce()

    window.removeEventListener(APP_THEME_CHANGED_EVENT, listener)
  })

  it('keeps explicit dark themes dark independently of the system preference', () => {
    applyAppTheme('midnight', false)

    expect(document.documentElement.dataset.theme).toBe('midnight')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#0b1020')
  })
})
