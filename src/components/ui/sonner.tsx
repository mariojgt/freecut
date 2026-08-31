import { useEffect, useState } from 'react'
import { Toaster as Sonner } from 'sonner'
import { APP_THEME_CHANGED_EVENT, type ResolvedAppTheme } from '@/config/app-theme'

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  )

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      const resolvedTheme = (event as CustomEvent<{ resolvedTheme: ResolvedAppTheme }>).detail
        ?.resolvedTheme
      setTheme(resolvedTheme === 'light' ? 'light' : 'dark')
    }

    window.addEventListener(APP_THEME_CHANGED_EVENT, handleThemeChange)
    return () => window.removeEventListener(APP_THEME_CHANGED_EVENT, handleThemeChange)
  }, [])

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="bottom-right"
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
