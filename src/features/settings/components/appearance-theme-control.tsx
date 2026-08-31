import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { type AppThemePreference } from '@/config/app-theme'
import { useSettingsStore } from '../stores/settings-store'

const THEME_OPTIONS: ReadonlyArray<{
  value: AppThemePreference
  labelKey: string
  swatches: readonly [string, string, string]
}> = [
  {
    value: 'system',
    labelKey: 'settings.general.themeSystem',
    swatches: ['#f6f7f9', '#262626', '#f97316'],
  },
  {
    value: 'freecut-dark',
    labelKey: 'settings.general.themeFreeCutDark',
    swatches: ['#262626', '#3d3d3d', '#ff8c3a'],
  },
  {
    value: 'midnight',
    labelKey: 'settings.general.themeMidnight',
    swatches: ['#0b1020', '#17213a', '#5b9cff'],
  },
  {
    value: 'light',
    labelKey: 'settings.general.themeLight',
    swatches: ['#f6f7f9', '#e5e7eb', '#d95f19'],
  },
]

function ThemeSwatches({ colors }: { colors: readonly [string, string, string] }) {
  return (
    <span
      className="flex overflow-hidden rounded-full border border-foreground/15"
      aria-hidden="true"
    >
      {colors.map((color, index) => (
        <span
          key={`${color}-${index}`}
          className="h-3.5 w-3.5"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  )
}

export function AppearanceThemeControl() {
  const { t } = useTranslation()
  const appTheme = useSettingsStore((state) => state.appTheme)
  const setSetting = useSettingsStore((state) => state.setSetting)

  return (
    <div className="flex items-start justify-between gap-5">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor="app-theme-select" className="text-sm">
          {t('settings.general.appearance')}
        </Label>
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          {t('settings.general.appearanceDescription')}
        </p>
      </div>
      <Select
        value={appTheme}
        onValueChange={(value) => setSetting('appTheme', value as AppThemePreference)}
      >
        <SelectTrigger
          id="app-theme-select"
          data-testid="app-theme-select"
          className="w-48 shrink-0"
          aria-label={t('settings.general.appearance')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {THEME_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex items-center gap-2">
                <ThemeSwatches colors={option.swatches} />
                <span>{t(option.labelKey)}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
