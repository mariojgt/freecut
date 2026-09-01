import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlaybackStore } from '@/shared/state/playback'
import { useLiveProjectFollow } from './use-live-project-follow'

const remote = {
  revision: 'sha256:r1',
  project: {
    id: 'proj1',
    name: 'Remote',
    description: '',
    createdAt: 1,
    updatedAt: 2,
    duration: 0,
    metadata: { width: 1280, height: 720, fps: 30, backgroundColor: '#101010' },
    timeline: { tracks: [], items: [] },
  },
}

const getHeadlessProject = vi.fn()
const listHeadlessMedia = vi.fn()
const listHeadlessProjects = vi.fn()
const registerExternalMediaUrl = vi.fn()
const hydrateTimelineStoresFromProject = vi.fn()

vi.mock('@/shared/deployment/headless-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/deployment/headless-api')>()),
  getHeadlessProject: (...args: unknown[]) => getHeadlessProject(...args) as never,
  listHeadlessMedia: (...args: unknown[]) => listHeadlessMedia(...args) as never,
  listHeadlessProjects: (...args: unknown[]) => listHeadlessProjects(...args) as never,
}))

vi.mock('../deps/media-contract', () => ({
  registerExternalMediaUrl: (...args: unknown[]) => registerExternalMediaUrl(...args),
}))

vi.mock('../deps/timeline-contract', () => ({
  hydrateTimelineStoresFromProject: (...args: unknown[]) =>
    hydrateTimelineStoresFromProject(...args) as never,
  useItemsStore: { getState: () => ({ maxItemEndFrame: 120 }) },
}))

vi.mock('@/shared/typography/fonts', () => ({
  ensureFontsLoaded: vi.fn().mockResolvedValue(undefined),
}))

describe('useLiveProjectFollow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getHeadlessProject.mockResolvedValue(remote)
    listHeadlessMedia.mockResolvedValue([])
    listHeadlessProjects.mockResolvedValue([{ id: 'proj1', revision: remote.revision }])
    hydrateTimelineStoresFromProject.mockResolvedValue(undefined)
  })

  it('registers server source URLs before hydrating referenced media', async () => {
    const withMedia = {
      ...remote,
      project: {
        ...remote.project,
        timeline: {
          tracks: [],
          items: [{ id: 'image-1', type: 'image', mediaId: 'card-1' }],
        },
      },
    }
    getHeadlessProject.mockResolvedValue(withMedia)
    listHeadlessMedia.mockResolvedValue([{ id: 'card-1', sourceAvailable: true }])

    const { unmount } = renderHook(() => useLiveProjectFollow('proj1'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(registerExternalMediaUrl).toHaveBeenCalledWith(
      'card-1',
      '/api/headless/v1/media/card-1/source',
    )
    expect(registerExternalMediaUrl.mock.invocationCallOrder[0]).toBeLessThan(
      hydrateTimelineStoresFromProject.mock.invocationCallOrder[0] ?? Infinity,
    )
    unmount()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('hydrates once, then re-hydrates only when the revision moves', async () => {
    const { result, unmount } = renderHook(() => useLiveProjectFollow('proj1'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.status).toBe('live')
    expect(result.current.revision).toBe('sha256:r1')
    expect(hydrateTimelineStoresFromProject).toHaveBeenCalledTimes(1)

    // Same revision: the poll must not re-fetch the body.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(hydrateTimelineStoresFromProject).toHaveBeenCalledTimes(1)
    expect(getHeadlessProject).toHaveBeenCalledTimes(1)

    // New revision: full re-hydrate, playhead clamped back where it was.
    usePlaybackStore.getState().setCurrentFrame(45)
    listHeadlessProjects.mockResolvedValue([{ id: 'proj1', revision: 'sha256:r2' }])
    getHeadlessProject.mockResolvedValue({ ...remote, revision: 'sha256:r2' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(hydrateTimelineStoresFromProject).toHaveBeenCalledTimes(2)
    expect(result.current.revision).toBe('sha256:r2')
    expect(usePlaybackStore.getState().currentFrame).toBe(45)

    unmount()
  })

  it('reports not-found and keeps watching until the project appears', async () => {
    const missing = Object.assign(new Error('missing'), { status: 404 })
    Object.setPrototypeOf(
      missing,
      (await import('@/shared/deployment/headless-api')).HeadlessApiError.prototype,
    )
    getHeadlessProject.mockRejectedValue(missing)

    const { result, unmount } = renderHook(() => useLiveProjectFollow('proj1'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.status).toBe('not-found')

    getHeadlessProject.mockResolvedValue(remote)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(result.current.status).toBe('live')

    unmount()
  })
})
