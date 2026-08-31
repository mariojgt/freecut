import { afterEach, describe, expect, it } from 'vite-plus/test'
import {
  DEFAULT_BROWSER_LLM_MODEL_ID,
  getBrowserLlmModelDefinition,
  listBrowserLlmModels,
  normalizeBrowserLlmModelId,
} from './browser-llm-models'
import { getLocalLlmConfig, setLocalLlmConfig } from './local-llm-config'

describe('browser LLM model catalog', () => {
  afterEach(() => localStorage.clear())

  it('offers a fast default plus both Gemma 4 quality tiers', () => {
    expect(DEFAULT_BROWSER_LLM_MODEL_ID).toBe('qwen-3.5-0.8b')
    expect(listBrowserLlmModels().map((model) => model.id)).toEqual([
      'qwen-3.5-0.8b',
      'gemma-4-e2b',
      'gemma-4-e4b',
    ])
    expect(getBrowserLlmModelDefinition('gemma-4-e4b')).toEqual(
      expect.objectContaining({ label: 'Gemma 4 E4B', profile: 'quality' }),
    )
  })

  it('normalizes unknown and legacy persisted selections to the small default', () => {
    expect(normalizeBrowserLlmModelId('unknown')).toBe(DEFAULT_BROWSER_LLM_MODEL_ID)

    localStorage.setItem(
      'freecut-local-llm-config',
      JSON.stringify({ adapterId: 'gemma', baseUrl: 'http://localhost:11434/v1' }),
    )
    expect(getLocalLlmConfig().browserModelId).toBe(DEFAULT_BROWSER_LLM_MODEL_ID)
  })

  it('persists a selected browser model independently from the server model', () => {
    setLocalLlmConfig({ browserModelId: 'gemma-4-e2b', model: 'qwen3:4b' })
    expect(getLocalLlmConfig()).toEqual(
      expect.objectContaining({ browserModelId: 'gemma-4-e2b', model: 'qwen3:4b' }),
    )
  })
})
