import {
  DEFAULT_BROWSER_LLM_MODEL_ID,
  normalizeBrowserLlmModelId,
  type BrowserLlmModelId,
} from './browser-llm-models'

const LOCAL_LLM_CONFIG_STORAGE_KEY = 'freecut-local-llm-config'
const LOCAL_LLM_CONFIG_CHANGED_EVENT = 'freecut:local-llm-config-changed'

interface LocalLlmConfig {
  adapterId: string
  browserModelId: BrowserLlmModelId
  baseUrl: string
  model: string
}

const DEFAULT_LOCAL_LLM_CONFIG: LocalLlmConfig = {
  adapterId: 'gemma',
  browserModelId: DEFAULT_BROWSER_LLM_MODEL_ID,
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'qwen3:4b',
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return DEFAULT_LOCAL_LLM_CONFIG.baseUrl
  }
  return value.trim().replace(/\/+$/, '')
}

export function getLocalLlmConfig(): LocalLlmConfig {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_LOCAL_LLM_CONFIG }
  try {
    const raw = localStorage.getItem(LOCAL_LLM_CONFIG_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_LOCAL_LLM_CONFIG }
    const parsed = JSON.parse(raw) as Partial<LocalLlmConfig>
    return {
      adapterId:
        typeof parsed.adapterId === 'string' && parsed.adapterId.length > 0
          ? parsed.adapterId
          : DEFAULT_LOCAL_LLM_CONFIG.adapterId,
      browserModelId: normalizeBrowserLlmModelId(parsed.browserModelId),
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      model:
        typeof parsed.model === 'string' && parsed.model.trim().length > 0
          ? parsed.model.trim()
          : DEFAULT_LOCAL_LLM_CONFIG.model,
    }
  } catch {
    return { ...DEFAULT_LOCAL_LLM_CONFIG }
  }
}

export function setLocalLlmConfig(updates: Partial<LocalLlmConfig>): LocalLlmConfig {
  const next = {
    ...getLocalLlmConfig(),
    ...updates,
  }
  next.browserModelId = normalizeBrowserLlmModelId(next.browserModelId)
  next.baseUrl = normalizeBaseUrl(next.baseUrl)
  next.model = next.model.trim() || DEFAULT_LOCAL_LLM_CONFIG.model

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LOCAL_LLM_CONFIG_STORAGE_KEY, JSON.stringify(next))
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LOCAL_LLM_CONFIG_CHANGED_EVENT, { detail: next }))
  }
  return next
}

/** Subscribe React/UI consumers to same-tab changes and cross-tab storage updates. */
export function subscribeLocalLlmConfig(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const handleConfigChange = () => listener()
  const handleStorage = (event: StorageEvent) => {
    if (event.key === LOCAL_LLM_CONFIG_STORAGE_KEY) listener()
  }
  window.addEventListener(LOCAL_LLM_CONFIG_CHANGED_EVENT, handleConfigChange)
  window.addEventListener('storage', handleStorage)
  return () => {
    window.removeEventListener(LOCAL_LLM_CONFIG_CHANGED_EVENT, handleConfigChange)
    window.removeEventListener('storage', handleStorage)
  }
}
