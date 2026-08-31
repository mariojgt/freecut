// @vitest-environment jsdom

import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useSettingsStore } from '@/features/settings/stores/settings-store'
import { AppThemeController } from './app-theme-controller'

describe('AppThemeController', () => {
  const listeners = new Set<() => void>()
  const mediaQuery = {
    matches: false,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }

  beforeEach(() => {
    listeners.clear()
    mediaQuery.matches = false
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mediaQuery),
    )
    useSettingsStore.getState().resetToDefaults()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('applies explicit themes immediately and follows system changes only in system mode', () => {
    render(<AppThemeController />)
    expect(document.documentElement.dataset.theme).toBe('light')

    act(() => useSettingsStore.getState().setSetting('appTheme', 'midnight'))
    expect(document.documentElement.dataset.theme).toBe('midnight')

    mediaQuery.matches = true
    act(() => listeners.forEach((listener) => listener()))
    expect(document.documentElement.dataset.theme).toBe('midnight')

    act(() => useSettingsStore.getState().setSetting('appTheme', 'system'))
    expect(document.documentElement.dataset.theme).toBe('freecut-dark')
  })
})
