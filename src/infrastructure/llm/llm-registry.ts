/**
 * Registry of local LLM adapters. This is the swap point: to move the agent to
 * a stronger on-device WebGPU model, implement {@link LlmAdapter}, register it
 * here, and (optionally) change the default id. Callers resolve adapters by id
 * and never import a concrete implementation directly.
 */

import { ProviderRegistry } from '@/shared/utils/provider-registry'
import { gemmaLlmAdapter } from './gemma-llm-adapter'
import { getLocalLlmConfig, setLocalLlmConfig } from './local-llm-config'
import { openAiCompatibleLlmAdapter } from './openai-compatible-llm-adapter'
import type { LlmAdapter } from './types'

export const DEFAULT_LLM_ADAPTER_ID = 'gemma'

const llmAdapterRegistry = new ProviderRegistry<LlmAdapter>(
  [gemmaLlmAdapter, openAiCompatibleLlmAdapter],
  DEFAULT_LLM_ADAPTER_ID,
)

export function getDefaultLlmAdapter(): LlmAdapter {
  return llmAdapterRegistry.getDefault()
}

export function getSelectedLlmAdapter(): LlmAdapter {
  const configuredId = getLocalLlmConfig().adapterId
  try {
    return llmAdapterRegistry.get(configuredId)
  } catch {
    return llmAdapterRegistry.getDefault()
  }
}

export function selectLlmAdapter(id: string): LlmAdapter {
  const next = llmAdapterRegistry.get(id)
  const current = getSelectedLlmAdapter()
  if (current.id !== next.id) current.dispose()
  setLocalLlmConfig({ adapterId: next.id })
  return next
}

export function getLlmAdapter(id: string): LlmAdapter {
  return llmAdapterRegistry.get(id)
}
