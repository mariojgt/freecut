import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Check,
  CircleDashed,
  Info,
  Loader2,
  Play,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  getBrowserLlmModelDefinition,
  getLocalLlmConfig,
  listBrowserLlmModels,
  normalizeBrowserLlmModelId,
  selectLlmAdapter,
  setLocalLlmConfig,
  subscribeLocalLlmConfig,
} from '@/infrastructure/llm'
import { cn } from '@/shared/ui/cn'
import { formatBytes } from '@/shared/utils/format-utils'
import { useAgentStore, type PlanStepState } from '../agent'

const SUGGESTIONS = ['transitions', 'fades', 'title', 'cut', 'silence', 'fillers', 'split'] as const
const BROWSER_MODEL_VALUE_PREFIX = 'browser:'

function useLocalLlmConfigValue(): ReturnType<typeof getLocalLlmConfig> {
  const [config, setConfig] = useState(getLocalLlmConfig)
  useEffect(() => subscribeLocalLlmConfig(() => setConfig(getLocalLlmConfig())), [])
  return config
}

function StepIcon({ status }: { status: PlanStepState['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
    case 'done':
      return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
    case 'error':
      return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
    default:
      return <CircleDashed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  }
}

const PlanCard = memo(function PlanCard() {
  const { t } = useTranslation()
  const plan = useAgentStore((s) => s.plan)
  const phase = useAgentStore((s) => s.phase)
  const runPlan = useAgentStore((s) => s.runPlan)
  const dismissPlan = useAgentStore((s) => s.dismissPlan)

  if (!plan || plan.length === 0) return null

  const awaiting = phase === 'awaiting-confirm'
  const running = phase === 'running'
  const hasHandoff = plan.some((step) => step.handoff)

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-2.5">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {t('editor.agent.plan.title', { defaultValue: 'Plan' })}
      </div>
      <ol className="space-y-1.5">
        {plan.map((step, index) => (
          <li key={index} className="flex items-start gap-2 text-xs">
            <StepIcon status={step.status} />
            <div className="min-w-0">
              <span className="text-foreground">{step.summary}</span>
              {step.status === 'error' && step.result && (
                <span className="block text-[11px] text-destructive">{step.result}</span>
              )}
            </div>
          </li>
        ))}
      </ol>

      {hasHandoff && awaiting && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t('editor.agent.plan.handoffNote', {
            defaultValue: 'Some steps open a review you confirm.',
          })}
        </p>
      )}

      {awaiting && (
        <div className="mt-2.5 flex items-center gap-1.5">
          <Button size="sm" className="h-7 flex-1 gap-1.5" onClick={() => void runPlan()}>
            <Play className="h-3.5 w-3.5" />
            {t('editor.agent.plan.run', { defaultValue: 'Run' })}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-muted-foreground"
            onClick={dismissPlan}
          >
            <X className="h-3.5 w-3.5" />
            {t('editor.agent.plan.discard', { defaultValue: 'Discard' })}
          </Button>
        </div>
      )}
      {running && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('editor.agent.plan.running', { defaultValue: 'Running…' })}
        </p>
      )}
    </div>
  )
})

const AgentModelControl = memo(function AgentModelControl() {
  const { t } = useTranslation()
  const [config, setConfig] = useState(getLocalLlmConfig)
  const [draftBaseUrl, setDraftBaseUrl] = useState(config.baseUrl)
  const [draftModel, setDraftModel] = useState(config.model)
  const refreshAdapter = useAgentStore((state) => state.refreshAdapter)
  const browserModels = listBrowserLlmModels()
  const selectedValue =
    config.adapterId === 'openai-compatible'
      ? config.adapterId
      : `${BROWSER_MODEL_VALUE_PREFIX}${config.browserModelId}`

  const handleModelChange = (value: string) => {
    if (value.startsWith(BROWSER_MODEL_VALUE_PREFIX)) {
      const browserModelId = normalizeBrowserLlmModelId(
        value.slice(BROWSER_MODEL_VALUE_PREFIX.length),
      )
      selectLlmAdapter('gemma')
      setLocalLlmConfig({ browserModelId })
    } else {
      selectLlmAdapter(value)
    }

    const next = getLocalLlmConfig()
    setConfig(next)
    setDraftBaseUrl(next.baseUrl)
    setDraftModel(next.model)
    refreshAdapter()
  }

  const saveServer = () => {
    const next = setLocalLlmConfig({ baseUrl: draftBaseUrl, model: draftModel })
    setConfig(next)
    setDraftBaseUrl(next.baseUrl)
    setDraftModel(next.model)
    refreshAdapter()
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2.5">
      <label htmlFor="agent-model-provider" className="text-[11px] text-muted-foreground">
        {t('editor.agent.provider.label')}
      </label>
      <select
        id="agent-model-provider"
        data-testid="agent-model-select"
        value={selectedValue}
        onChange={(event) => handleModelChange(event.target.value)}
        className="h-7 min-w-0 flex-1 rounded border border-border bg-secondary/40 px-2 text-[11px] text-foreground outline-none focus:border-primary/50"
      >
        {browserModels.map((model) => (
          <option key={model.id} value={`${BROWSER_MODEL_VALUE_PREFIX}${model.id}`}>
            {t('editor.agent.provider.browserModelOption', {
              name: model.label,
              profile: t(`editor.agent.provider.profiles.${model.profile}`),
              size: model.downloadLabel,
            })}
          </option>
        ))}
        <option value="openai-compatible">{t('editor.agent.provider.localServerOption')}</option>
      </select>

      {config.adapterId === 'openai-compatible' && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 text-muted-foreground"
              aria-label={t('editor.agent.provider.configure')}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-3 p-3">
            <div>
              <p className="text-xs font-medium text-foreground">
                {t('editor.agent.provider.localServerTitle')}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {t('editor.agent.provider.localServerDescription')}
              </p>
            </div>
            <label className="block space-y-1 text-[11px] text-muted-foreground">
              <span>{t('editor.agent.provider.endpoint')}</span>
              <Input
                value={draftBaseUrl}
                onChange={(event) => setDraftBaseUrl(event.target.value)}
                placeholder="http://127.0.0.1:11434/v1"
                className="h-8 text-xs"
              />
            </label>
            <label className="block space-y-1 text-[11px] text-muted-foreground">
              <span>{t('editor.agent.provider.model')}</span>
              <Input
                value={draftModel}
                onChange={(event) => setDraftModel(event.target.value)}
                placeholder="qwen3:4b"
                className="h-8 text-xs"
              />
            </label>
            <Button size="sm" className="h-8 w-full" onClick={saveServer}>
              {t('common.save')}
            </Button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
})

const BrowserModelSummary = memo(function BrowserModelSummary() {
  const { t } = useTranslation()
  const modelStatus = useAgentStore((state) => state.modelStatus)
  const loadModel = useAgentStore((state) => state.loadModel)
  const config = useLocalLlmConfigValue()
  if (config.adapterId !== 'gemma' || modelStatus === 'loading' || modelStatus === 'error') {
    return null
  }

  const model = getBrowserLlmModelDefinition(config.browserModelId)
  return (
    <div
      data-testid="agent-browser-model-summary"
      className="rounded-lg border border-border bg-secondary/25 p-2.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{model.label}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {t('editor.agent.provider.browserModelDescription', {
              profile: t(`editor.agent.provider.profiles.${model.profile}`),
              size: model.downloadLabel,
            })}
          </p>
        </div>
        {modelStatus === 'ready' ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-emerald-500">
            <Check className="h-3.5 w-3.5" />
            {t('editor.agent.status.ready')}
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 text-[11px]"
            onClick={() => void loadModel()}
          >
            {t('editor.agent.status.prepare')}
          </Button>
        )}
      </div>
    </div>
  )
})

const AgentModelLoadStatus = memo(function AgentModelLoadStatus() {
  const { t } = useTranslation()
  const phase = useAgentStore((state) => state.phase)
  const modelStatus = useAgentStore((state) => state.modelStatus)
  const loadPercent = useAgentStore((state) => state.loadPercent)
  const loadLoadedBytes = useAgentStore((state) => state.loadLoadedBytes)
  const loadTotalBytes = useAgentStore((state) => state.loadTotalBytes)
  const loadError = useAgentStore((state) => state.loadError)
  const loadModel = useAgentStore((state) => state.loadModel)
  const cancel = useAgentStore((state) => state.cancel)
  const config = useLocalLlmConfigValue()

  if (modelStatus === 'loading') {
    const modelLabel =
      config.adapterId === 'gemma'
        ? getBrowserLlmModelDefinition(config.browserModelId).label
        : config.model

    return (
      <div
        data-testid="agent-model-progress"
        className="rounded-lg border border-border bg-secondary/25 p-2.5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="truncate">
              {t('editor.agent.status.loadingModel', {
                model: modelLabel,
                percent: loadPercent,
              })}
            </span>
          </span>
          <Button
            data-testid="agent-model-cancel"
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={cancel}
          >
            {t('editor.agent.status.cancel')}
          </Button>
        </div>
        {loadTotalBytes > 0 && (
          <p className="mt-1 pl-5.5 text-[10px] text-muted-foreground">
            {t('editor.agent.status.loadingBytes', {
              loaded: formatBytes(loadLoadedBytes),
              total: formatBytes(loadTotalBytes),
            })}
          </p>
        )}
      </div>
    )
  }

  if (!loadError || phase !== 'idle') return null
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-[11px] text-destructive">
      <span className="min-w-0 break-words">{loadError}</span>
      <Button
        data-testid="agent-model-retry"
        size="sm"
        variant="outline"
        className="h-7 shrink-0 gap-1 border-destructive/40 px-2 text-[11px] text-destructive"
        onClick={() => void loadModel()}
      >
        <RotateCcw className="h-3 w-3" />
        {t('editor.agent.status.retry')}
      </Button>
    </div>
  )
})

export const AgentChatPanel = memo(function AgentChatPanel() {
  const { t } = useTranslation()
  const supported = useAgentStore((s) => s.supported)
  const messages = useAgentStore((s) => s.messages)
  const phase = useAgentStore((s) => s.phase)
  const modelStatus = useAgentStore((s) => s.modelStatus)
  const loadPercent = useAgentStore((s) => s.loadPercent)
  const submit = useAgentStore((s) => s.submit)
  const cancel = useAgentStore((s) => s.cancel)
  const clearChat = useAgentStore((s) => s.clearChat)

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const busy = phase !== 'idle' || modelStatus === 'loading'

  useEffect(() => {
    const transcript = scrollRef.current
    if (transcript && typeof transcript.scrollTo === 'function') {
      transcript.scrollTo({ top: transcript.scrollHeight })
    }
  }, [messages, phase])

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return
      setInput('')
      void submit(trimmed)
    },
    [busy, submit],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        if (!busy) send(input)
      }
    },
    [busy, input, send],
  )

  if (!supported) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <AgentModelControl />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <Sparkles className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            {t('editor.agent.unsupported.title', { defaultValue: 'Assistant unavailable' })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('editor.agent.unsupported.body', {
              defaultValue:
                'This on-device model needs WebGPU. Choose a local server model above for a CPU-compatible option.',
            })}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AgentModelControl />
      {/* Transcript */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && phase === 'idle' && modelStatus !== 'loading' && (
          <div className="space-y-3">
            <BrowserModelSummary />
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(t(`editor.agent.suggestions.${suggestion}`))}
                  className="rounded-full border border-border bg-secondary/30 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                >
                  {t(`editor.agent.suggestions.${suggestion}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs leading-relaxed',
                message.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary/40 text-foreground',
              )}
            >
              {message.content}
            </div>
          </div>
        ))}

        <AgentModelLoadStatus />

        {phase === 'planning' && modelStatus !== 'loading' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('editor.agent.status.thinking')}
          </div>
        )}

        <PlanCard />
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border p-2.5">
        {modelStatus === 'loading' && (
          <div className="mb-2 h-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${loadPercent}%` }}
            />
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 shrink-0 text-muted-foreground"
                aria-label={t('editor.agent.empty.infoLabel', {
                  defaultValue: 'About this assistant',
                })}
              >
                <Info className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-64 p-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('editor.agent.empty.intro', {
                  defaultValue:
                    'Ask me to edit your timeline in plain language. I run fully on-device — nothing leaves your computer. I propose a plan first; you confirm before anything changes.',
                })}
              </p>
            </PopoverContent>
          </Popover>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={t('editor.agent.composer.placeholder', {
              defaultValue: 'Ask the assistant to edit…',
            })}
            className="max-h-28 min-h-[2.25rem] flex-1 resize-none rounded-md border border-border bg-secondary/30 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
          />
          {phase === 'planning' ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0"
              aria-label={t('editor.agent.status.cancel')}
              onClick={cancel}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-9 w-9 shrink-0"
              disabled={busy || !input.trim()}
              onClick={() => send(input)}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        {messages.length > 0 && (
          <div className="mt-1.5 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
              onClick={clearChat}
              disabled={phase !== 'idle' || modelStatus === 'loading'}
            >
              <Trash2 className="h-3 w-3" />
              {t('editor.agent.clear', { defaultValue: 'Clear' })}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
})
