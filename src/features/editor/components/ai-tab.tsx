import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Cable, WandSparkles } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { AgentChatPanel } from './agent-chat-panel'
import { AiPanel } from './ai-panel'
import { McpSetupPanel } from './mcp-setup-panel'

type AiView = 'assistant' | 'generate' | 'mcp'

/** Local editing assistant plus the existing speech/music generation tools. */
export const AiTab = memo(function AiTab() {
  const { t } = useTranslation()
  const [view, setView] = useState<AiView>('assistant')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-3 gap-1 border-b border-border p-1.5">
        <button
          type="button"
          onClick={() => setView('assistant')}
          className={cn(
            'flex h-7 items-center justify-center gap-1.5 rounded text-xs transition-colors',
            view === 'assistant'
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
          )}
        >
          <Bot className="h-3.5 w-3.5" />
          {t('editor.agent.tabs.assistant')}
        </button>
        <button
          type="button"
          onClick={() => setView('generate')}
          className={cn(
            'flex h-7 items-center justify-center gap-1.5 rounded text-xs transition-colors',
            view === 'generate'
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
          )}
        >
          <WandSparkles className="h-3.5 w-3.5" />
          {t('editor.agent.tabs.generate')}
        </button>
        <button
          type="button"
          onClick={() => setView('mcp')}
          className={cn(
            'flex h-7 items-center justify-center gap-1.5 rounded text-xs transition-colors',
            view === 'mcp'
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
          )}
        >
          <Cable className="h-3.5 w-3.5" />
          {t('editor.agent.tabs.mcp')}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === 'assistant' ? (
          <AgentChatPanel />
        ) : view === 'generate' ? (
          <AiPanel />
        ) : (
          <McpSetupPanel />
        )}
      </div>
    </div>
  )
})
