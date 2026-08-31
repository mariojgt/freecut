/**
 * {@link LlmAdapter} backed by the selected on-device browser model worker.
 *
 * Owns a single lazily-created worker, correlates streamed tokens and results
 * to pending `generate` calls by id, and exposes a promise-based API. WebGPU is
 * required; `isSupported()` gates the UI before any heavy load is attempted.
 */

import { createLogger } from '@/shared/logging/logger'
import { localInferenceRuntimeRegistry } from '@/shared/state/local-inference'
import { getBrowserLlmModelDefinition, type BrowserLlmModelDefinition } from './browser-llm-models'
import { createGemmaLlmWorker } from './create-gemma-llm-worker'
import { getLocalLlmConfig } from './local-llm-config'
import type { LlmAdapter, LlmGenerateOptions, LlmLoadProgress, LlmMessage } from './types'
import type { LlmWorkerResponse } from './worker-protocol'

const logger = createLogger('GemmaLlmAdapter')

const DEFAULT_MAX_TOKENS = 768

function getRuntimeId(model: BrowserLlmModelDefinition): string {
  return `assistant:${model.id}`
}

function createLoadCancelledError(): Error {
  return typeof DOMException === 'undefined'
    ? new Error('Model loading cancelled.')
    : new DOMException('Model loading cancelled.', 'AbortError')
}

interface PendingGeneration {
  resolve: (text: string) => void
  reject: (error: Error) => void
  onToken?: (delta: string, text: string) => void
  text: string
  signal?: AbortSignal
  onAbort?: () => void
}

class GemmaLlmAdapter implements LlmAdapter {
  readonly id = 'gemma'
  readonly label = 'Browser model (WebGPU)'

  private worker: Worker | null = null
  private loadPromise: Promise<void> | null = null
  private loadResolve: (() => void) | null = null
  private loadReject: ((error: Error) => void) | null = null
  private onProgress: ((progress: LlmLoadProgress) => void) | null = null
  private activeModel: BrowserLlmModelDefinition | null = null

  private nextId = 1
  private readonly pending = new Map<number, PendingGeneration>()
  private runtimeLoadedAt = 0

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator
  }

  load(onProgress?: (progress: LlmLoadProgress) => void): Promise<void> {
    const model = getBrowserLlmModelDefinition(getLocalLlmConfig().browserModelId)
    if (this.activeModel && this.activeModel.id !== model.id) this.dispose()
    this.onProgress = onProgress ?? null
    if (this.loadPromise) return this.loadPromise

    if (!this.isSupported()) {
      return Promise.reject(new Error('WebGPU is required to run the on-device assistant.'))
    }

    const worker = this.ensureWorker()
    this.activeModel = model
    this.runtimeLoadedAt = Date.now()
    this.updateRuntime('loading')
    this.loadPromise = new Promise<void>((resolve, reject) => {
      this.loadResolve = resolve
      this.loadReject = reject
    })
    worker.postMessage({ type: 'load', modelId: model.id })
    return this.loadPromise
  }

  async generate(messages: LlmMessage[], options: LlmGenerateOptions = {}): Promise<string> {
    await this.load(this.onProgress ?? undefined)
    const worker = this.ensureWorker()

    const id = this.nextId++
    return new Promise<string>((resolve, reject) => {
      const entry: PendingGeneration = {
        resolve,
        reject,
        onToken: options.onToken,
        text: '',
        signal: options.signal,
      }

      if (options.signal) {
        if (options.signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'))
          return
        }
        entry.onAbort = () => {
          worker.postMessage({ type: 'cancel', id })
          this.pending.delete(id)
          this.updateRuntime(this.pending.size > 0 ? 'running' : 'ready')
          reject(new DOMException('Aborted', 'AbortError'))
        }
        options.signal.addEventListener('abort', entry.onAbort, { once: true })
      }

      this.pending.set(id, entry)
      this.updateRuntime('running')
      worker.postMessage({
        type: 'generate',
        id,
        messages,
        maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: options.temperature ?? 0,
        topP: options.topP ?? 0.9,
      })
    })
  }

  dispose(): void {
    const activeModel = this.activeModel
    const rejectLoad = this.loadReject
    const worker = this.worker
    if (worker) worker.postMessage({ type: 'dispose' })
    this.worker = null
    this.loadPromise = null
    this.loadResolve = null
    this.loadReject = null
    this.onProgress = null
    this.activeModel = null
    for (const [, entry] of this.pending) {
      this.detachSignal(entry)
      entry.reject(new Error('Assistant disposed'))
    }
    this.pending.clear()
    if (activeModel) localInferenceRuntimeRegistry.unregisterRuntime(getRuntimeId(activeModel))
    rejectLoad?.(createLoadCancelledError())
    if (worker) setTimeout(() => worker.terminate(), 100)
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = createGemmaLlmWorker()
    worker.addEventListener('message', (event: MessageEvent<LlmWorkerResponse>) =>
      this.worker === worker ? this.handleMessage(event.data) : undefined,
    )
    worker.addEventListener('error', (event) => {
      if (this.worker !== worker) return
      logger.error('LLM worker error', event.message)
      const error = new Error(event.message || 'Worker error')
      this.rejectLoad(error)
      this.updateRuntime('error', error.message)
    })
    this.worker = worker
    return worker
  }

  private handleMessage(message: LlmWorkerResponse): void {
    switch (message.type) {
      case 'progress':
        this.onProgress?.({
          stage: message.stage,
          percent: message.percent,
          loadedBytes: message.loadedBytes,
          totalBytes: message.totalBytes,
        })
        break
      case 'ready': {
        const resolve = this.loadResolve
        this.loadResolve = null
        this.loadReject = null
        resolve?.()
        this.updateRuntime('ready')
        break
      }
      case 'token': {
        const entry = this.pending.get(message.id)
        if (!entry) break
        entry.text += message.delta
        entry.onToken?.(message.delta, entry.text)
        break
      }
      case 'result': {
        const entry = this.pending.get(message.id)
        if (!entry) break
        this.detachSignal(entry)
        this.pending.delete(message.id)
        entry.resolve(message.text)
        this.updateRuntime(this.pending.size > 0 ? 'running' : 'ready')
        break
      }
      case 'error': {
        if (message.id === undefined) {
          const error = new Error(message.message)
          this.rejectLoad(error)
          this.updateRuntime('error', error.message)
          break
        }
        const entry = this.pending.get(message.id)
        if (!entry) break
        this.detachSignal(entry)
        this.pending.delete(message.id)
        entry.reject(new Error(message.message))
        this.updateRuntime(this.pending.size > 0 ? 'running' : 'ready')
        break
      }
      case 'disposed':
        break
    }
  }

  private detachSignal(entry: PendingGeneration): void {
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener('abort', entry.onAbort)
    }
  }

  private rejectLoad(error: Error): void {
    const reject = this.loadReject
    this.loadPromise = null
    this.loadResolve = null
    this.loadReject = null
    reject?.(error)
  }

  private updateRuntime(
    state: 'loading' | 'running' | 'ready' | 'error',
    errorMessage?: string,
  ): void {
    const model = this.activeModel
    if (!model) return
    const now = Date.now()
    localInferenceRuntimeRegistry.registerRuntime(
      {
        id: getRuntimeId(model),
        feature: 'assistant',
        featureLabel: 'Assistant',
        modelKey: model.id,
        modelLabel: model.label,
        backend: 'webgpu',
        state,
        loadingPhase: state === 'loading' ? 'downloading' : undefined,
        estimatedBytes: model.estimatedBytes,
        activeJobs: this.pending.size,
        loadedAt: this.runtimeLoadedAt || now,
        lastUsedAt: now,
        unloadable: true,
        errorMessage,
      },
      { unload: () => this.dispose() },
    )
  }
}

/** Process-wide singleton — one worker/model shared across the app. */
export const gemmaLlmAdapter: LlmAdapter = new GemmaLlmAdapter()
