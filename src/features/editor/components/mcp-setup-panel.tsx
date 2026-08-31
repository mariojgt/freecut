import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cable, Check, Copy, ServerCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  MCP_DIRECT_CLIENT_CONFIG,
  MCP_DOCKER_CLIENT_CONFIG,
  MCP_DOCKER_REMOTE_START_COMMAND,
  MCP_DOCKER_START_COMMAND,
  MCP_REMOTE_CLIENT_CONFIG,
  MCP_REMOTE_CLIENT_CONFIG_WITH_TOKEN,
  MCP_REMOTE_START_COMMAND,
} from './mcp-setup-config'

type CopyState = 'idle' | 'copied' | 'error'

/**
 * Clipboard write with a selection fallback.
 *
 * `navigator.clipboard` is unavailable on insecure origins and in some
 * embedded webviews, where the legacy execCommand path is the only one that
 * works — and a setup panel whose copy button silently fails is worse than
 * useless, because the user cannot tell it did nothing.
 */
async function writeTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(text)
    return true
  } catch {
    // Ignored: fall through to the manual selection path below.
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.append(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    return copied
  } catch {
    return false
  }
}

interface CopyBlockProps {
  value: string
  label: string
  copiedLabel: string
  failedLabel: string
  testId: string
  buttonTestId: string
  /** Commands wrap; JSON scrolls, so long configs do not push the panel down. */
  variant?: 'command' | 'config'
}

/**
 * One copyable artifact.
 *
 * Every command and config on this panel gets its own button so nothing has to
 * be transcribed by hand, and each button copies a complete, paste-ready value
 * rather than a fragment that only works alongside something else on screen.
 */
function CopyBlock({
  value,
  label,
  copiedLabel,
  failedLabel,
  testId,
  buttonTestId,
  variant = 'config',
}: CopyBlockProps) {
  const [state, setState] = useState<CopyState>('idle')

  const handleCopy = useCallback(async () => {
    setState((await writeTextToClipboard(value)) ? 'copied' : 'error')
  }, [value])

  return (
    <div className="space-y-1.5">
      <pre
        data-testid={testId}
        className={
          variant === 'command'
            ? 'whitespace-pre-wrap break-all rounded-md border border-border bg-background p-2 font-mono text-[10px] leading-relaxed text-foreground select-text'
            : 'max-h-48 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[10px] leading-relaxed text-foreground select-text'
        }
      >
        <code>{value}</code>
      </pre>
      <Button
        data-testid={buttonTestId}
        size="sm"
        variant="secondary"
        className="h-8 w-full gap-1.5"
        onClick={() => void handleCopy()}
      >
        {state === 'copied' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {state === 'copied' ? copiedLabel : label}
      </Button>
      {state === 'error' && (
        <p role="alert" className="text-[11px] leading-relaxed text-destructive">
          {failedLabel}
        </p>
      )}
    </div>
  )
}

export const McpSetupPanel = memo(function McpSetupPanel() {
  const { t } = useTranslation()
  const copied = t('editor.agent.mcp.copied')
  const failed = t('editor.agent.mcp.copyFailed')

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
            {t('editor.agent.mcp.directTitle')}
          </h4>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t('editor.agent.mcp.directHint')}
          </p>
          <CopyBlock
            value={MCP_DIRECT_CLIENT_CONFIG}
            label={t('editor.agent.mcp.copyConfig')}
            copiedLabel={copied}
            failedLabel={failed}
            testId="mcp-client-config"
            buttonTestId="mcp-copy-config-button"
          />
        </section>

        <section className="space-y-1.5 border-t border-border pt-3">
          <h4 className="text-xs font-medium text-foreground">
            {t('editor.agent.mcp.remoteTitle')}
          </h4>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t('editor.agent.mcp.remoteHint')}
          </p>
          <CopyBlock
            value={MCP_REMOTE_START_COMMAND}
            label={t('editor.agent.mcp.copyRemoteCommand')}
            copiedLabel={copied}
            failedLabel={failed}
            testId="mcp-remote-command"
            buttonTestId="mcp-copy-remote-command-button"
            variant="command"
          />
          <CopyBlock
            value={MCP_DOCKER_REMOTE_START_COMMAND}
            label={t('editor.agent.mcp.copyRemoteDockerCommand')}
            copiedLabel={copied}
            failedLabel={failed}
            testId="mcp-remote-docker-command"
            buttonTestId="mcp-copy-remote-docker-command-button"
            variant="command"
          />
          <CopyBlock
            value={MCP_REMOTE_CLIENT_CONFIG}
            label={t('editor.agent.mcp.copyRemoteConfig')}
            copiedLabel={copied}
            failedLabel={failed}
            testId="mcp-remote-config"
            buttonTestId="mcp-copy-remote-config-button"
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t('editor.agent.mcp.remoteTokenHint')}
          </p>
          <CopyBlock
            value={MCP_REMOTE_CLIENT_CONFIG_WITH_TOKEN}
            label={t('editor.agent.mcp.copyRemoteTokenConfig')}
            copiedLabel={copied}
            failedLabel={failed}
            testId="mcp-remote-token-config"
            buttonTestId="mcp-copy-remote-token-config-button"
          />
        </section>

        <section className="space-y-1.5 border-t border-border pt-3">
          <h4 className="text-xs font-medium text-foreground">
            {t('editor.agent.mcp.dockerTitle')}
          </h4>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t('editor.agent.mcp.startHint')}
          </p>
          <CopyBlock
            value={MCP_DOCKER_START_COMMAND}
            label={t('editor.agent.mcp.copyDockerCommand')}
            copiedLabel={copied}
            failedLabel={failed}
            testId="mcp-docker-command"
            buttonTestId="mcp-copy-docker-command-button"
            variant="command"
          />
          <CopyBlock
            value={MCP_DOCKER_CLIENT_CONFIG}
            label={t('editor.agent.mcp.copyDockerConfig')}
            copiedLabel={copied}
            failedLabel={failed}
            testId="mcp-docker-config"
            buttonTestId="mcp-copy-docker-config-button"
          />
        </section>

        <div className="space-y-1 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
          <p>{t('editor.agent.mcp.capabilities')}</p>
          <p>{t('editor.agent.mcp.dockerNote')}</p>
        </div>
      </div>
    </div>
  )
})
