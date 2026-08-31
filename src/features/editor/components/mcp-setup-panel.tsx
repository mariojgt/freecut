import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cable, Check, Copy, ServerCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MCP_DOCKER_CLIENT_CONFIG, MCP_DOCKER_START_COMMAND } from './mcp-setup-config'

async function writeTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the selection-based copy path for restricted browsers.
  }

  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

type CopyState = 'idle' | 'copied' | 'error'

/** One-click Docker MCP setup for external LLM clients. */
export const McpSetupPanel = memo(function McpSetupPanel() {
  const { t } = useTranslation()
  const [copyState, setCopyState] = useState<CopyState>('idle')

  const handleCopy = useCallback(async () => {
    const copied = await writeTextToClipboard(MCP_DOCKER_CLIENT_CONFIG)
    setCopyState(copied ? 'copied' : 'error')
  }, [])

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="space-y-4 rounded-lg border border-border bg-secondary/20 p-3">
        <div className="flex items-start gap-2.5">
          <div className="rounded-md bg-primary/15 p-2 text-primary">
            <Cable className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">{t('editor.agent.mcp.title')}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t('editor.agent.mcp.description')}
            </p>
          </div>
        </div>

        <section className="space-y-1.5">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <ServerCog className="h-3.5 w-3.5 text-primary" />
            {t('editor.agent.mcp.startTitle')}
          </h4>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t('editor.agent.mcp.startHint')}
          </p>
          <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-background p-2 font-mono text-[10px] leading-relaxed text-foreground select-text">
            <code>{MCP_DOCKER_START_COMMAND}</code>
          </pre>
        </section>

        <section className="space-y-1.5">
          <h4 className="text-xs font-medium text-foreground">
            {t('editor.agent.mcp.configTitle')}
          </h4>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t('editor.agent.mcp.configHint')}
          </p>
          <pre
            data-testid="mcp-client-config"
            className="max-h-48 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[10px] leading-relaxed text-foreground select-text"
          >
            <code>{MCP_DOCKER_CLIENT_CONFIG}</code>
          </pre>
          <Button
            data-testid="mcp-copy-config-button"
            size="sm"
            className="h-8 w-full gap-1.5"
            onClick={() => void handleCopy()}
          >
            {copyState === 'copied' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copyState === 'copied'
              ? t('editor.agent.mcp.copied')
              : t('editor.agent.mcp.copyConfig')}
          </Button>
          {copyState === 'error' && (
            <p role="alert" className="text-[11px] leading-relaxed text-destructive">
              {t('editor.agent.mcp.copyFailed')}
            </p>
          )}
        </section>

        <div className="space-y-1 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
          <p>{t('editor.agent.mcp.capabilities')}</p>
          <p>{t('editor.agent.mcp.dockerNote')}</p>
        </div>
      </div>
    </div>
  )
})
