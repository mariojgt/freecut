import { env } from '@huggingface/transformers'
import { describe, expect, it } from 'vite-plus/test'
import {
  assertBrowserLlmRuntimeCompatible,
  isTransformersVersionCompatible,
  MIN_BROWSER_LLM_TRANSFORMERS_VERSION,
} from './browser-llm-runtime'

describe('browser LLM runtime compatibility', () => {
  it('keeps the installed runtime at the ONNX metadata-aware cache implementation', () => {
    expect(MIN_BROWSER_LLM_TRANSFORMERS_VERSION).toBe('4.2.0')
    expect(isTransformersVersionCompatible(env.version)).toBe(true)
  })

  it('accepts later compatible releases', () => {
    expect(isTransformersVersionCompatible('4.2.1')).toBe(true)
    expect(isTransformersVersionCompatible('4.3.0')).toBe(true)
    expect(isTransformersVersionCompatible('5.0.0-beta.1')).toBe(true)
  })

  it('rejects the cache-shape-incompatible runtime and malformed versions', () => {
    expect(isTransformersVersionCompatible('4.1.0')).toBe(false)
    expect(isTransformersVersionCompatible('unknown')).toBe(false)
    expect(() => assertBrowserLlmRuntimeCompatible('4.1.0')).toThrow(/ONNX cache tensors/)
  })
})
