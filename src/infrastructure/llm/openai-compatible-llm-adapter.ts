/**
 * Adapter for local OpenAI-compatible servers such as Ollama, LM Studio, and
 * LocalAI. Prompts still stay on the user's machine; only localhost is used by
 * default. The endpoint/model are configured in local-llm-config.ts.
 */

import { getLocalLlmConfig } from './local-llm-config'
import type { LlmAdapter, LlmGenerateOptions, LlmLoadProgress, LlmMessage } from './types'

interface OpenAiModelsResponse {
  data?: Array<{ id?: string }>
}

interface OpenAiCompletionResponse {
  choices?: Array<{
    message?: { content?: string }
    delta?: { content?: string }
  }>
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

class OpenAiCompatibleLlmAdapter implements LlmAdapter {
  readonly id = 'openai-compatible'
  readonly label = 'Local server (Ollama / LM Studio)'

  private loadedKey: string | null = null
  private loadPromise: Promise<void> | null = null

  isSupported(): boolean {
    return typeof fetch === 'function'
  }

  load(onProgress?: (progress: LlmLoadProgress) => void): Promise<void> {
    const config = getLocalLlmConfig()
    const key = `${config.baseUrl}\n${config.model}`
    if (this.loadedKey === key) {
      onProgress?.({ stage: 'ready', percent: 100 })
      return Promise.resolve()
    }
    if (this.loadPromise) return this.loadPromise

    // Connection-state branches are covered by the adapter tests.
    // fallow-ignore-next-line complexity
    this.loadPromise = (async () => {
      onProgress?.({ stage: 'connecting', percent: 15 })
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)
      try {
        const response = await fetch(`${config.baseUrl}/models`, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Local model server returned HTTP ${response.status}.`)
        }
        const payload = (await response.json()) as OpenAiModelsResponse
        const models = payload.data?.flatMap((entry) => (entry.id ? [entry.id] : [])) ?? []
        if (models.length > 0 && !models.includes(config.model)) {
          throw new Error(
            `Model "${config.model}" is not available. Installed models: ${models.join(', ')}.`,
          )
        }
        this.loadedKey = key
        onProgress?.({ stage: 'ready', percent: 100 })
      } catch (error) {
        const detail =
          error instanceof DOMException && error.name === 'AbortError'
            ? 'Connection timed out.'
            : errorMessage(error)
        throw new Error(
          `Could not connect to the local model server at ${config.baseUrl}. ${detail} Check that it is running and allows this app origin.`,
        )
      } finally {
        clearTimeout(timeout)
      }
    })()

    return this.loadPromise.finally(() => {
      this.loadPromise = null
    })
  }

  // Handles both JSON and SSE variants of the OpenAI-compatible contract in one bounded request.
  // fallow-ignore-next-line complexity
  async generate(messages: LlmMessage[], options: LlmGenerateOptions = {}): Promise<string> {
    await this.load()
    const config = getLocalLlmConfig()
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature ?? 0,
        top_p: options.topP ?? 0.9,
        stream: true,
      }),
      signal: options.signal,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `Local model generation failed (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`,
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!response.body || !contentType.includes('text/event-stream')) {
      const payload = (await response.json()) as OpenAiCompletionResponse
      return payload.choices?.[0]?.message?.content?.trim() ?? ''
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''

    const consumeLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) return
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') return
      try {
        const payload = JSON.parse(data) as OpenAiCompletionResponse
        const delta = payload.choices?.[0]?.delta?.content ?? ''
        if (!delta) return
        text += delta
        options.onToken?.(delta, text)
      } catch {
        // Ignore keep-alives and non-JSON extension events.
      }
    }

    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) consumeLine(line)
      if (done) break
    }
    if (buffer) consumeLine(buffer)
    return text.trim()
  }

  dispose(): void {
    this.loadedKey = null
    this.loadPromise = null
  }
}

export const openAiCompatibleLlmAdapter: LlmAdapter = new OpenAiCompatibleLlmAdapter()
