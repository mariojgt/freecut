import { describe, expect, it } from 'vite-plus/test'
import { BrowserLlmProgressTracker } from './browser-llm-progress'

describe('BrowserLlmProgressTracker', () => {
  it('uses aggregate progress and ignores per-file resets', () => {
    const tracker = new BrowserLlmProgressTracker()

    expect(tracker.update({ status: 'progress_total', loaded: 100, total: 1_000 })).toEqual({
      percent: 14,
      loadedBytes: 100,
      totalBytes: 1_000,
    })
    expect(
      tracker.update({ status: 'progress', progress: 100, loaded: 100, total: 100 }),
    ).toBeNull()
    expect(tracker.update({ status: 'progress_total', loaded: 500, total: 1_000 })).toEqual({
      percent: 50,
      loadedBytes: 500,
      totalBytes: 1_000,
    })
    expect(tracker.update({ status: 'progress_total', loaded: 1_000, total: 1_000 })).toEqual({
      percent: 95,
      loadedBytes: 1_000,
      totalBytes: 1_000,
    })
  })

  it('ignores events that cannot describe whole-model progress', () => {
    const tracker = new BrowserLlmProgressTracker()
    expect(tracker.update({ status: 'download' })).toBeNull()
    expect(tracker.update({ status: 'progress_total', loaded: 0, total: 0 })).toBeNull()
  })
})
