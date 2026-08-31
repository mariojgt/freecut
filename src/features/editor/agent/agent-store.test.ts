import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { LlmAdapter, LlmLoadProgress } from '@/infrastructure/llm'

const mocks = vi.hoisted(() => ({
  adapter: {
    id: 'test-browser',
    label: 'Test browser model',
    isSupported: vi.fn(() => true),
    load: vi.fn(),
    generate: vi.fn(),
    dispose: vi.fn(),
  },
}))

vi.mock('./agent-service', () => ({
  getAgentAdapter: () => mocks.adapter,
  planRequest: vi.fn(),
  runStep: vi.fn(),
}))

import { useAgentStore } from './agent-store'

describe('agent model loading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAgentStore.setState({
      supported: true,
      modelStatus: 'idle',
      loadPercent: 0,
      loadStage: null,
      loadLoadedBytes: 0,
      loadTotalBytes: 0,
      loadError: null,
      messages: [],
      phase: 'idle',
      streamingText: '',
      plan: null,
    })
  })

  it('keeps aggregate byte progress for the download UI', async () => {
    mocks.adapter.load.mockImplementationOnce(
      async (onProgress?: (progress: LlmLoadProgress) => void) => {
        onProgress?.({
          stage: 'downloading-model',
          percent: 42,
          loadedBytes: 250,
          totalBytes: 1_000,
        })
      },
    )

    await useAgentStore.getState().loadModel()

    expect(useAgentStore.getState()).toEqual(
      expect.objectContaining({
        modelStatus: 'ready',
        loadPercent: 100,
        loadStage: 'ready',
        loadLoadedBytes: 250,
        loadTotalBytes: 1_000,
      }),
    )
  })

  it('cancels an in-flight download without leaving the store stuck', async () => {
    let rejectLoad: ((error: Error) => void) | undefined
    mocks.adapter.load.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectLoad = reject
        }),
    )
    mocks.adapter.dispose.mockImplementationOnce(() => {
      rejectLoad?.(new DOMException('Model loading cancelled.', 'AbortError'))
    })

    const loading = useAgentStore.getState().loadModel()
    expect(useAgentStore.getState().modelStatus).toBe('loading')

    useAgentStore.getState().cancel()

    await expect(loading).rejects.toThrow('Model loading cancelled')
    expect(mocks.adapter.dispose).toHaveBeenCalledOnce()
    expect(useAgentStore.getState()).toEqual(
      expect.objectContaining({
        modelStatus: 'idle',
        loadPercent: 0,
        loadStage: null,
        loadError: null,
      }),
    )
  })
})

// Compile-time check that the test double stays aligned with the adapter contract.
void (mocks.adapter satisfies LlmAdapter)
