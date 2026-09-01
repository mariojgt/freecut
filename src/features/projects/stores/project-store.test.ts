// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'

const storageMocks = vi.hoisted(() => ({
  getAllProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  getProjectMediaIds: vi.fn(),
  associateMediaWithProject: vi.fn(),
  softDeleteProject: vi.fn(),
  restoreProject: vi.fn(),
  getTrashedProjectMediaIds: vi.fn(),
}))

vi.mock('@/infrastructure/storage', () => storageMocks)

vi.mock('@/features/projects/deps/media-library-contract', () => ({
  importMediaLibraryService: vi.fn(async () => ({
    mediaLibraryService: {
      deleteMediaFromProject: vi.fn(),
    },
  })),
}))

vi.mock('@/features/projects/deps/settings-contract', () => ({
  useSettingsStore: {
    getState: () => ({ maxUndoHistory: 100 }),
    subscribe: vi.fn(),
  },
}))

const { useProjectStore } = await import('./project-store')

function makeProject(id: string): Project {
  const now = Date.now()
  return {
    id,
    name: `Project ${id}`,
    description: '',
    createdAt: now,
    updatedAt: now,
    duration: 0,
    metadata: {
      width: 1920,
      height: 1080,
      fps: 30,
      backgroundColor: '#000000',
    },
  }
}

describe('project-store deleteProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      projects: [],
      currentProject: null,
      isLoading: false,
      error: null,
      searchQuery: '',
      sortField: 'updatedAt',
      sortDirection: 'desc',
      filterResolution: undefined,
      filterFps: undefined,
    })
  })

  it('keeps a deleted project pruned if a stale reload lands while soft-delete is pending', async () => {
    const project = makeProject('p1')
    let finishSoftDelete!: () => void
    storageMocks.softDeleteProject.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSoftDelete = () =>
            resolve({
              deletedAt: Date.now(),
              originalName: project.name,
            })
        }),
    )

    useProjectStore.setState({ projects: [project], currentProject: project })

    const deletePromise = useProjectStore.getState().deleteProject(project.id)

    expect(useProjectStore.getState().projects).toEqual([])

    useProjectStore.setState({ projects: [project], currentProject: project })
    finishSoftDelete()
    await deletePromise

    expect(useProjectStore.getState().projects).toEqual([])
    expect(useProjectStore.getState().currentProject).toBeNull()
  })
})

describe('project-store setProjectBlocks', () => {
  const block = (id: string) => ({
    definition: {
      id,
      name: id,
      category: 'prop' as const,
      width: 100,
      height: 100,
      parts: [{ id: 'body', label: 'Body', d: 'M 0 0 L 1 0 L 1 1 Z', fill: 'ink' as const, z: 0 }],
    },
    createdAt: 1,
    updatedAt: 1,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    storageMocks.updateProject.mockImplementation(async (_id: string, project: Project) => project)
    useProjectStore.setState({ projects: [], currentProject: null, error: null })
  })

  it('saves blocks onto the current project', async () => {
    const project = makeProject('p1')
    useProjectStore.setState({ projects: [project], currentProject: project })

    await useProjectStore.getState().setProjectBlocks('p1', [block('local-a')])

    expect(useProjectStore.getState().currentProject?.blocks).toHaveLength(1)
    expect(storageMocks.updateProject).toHaveBeenCalledTimes(1)
  })

  it('drops the key entirely when the last block goes', async () => {
    // Absent and empty must not both occur, or a project churns between shapes
    // on every save — the headless editor writes it the same way.
    const project = { ...makeProject('p1'), blocks: [block('local-a')] }
    useProjectStore.setState({ projects: [project], currentProject: project })

    await useProjectStore.getState().setProjectBlocks('p1', [])

    const saved = useProjectStore.getState().currentProject!
    expect('blocks' in saved).toBe(false)
  })

  it('keeps the projects list in step with the current project', async () => {
    const project = makeProject('p1')
    useProjectStore.setState({ projects: [project, makeProject('p2')], currentProject: project })

    await useProjectStore.getState().setProjectBlocks('p1', [block('local-a')])

    const listed = useProjectStore.getState().projects.find((entry) => entry.id === 'p1')
    expect(listed?.blocks).toHaveLength(1)
    expect(useProjectStore.getState().projects.find((e) => e.id === 'p2')?.blocks).toBeUndefined()
  })

  it('updates a project that is not the open one', async () => {
    useProjectStore.setState({ projects: [makeProject('p1')], currentProject: null })
    await useProjectStore.getState().setProjectBlocks('p1', [block('local-a')])
    expect(useProjectStore.getState().projects[0]?.blocks).toHaveLength(1)
  })

  it('refuses a project it does not know', async () => {
    await expect(useProjectStore.getState().setProjectBlocks('missing', [])).rejects.toThrow(
      /Project not found/,
    )
  })
})
