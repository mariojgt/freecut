import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { setLocalLlmConfig } from './local-llm-config'
import { openAiCompatibleLlmAdapter } from './openai-compatible-llm-adapter'

describe('OpenAI-compatible local LLM adapter', () => {
  beforeEach(() => {
    localStorage.clear()
    openAiCompatibleLlmAdapter.dispose()
    setLocalLlmConfig({
      adapterId: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'local-model',
    })
    vi.restoreAllMocks()
  })

  it('checks the configured model and returns a non-streaming response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), {
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'A grounded edit plan.' } }] }),
          { headers: { 'content-type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      openAiCompatibleLlmAdapter.generate([{ role: 'user', content: 'Plan this edit' }]),
    ).resolves.toBe('A grounded edit plan.')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:11434/v1/models',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:11434/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('streams SSE token deltas', async () => {
    const onToken = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), {
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            [
              'data: {"choices":[{"delta":{"content":"Hello"}}]}',
              '',
              'data: {"choices":[{"delta":{"content":" world"}}]}',
              '',
              'data: [DONE]',
              '',
            ].join('\n'),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
        ),
    )

    const text = await openAiCompatibleLlmAdapter.generate([{ role: 'user', content: 'Hello' }], {
      onToken,
    })

    expect(text).toBe('Hello world')
    expect(onToken).toHaveBeenNthCalledWith(1, 'Hello', 'Hello')
    expect(onToken).toHaveBeenNthCalledWith(2, ' world', 'Hello world')
  })

  it('reports available models when the configured one is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: 'gemma3:4b' }] }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    await expect(openAiCompatibleLlmAdapter.load()).rejects.toThrow('Installed models: gemma3:4b')
  })
})
