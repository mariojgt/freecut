/**
 * Web Worker hosting the selected on-device text LLM for the editing agent.
 *
 * The worker deliberately loads `AutoModelForCausalLM`: multimodal models such
 * as Gemma 4 and Qwen 3.5 then fetch only their text sessions instead of also
 * downloading unused vision/audio encoders. All loading and inference happen
 * here so the main thread stays responsive.
 *
 * Protocol: see `worker-protocol.ts`.
 */

import {
  AutoModelForCausalLM,
  AutoTokenizer,
  InterruptableStoppingCriteria,
  StoppingCriteriaList,
  TextStreamer,
  env,
} from '@huggingface/transformers'
import { getBrowserLlmModelDefinition, type BrowserLlmModelId } from './browser-llm-models'
import { BrowserLlmProgressTracker, type TransformersProgressInfo } from './browser-llm-progress'
import { assertBrowserLlmRuntimeCompatible } from './browser-llm-runtime'
import type { LlmWorkerRequest } from './worker-protocol'

// Match the scene-verification worker configuration so a single cached copy of
// the weights serves both features.
env.useBrowserCache = true
env.allowLocalModels = false

// transformers.js model/tokenizer types are complex internals that aren't
// exported for external use, so `any` is the pragmatic choice here.
/* eslint-disable @typescript-eslint/no-explicit-any */
let tokenizer: any = null
let model: any = null
/* eslint-enable @typescript-eslint/no-explicit-any */
let loading: Promise<void> | null = null
let disposed = false
let currentModelId: BrowserLlmModelId | null = null
let loadGeneration = 0

/** Stopping criteria per in-flight generation id, so `cancel` can interrupt. */
const activeStops = new Map<number, InterruptableStoppingCriteria>()

function post(message: Record<string, unknown>): void {
  self.postMessage(message)
}

function createModelProgressCallback(): (info: TransformersProgressInfo) => void {
  const tracker = new BrowserLlmProgressTracker()

  return (info) => {
    const progress = tracker.update(info)
    if (!progress) return
    post({
      type: 'progress',
      stage: 'downloading-model',
      ...progress,
    })
  }
}

async function ensureLoaded(modelId: BrowserLlmModelId): Promise<void> {
  if (model && tokenizer && currentModelId === modelId) {
    post({ type: 'ready' })
    return
  }
  if (loading) return loading

  disposed = false
  const generation = ++loadGeneration
  const definition = getBrowserLlmModelDefinition(modelId)
  loading = (async () => {
    assertBrowserLlmRuntimeCompatible(env.version)
    post({ type: 'progress', stage: 'preparing-model', percent: 2 })

    const loadedTokenizer = await AutoTokenizer.from_pretrained(definition.modelId)
    if (disposed || generation !== loadGeneration) return

    post({ type: 'progress', stage: 'downloading-model', percent: 5 })
    const loadedModel = await AutoModelForCausalLM.from_pretrained(definition.modelId, {
      dtype: 'q4f16',
      device: 'webgpu',
      progress_callback: createModelProgressCallback(),
    })

    if (disposed || generation !== loadGeneration) {
      if (typeof loadedModel.dispose === 'function') loadedModel.dispose()
      return
    }

    post({ type: 'progress', stage: 'initializing-model', percent: 98 })
    tokenizer = loadedTokenizer
    model = loadedModel
    currentModelId = modelId
    post({ type: 'progress', stage: 'ready', percent: 100 })
    post({ type: 'ready' })
  })()

  try {
    await loading
  } catch (err) {
    if (!disposed && generation === loadGeneration) {
      post({ type: 'error', message: `Model load failed: ${(err as Error).message}` })
    }
  } finally {
    if (generation === loadGeneration) loading = null
  }
}

async function generate(request: Extract<LlmWorkerRequest, { type: 'generate' }>): Promise<void> {
  if (!model || !tokenizer) {
    post({ type: 'error', id: request.id, message: 'Model not loaded' })
    return
  }

  const stop = new InterruptableStoppingCriteria()
  activeStops.set(request.id, stop)

  try {
    const inputs = tokenizer.apply_chat_template(request.messages, {
      add_generation_prompt: true,
      enable_thinking: false,
      return_dict: true,
    })

    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (delta: string) => {
        if (delta) post({ type: 'token', id: request.id, delta })
      },
    })

    const stoppingCriteria = new StoppingCriteriaList()
    stoppingCriteria.push(stop)

    const sample = request.temperature > 0
    const outputs = await model.generate({
      ...inputs,
      max_new_tokens: request.maxTokens,
      do_sample: sample,
      ...(sample ? { temperature: request.temperature, top_p: request.topP } : {}),
      streamer,
      stopping_criteria: stoppingCriteria,
    })

    const promptLength = inputs.input_ids.dims.at(-1)
    const decoded = tokenizer.batch_decode(outputs.slice(null, [promptLength, null]), {
      skip_special_tokens: true,
    })

    post({ type: 'result', id: request.id, text: (decoded[0] ?? '').trim() })
  } catch (err) {
    post({ type: 'error', id: request.id, message: (err as Error).message })
  } finally {
    activeStops.delete(request.id)
  }
}

function dispose(): void {
  disposed = true
  loadGeneration += 1
  for (const stop of activeStops.values()) stop.interrupt()
  activeStops.clear()
  if (model && typeof model.dispose === 'function') model.dispose()
  model = null
  tokenizer = null
  currentModelId = null
  loading = null
  post({ type: 'disposed' })
}

self.addEventListener('message', (event: MessageEvent<LlmWorkerRequest>) => {
  const message = event.data
  switch (message.type) {
    case 'load':
      void ensureLoaded(message.modelId)
      break
    case 'generate':
      void generate(message)
      break
    case 'cancel':
      activeStops.get(message.id)?.interrupt()
      break
    case 'dispose':
      dispose()
      break
  }
})
