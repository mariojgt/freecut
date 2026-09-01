import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeadlessApiError } from '@/shared/deployment/headless-api'
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

const remoteMedia = {
  id: 'card-1',
  storageType: 'workspace',
  fileName: 'card.svg',
  fileSize: 7,
  mimeType: 'image/svg+xml',
  duration: 0,
  width: 100,
  height: 140,
  fps: 0,
  codec: 'unknown',
  bitrate: 0,
  tags: [],
  createdAt: 1,
  updatedAt: 1,
}

const mocks = vi.hoisted(() => ({
  getHeadlessProject: vi.fn(),
  publishActiveMcpSession: vi.fn(),
  listHeadlessMedia: vi.fn(),
  listHeadlessProjects: vi.fn(),
  materializeMediaFromUrl: vi.fn(),
  getMedia: vi.fn(),
  getMediaFile: vi.fn(),
  uploadMedia: vi.fn(),
  loadMediaItems: vi.fn(),
  prependMediaItem: vi.fn(),
  updateProject: vi.fn(),
  hydrate: vi.fn(),
  refreshMediaValidation: vi.fn(),
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
  publishActiveMcpSession: (...args: unknown[]) => mocks.publishActiveMcpSession(...args) as never,
  uploadMediaToHeadlessWorkspace: (...args: unknown[]) => mocks.uploadMedia(...args) as never,
}))

vi.mock('@/shared/projects/migrations', () => ({
  migrateProject: (project: unknown) => ({ project }),
}))

vi.mock('../deps/server-media-contract', () => ({
  importServerMediaBridge: async () => ({
    mediaLibraryService: {
      materializeMediaFromUrl: (...args: unknown[]) =>
        mocks.materializeMediaFromUrl(...args) as never,
      getMedia: (...args: unknown[]) => mocks.getMedia(...args) as never,
      getMediaFile: (...args: unknown[]) => mocks.getMediaFile(...args) as never,
    },
    useMediaLibraryStore: {
      getState: () => ({
        currentProjectId: 'proj1',
        loadMediaItems: mocks.loadMediaItems,
        prependMediaItem: mocks.prependMediaItem,
      }),
    },
  }),
}))

vi.mock('../deps/storage-contract', () => ({
  updateProject: (...args: unknown[]) => mocks.updateProject(...args) as never,
}))

vi.mock('../deps/projects', () => ({
  useProjectStore: {
    getState: () => ({
      setCurrentProject: mocks.setCurrentProject,
      currentProject: { id: 'proj1', name: 'Remote project' },
    }),
  },
}))

vi.mock('../deps/timeline-store', () => ({
  useItemsStore: { getState: () => ({ maxItemEndFrame: 120, mediaDependencyIds: ['card-1'] }) },
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
  refreshLoadedProjectMediaValidation: (...args: unknown[]) =>
    mocks.refreshMediaValidation(...args) as never,
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
const appliedRevisionKey = 'freecut:mcp-applied-revision:proj1'

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
    mocks.listHeadlessMedia.mockResolvedValue([
      { id: 'card-1', sourceAvailable: true, metadata: remoteMedia },
    ])
    mocks.materializeMediaFromUrl.mockResolvedValue(remoteMedia)
    mocks.loadMediaItems.mockResolvedValue(undefined)
    mocks.refreshMediaValidation.mockResolvedValue(undefined)
    mocks.updateProject.mockResolvedValue(remoteProject)
    mocks.publishActiveMcpSession.mockResolvedValue(true)
    mocks.uploadMedia.mockResolvedValue(true)
    mocks.hydrate.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    mocks.listeners.clear()
  })

  it('hydrates a clean editor and follows later MCP revisions', async () => {
    const { result, unmount } = renderHook(() =>
      useMcpProjectSync({ projectId: 'proj1', enabled: true, runExclusive }),
    )
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(mocks.materializeMediaFromUrl).toHaveBeenCalledWith(
      '/api/headless/v1/media/card-1/source',
      'proj1',
      remoteMedia,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(mocks.loadMediaItems).toHaveBeenCalledTimes(1)
    expect(mocks.prependMediaItem).toHaveBeenCalledWith(remoteMedia)
    expect(mocks.updateProject).toHaveBeenCalledTimes(1)
    expect(mocks.hydrate).toHaveBeenCalledTimes(1)
    expect(mocks.materializeMediaFromUrl.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.hydrate.mock.invocationCallOrder[0]!,
    )
    expect(mocks.refreshMediaValidation).toHaveBeenCalledWith('proj1')
    expect(result.current.getPushExpectedRevision()).toBe('sha256:r1')
    expect(window.localStorage.getItem(appliedRevisionKey)).toBe('sha256:r1')

    mocks.listHeadlessProjects.mockResolvedValue([{ id: 'proj1', revision: 'sha256:r2' }])
    mocks.getHeadlessProject.mockResolvedValue({
      project: remoteProject,
      revision: 'sha256:r2',
    })
    await act(async () => vi.advanceTimersByTimeAsync(1600))

    expect(mocks.hydrate).toHaveBeenCalledTimes(2)
    expect(mocks.setCurrentFrame).toHaveBeenLastCalledWith(40)
    expect(result.current.getPushExpectedRevision()).toBe('sha256:r2')
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
    expect(result.current.getPushExpectedRevision()).toBe('sha256:r1')

    act(() => result.current.notePushedRevision('sha256:r2'))
    expect(result.current.getPushExpectedRevision()).toBe('sha256:r2')
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

  it('imports project-linked media the MCP tool has not placed on the timeline', async () => {
    const uploaded = { ...remoteMedia, id: 'upload-1', fileName: 'moon.svg' }
    mocks.listHeadlessMedia.mockResolvedValue([
      { id: 'card-1', sourceAvailable: true, metadata: remoteMedia },
      { id: 'upload-1', sourceAvailable: true, metadata: uploaded, projectIds: ['proj1'] },
      { id: 'other-1', sourceAvailable: true, metadata: remoteMedia, projectIds: ['proj2'] },
    ])
    mocks.materializeMediaFromUrl.mockImplementation(
      async (_url: string, _projectId: string, metadata: unknown) => metadata,
    )

    const { unmount } = renderHook(() =>
      useMcpProjectSync({ projectId: 'proj1', enabled: true, runExclusive }),
    )
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(mocks.materializeMediaFromUrl).toHaveBeenCalledWith(
      '/api/headless/v1/media/upload-1/source',
      'proj1',
      uploaded,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(mocks.materializeMediaFromUrl).not.toHaveBeenCalledWith(
      '/api/headless/v1/media/other-1/source',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
    expect(mocks.prependMediaItem).toHaveBeenCalledWith(uploaded)
    expect(mocks.hydrate).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('still applies a revision when an unreferenced linked upload cannot be copied', async () => {
    mocks.listHeadlessMedia.mockResolvedValue([
      { id: 'card-1', sourceAvailable: true, metadata: remoteMedia },
      {
        id: 'upload-1',
        sourceAvailable: true,
        metadata: { ...remoteMedia, id: 'upload-1' },
        projectIds: ['proj1'],
      },
    ])
    mocks.materializeMediaFromUrl.mockImplementation(async (url: string) => {
      if (url.includes('upload-1')) throw new Error('source vanished')
      return remoteMedia
    })

    const { unmount } = renderHook(() =>
      useMcpProjectSync({ projectId: 'proj1', enabled: true, runExclusive }),
    )
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(mocks.hydrate).toHaveBeenCalledTimes(1)
    expect(mocks.updateProject).toHaveBeenCalledTimes(1)
    expect(mocks.prependMediaItem).toHaveBeenCalledTimes(1)
    expect(mocks.prependMediaItem).toHaveBeenCalledWith(remoteMedia)
    unmount()
  })

  it('announces the open project so an agent can find it without being told', async () => {
    const { unmount } = renderHook(() =>
      useMcpProjectSync({ projectId: 'proj1', enabled: true, runExclusive }),
    )
    await act(async () => vi.advanceTimersByTimeAsync(0))

    // The first beat lands before any revision is applied — announcing the
    // open project must not wait on the workspace knowing about it.
    expect(mocks.publishActiveMcpSession).toHaveBeenCalledWith(
      'proj1',
      'Remote project',
      null,
      expect.any(AbortSignal),
    )

    // Once a revision is applied, later beats carry it.
    await act(async () => vi.advanceTimersByTimeAsync(1600))
    expect(mocks.publishActiveMcpSession).toHaveBeenLastCalledWith(
      'proj1',
      'Remote project',
      'sha256:r1',
      expect.any(AbortSignal),
    )
    unmount()
  })

  it('hands local work to the workspace instead of latching the link shut', async () => {
    // A real publish saves first, which is what clears the dirty flag.
    const publishLocal = vi.fn().mockImplementation(async () => {
      setDirty(false)
      return 'sha256:local'
    })
    const { result, unmount } = renderHook(() =>
      useMcpProjectSync({ projectId: 'proj1', enabled: true, runExclusive, publishLocal }),
    )
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(mocks.hydrate).toHaveBeenCalledTimes(1)

    // The user edits: the follower must stop applying remote revisions...
    act(() => setDirty(true))
    mocks.listHeadlessProjects.mockResolvedValue([{ id: 'proj1', revision: 'sha256:r2' }])
    await act(async () => vi.advanceTimersByTimeAsync(1600))
    expect(mocks.hydrate).toHaveBeenCalledTimes(1)
    expect(publishLocal).not.toHaveBeenCalled()

    // ...and once editing settles, publish that work as the new shared base.
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(publishLocal).toHaveBeenCalledWith('sha256:r1')
    expect(result.current.getPushExpectedRevision()).toBe('sha256:local')
    expect(window.localStorage.getItem(divergenceKey)).toBeNull()

    // The link is open again: the next remote revision applies.
    mocks.listHeadlessProjects.mockResolvedValue([{ id: 'proj1', revision: 'sha256:r3' }])
    mocks.getHeadlessProject.mockResolvedValue({ project: remoteProject, revision: 'sha256:r3' })
    await act(async () => vi.advanceTimersByTimeAsync(1600))
    expect(mocks.hydrate).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('seeds a project the workspace has never seen so an agent can act on it', async () => {
    mocks.getHeadlessProject.mockRejectedValue(new HeadlessApiError('missing', 404))
    mocks.listHeadlessProjects.mockResolvedValue([])
    const publishLocal = vi.fn().mockResolvedValue('sha256:seeded')

    const { result, unmount } = renderHook(() =>
      useMcpProjectSync({ projectId: 'proj1', enabled: true, runExclusive, publishLocal }),
    )
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(publishLocal).toHaveBeenCalledWith(null)
    expect(result.current.getPushExpectedRevision()).toBe('sha256:seeded')
    expect(mocks.publishActiveMcpSession).toHaveBeenCalled()
    unmount()
  })

  it('hands local-only media to the workspace so an agent can render the scene', async () => {
    // The server knows the project's media id but holds no bytes for it.
    mocks.listHeadlessMedia.mockResolvedValue([{ id: 'card-1', sourceAvailable: false }])
    mocks.getMedia.mockResolvedValue({ id: 'card-1', fileName: 'card.svg' })
    const blob = new Blob(['<svg/>'], { type: 'image/svg+xml' })
    mocks.getMediaFile.mockResolvedValue(blob)
    const publishLocal = vi.fn().mockImplementation(async () => {
      setDirty(false)
      return 'sha256:local'
    })

    const { unmount } = renderHook(() =>
      useMcpProjectSync({ projectId: 'proj1', enabled: true, runExclusive, publishLocal }),
    )
    await act(async () => vi.advanceTimersByTimeAsync(0))
    act(() => setDirty(true))
    await act(async () => vi.advanceTimersByTimeAsync(3600))

    expect(publishLocal).toHaveBeenCalled()
    expect(mocks.uploadMedia).toHaveBeenCalledWith(
      'card-1',
      'proj1',
      'card.svg',
      blob,
      expect.any(AbortSignal),
    )
    unmount()
  })

  it('does not re-upload media the workspace already holds', async () => {
    mocks.listHeadlessMedia.mockResolvedValue([
      { id: 'card-1', sourceAvailable: true, metadata: remoteMedia },
    ])
    const publishLocal = vi.fn().mockImplementation(async () => {
      setDirty(false)
      return 'sha256:local'
    })

    const { unmount } = renderHook(() =>
      useMcpProjectSync({ projectId: 'proj1', enabled: true, runExclusive, publishLocal }),
    )
    await act(async () => vi.advanceTimersByTimeAsync(0))
    act(() => setDirty(true))
    await act(async () => vi.advanceTimersByTimeAsync(3600))

    expect(publishLocal).toHaveBeenCalled()
    expect(mocks.uploadMedia).not.toHaveBeenCalled()
    unmount()
  })

  it('does not apply or persist a revision when required media cannot be materialized', async () => {
    mocks.materializeMediaFromUrl.mockRejectedValue(new Error('workspace permission denied'))
    const { unmount } = renderHook(() =>
      useMcpProjectSync({ projectId: 'proj1', enabled: true, runExclusive }),
    )
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(mocks.hydrate).not.toHaveBeenCalled()
    expect(mocks.updateProject).not.toHaveBeenCalled()
    expect(mocks.refreshMediaValidation).not.toHaveBeenCalled()
    unmount()
  })
})
