import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMcpProjectSync } from './use-mcp-project-sync'

const remoteProject = {
  id: 'proj1',
  name: 'Remote project',
  description: '',
  createdAt: 1,
  updatedAt: 2,
  duration: 120,
  schemaVersion: 16,
  metadata: { width: 1280, height: 720, fps: 30, backgroundColor: '#101010' },
  timeline: {
    tracks: [],
    items: [{ id: 'image-1', type: 'image', mediaId: 'card-1' }],
  },
}

const mocks = vi.hoisted(() => ({
  getHeadlessProject: vi.fn(),
  listHeadlessMedia: vi.fn(),
  listHeadlessProjects: vi.fn(),
  registerExternalMediaUrl: vi.fn(),
  updateProject: vi.fn(),
  hydrate: vi.fn(),
  setCurrentProject: vi.fn(),
  setCurrentFrame: vi.fn(),
  settings: { isDirty: false, isTimelineLoading: false },
  listeners: new Set<
    (
      state: { isDirty: boolean; isTimelineLoading: boolean },
      previous: { isDirty: boolean; isTimelineLoading: boolean },
    ) => void
  >(),
}))

vi.mock('@/shared/deployment/headless-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/deployment/headless-api')>()),
  getHeadlessProject: (...args: unknown[]) => mocks.getHeadlessProject(...args) as never,
  listHeadlessMedia: (...args: unknown[]) => mocks.listHeadlessMedia(...args) as never,
  listHeadlessProjects: (...args: unknown[]) => mocks.listHeadlessProjects(...args) as never,
}))

vi.mock('@/shared/projects/migrations', () => ({
  migrateProject: (project: unknown) => ({ project }),
}))

vi.mock('../deps/server-media-contract', () => ({
  registerExternalMediaUrl: (...args: unknown[]) => mocks.registerExternalMediaUrl(...args),
}))

vi.mock('../deps/storage-contract', () => ({
  updateProject: (...args: unknown[]) => mocks.updateProject(...args) as never,
}))

vi.mock('../deps/projects', () => ({
  useProjectStore: {
    getState: () => ({ setCurrentProject: mocks.setCurrentProject }),
  },
}))

vi.mock('../deps/timeline-store', () => ({
  useItemsStore: { getState: () => ({ maxItemEndFrame: 120 }) },
  useTimelineSettingsStore: {
    getState: () => mocks.settings,
    subscribe: (
      listener: (state: typeof mocks.settings, previous: typeof mocks.settings) => void,
    ) => {
      mocks.listeners.add(listener)
      return () => mocks.listeners.delete(listener)
    },
  },
}))

vi.mock('../deps/timeline-persistence-contract', () => ({
  hydrateTimelineStoresFromProject: (...args: unknown[]) => mocks.hydrate(...args) as never,
}))

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: {
    getState: () => ({
      currentFrame: 40,
      setCurrentFrame: mocks.setCurrentFrame,
    }),
  },
}))

function setDirty(isDirty: boolean): void {
  const previous = { ...mocks.settings }
  mocks.settings.isDirty = isDirty
  for (const listener of mocks.listeners) listener(mocks.settings, previous)
}

const runExclusive = <T,>(operation: () => Promise<T>) => operation()
const divergenceKey = 'freecut:mcp-local-diverged:proj1'

describe('useMcpProjectSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    mocks.settings.isDirty = false
    mocks.settings.isTimelineLoading = false
    mocks.getHeadlessProject.mockResolvedValue({
      project: remoteProject,
      revision: 'sha256:r1',
    })
    mocks.listHeadlessProjects.mockResolvedValue([{ id: 'proj1', revision: 'sha256:r1' }])
    mocks.listHeadlessMedia.mockResolvedValue([{ id: 'card-1', sourceAvailable: true }])
    mocks.updateProject.mockResolvedValue(remoteProject)
    mocks.hydrate.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    mocks.listeners.clear()
  })

  it('hydrates a clean editor and follows later MCP revisions', async () => {
    const { unmount } = renderHook(() =>
      useMcpProjectSync({ projectId: 'proj1', enabled: true, runExclusive }),
    )
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(mocks.registerExternalMediaUrl).toHaveBeenCalledWith(
      'card-1',
      '/api/headless/v1/media/card-1/source',
    )
    expect(mocks.updateProject).toHaveBeenCalledTimes(1)
    expect(mocks.hydrate).toHaveBeenCalledTimes(1)

    mocks.listHeadlessProjects.mockResolvedValue([{ id: 'proj1', revision: 'sha256:r2' }])
    mocks.getHeadlessProject.mockResolvedValue({
      project: remoteProject,
      revision: 'sha256:r2',
    })
    await act(async () => vi.advanceTimersByTimeAsync(1600))

    expect(mocks.hydrate).toHaveBeenCalledTimes(2)
    expect(mocks.setCurrentFrame).toHaveBeenLastCalledWith(40)
    unmount()
  })

  it('never overwrites local work, and resumes after an explicit push', async () => {
    const { result, unmount } = renderHook(() =>
      useMcpProjectSync({ projectId: 'proj1', enabled: true, runExclusive }),
    )
    await act(async () => vi.advanceTimersByTimeAsync(0))

    act(() => {
      setDirty(true)
      setDirty(false)
    })
    mocks.listHeadlessProjects.mockResolvedValue([{ id: 'proj1', revision: 'sha256:r2' }])
    await act(async () => vi.advanceTimersByTimeAsync(1600))
    expect(mocks.hydrate).toHaveBeenCalledTimes(1)

    act(() => result.current.notePushedRevision('sha256:r2'))
    mocks.listHeadlessProjects.mockResolvedValue([{ id: 'proj1', revision: 'sha256:r3' }])
    mocks.getHeadlessProject.mockResolvedValue({
      project: remoteProject,
      revision: 'sha256:r3',
    })
    await act(async () => vi.advanceTimersByTimeAsync(1600))
    expect(mocks.hydrate).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('aborts a prepared remote swap when the user edits before its atomic commit', async () => {
    let releasePreparation!: () => void
    const preparation = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    mocks.hydrate.mockImplementation(
      async (_project: unknown, options: { shouldCommit?: () => boolean }) => {
        await preparation
        return options.shouldCommit?.() ?? true
      },
    )

    const { unmount } = renderHook(() =>
      useMcpProjectSync({ projectId: 'proj1', enabled: true, runExclusive }),
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.hydrate).toHaveBeenCalledTimes(1)

    act(() => {
      setDirty(true)
      setDirty(false)
    })
    await act(async () => {
      releasePreparation()
      await Promise.resolve()
    })

    expect(mocks.updateProject).not.toHaveBeenCalled()
    expect(mocks.setCurrentProject).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(divergenceKey)).toBe('1')
    unmount()
  })

  it('remembers unsent divergence across refresh until the project is pushed', async () => {
    window.localStorage.setItem(divergenceKey, '1')
    const { result, unmount } = renderHook(() =>
      useMcpProjectSync({ projectId: 'proj1', enabled: true, runExclusive }),
    )
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(mocks.hydrate).not.toHaveBeenCalled()
    act(() => result.current.notePushedRevision('sha256:r1'))
    expect(window.localStorage.getItem(divergenceKey)).toBeNull()
    unmount()
  })
})
