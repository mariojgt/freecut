const BROWSER_LLM_MODEL_IDS = ['qwen-3.5-0.8b', 'gemma-4-e2b', 'gemma-4-e4b'] as const

export type BrowserLlmModelId = (typeof BROWSER_LLM_MODEL_IDS)[number]
export type BrowserLlmModelProfile = 'fast' | 'balanced' | 'quality'

export interface BrowserLlmModelDefinition {
  id: BrowserLlmModelId
  label: string
  modelId: string
  profile: BrowserLlmModelProfile
  downloadLabel: string
  estimatedBytes: number
}

const BROWSER_LLM_MODELS: Record<BrowserLlmModelId, BrowserLlmModelDefinition> = {
  'qwen-3.5-0.8b': {
    id: 'qwen-3.5-0.8b',
    label: 'Qwen 3.5 0.8B',
    modelId: 'onnx-community/Qwen3.5-0.8B-ONNX-OPT',
    profile: 'fast',
    downloadLabel: '~0.6 GB',
    estimatedBytes: 600_000_000,
  },
  'gemma-4-e2b': {
    id: 'gemma-4-e2b',
    label: 'Gemma 4 E2B',
    modelId: 'onnx-community/gemma-4-E2B-it-ONNX',
    profile: 'balanced',
    downloadLabel: '~3.2 GB',
    estimatedBytes: 3_200_000_000,
  },
  'gemma-4-e4b': {
    id: 'gemma-4-e4b',
    label: 'Gemma 4 E4B',
    modelId: 'onnx-community/gemma-4-E4B-it-ONNX',
    profile: 'quality',
    downloadLabel: '~5.0 GB',
    estimatedBytes: 5_000_000_000,
  },
}

/** A small first download is a safer default; users can opt into larger Gemma models. */
export const DEFAULT_BROWSER_LLM_MODEL_ID: BrowserLlmModelId = 'qwen-3.5-0.8b'

export function normalizeBrowserLlmModelId(value: unknown): BrowserLlmModelId {
  return BROWSER_LLM_MODEL_IDS.includes(value as BrowserLlmModelId)
    ? (value as BrowserLlmModelId)
    : DEFAULT_BROWSER_LLM_MODEL_ID
}

export function getBrowserLlmModelDefinition(id: BrowserLlmModelId): BrowserLlmModelDefinition {
  return BROWSER_LLM_MODELS[id]
}

export function listBrowserLlmModels(): readonly BrowserLlmModelDefinition[] {
  return BROWSER_LLM_MODEL_IDS.map((id) => BROWSER_LLM_MODELS[id])
}
