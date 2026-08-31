import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { i18n } from '@/i18n'
import { useSettingsStore } from '../stores/settings-store'
import { AppearanceThemeControl } from './appearance-theme-control'

describe('AppearanceThemeControl', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useSettingsStore.getState().resetToDefaults()
  })

  it('shows the persisted theme and reacts to store changes', () => {
    render(<AppearanceThemeControl />)

    const select = screen.getByTestId('app-theme-select')
    expect(select).toHaveAccessibleName('Appearance')
    expect(select).toHaveTextContent('System')
    expect(
      screen.getByText('Choose the app theme. System follows your device setting.'),
    ).toBeVisible()

    act(() => useSettingsStore.getState().setSetting('appTheme', 'light'))
    expect(select).toHaveTextContent('Light')
  })
})
