import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const adapter = vi.hoisted(() => ({
  id: 'test',
  label: 'Test model',
  isSupported: vi.fn(() => true),
  load: vi.fn(async () => undefined),
  generate: vi.fn(),
  dispose: vi.fn(),
}))

vi.mock('@/infrastructure/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/infrastructure/llm')>()
  return { ...actual, getSelectedLlmAdapter: () => adapter }
})

vi.mock('./timeline-context', () => ({
  buildTimelineContext: () => ({
    text: 'Project: 10.0s long at 30fps.\nClips: none.',
    fps: 30,
    selectedCount: 0,
    clipCount: 0,
  }),
}))

import { planRequest } from './agent-service'

describe('agent edit planning reliability', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retries when a model answers an edit request without tool steps', async () => {
    adapter.generate
      .mockResolvedValueOnce('{"reply":"You can add a title from the text panel.","steps":[]}')
      .mockResolvedValueOnce(
        '{"reply":"Adding the title.","steps":[{"tool":"add_title","args":{"text":"Hello"}}]}',
      )

    const result = await planRequest('Add a title saying Hello', { history: [] })

    expect(adapter.generate).toHaveBeenCalledTimes(2)
    expect(adapter.generate.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('MUST call one or more listed editing tools'),
        }),
      ]),
    )
    expect(result.steps).toEqual([
      expect.objectContaining({ tool: 'add_title', args: { text: 'Hello' } }),
    ])
  })

  it('falls back to a validated bulk action if the tiny model ignores its correction', async () => {
    adapter.generate.mockResolvedValue(
      '{"reply":"Here is how to add transitions manually.","steps":[]}',
    )

    const result = await planRequest('Add fade transitions to all videos', { history: [] })

    expect(adapter.generate).toHaveBeenCalledTimes(2)
    expect(result.reply).toBe('I’ll add transitions across the requested clips.')
    expect(result.steps).toEqual([
      expect.objectContaining({
        tool: 'add_transitions',
        args: { scope: 'all', type: 'fade' },
      }),
    ])
  })

  it('asks for missing edit details instead of returning a chat-only answer', async () => {
    adapter.generate.mockResolvedValue(
      '{"reply":"You can make that change from the inspector.","steps":[]}',
    )

    const result = await planRequest('Rotate all video clips slightly', { history: [] })

    expect(adapter.generate).toHaveBeenCalledTimes(2)
    expect(result.steps).toEqual([])
    expect(result.reply).toBe(
      'I need the target clips or exact times before I can make that edit safely.',
    )
  })
})
