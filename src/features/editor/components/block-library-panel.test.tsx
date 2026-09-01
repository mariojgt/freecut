import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'

const insertBlock = vi.hoisted(() =>
  vi.fn((_params: { block: { id: string } }) => ({
    idPrefix: 'x',
    itemIds: [],
    trackIds: [],
    skipped: [],
  })),
)
const setProjectBlocks = vi.hoisted(() =>
  vi.fn(async (_id: string, _blocks: unknown[]) => undefined),
)

vi.mock('@/features/editor/deps/timeline-store', () => ({
  insertBlock,
  useTimelineStore: { getState: () => ({ fps: 30 }) },
  useCompositionNavigationStore: { getState: () => ({ activeCompositionId: null }) },
  useCompositionsStore: { getState: () => ({ getComposition: () => undefined }) },
}))

vi.mock('@/features/editor/deps/timeline-utils', () => ({
  getDefaultGeneratedLayerDurationInFrames: () => 150,
}))

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: { getState: () => ({ currentFrame: 0 }) },
}))

let currentProject: Project | null = null

vi.mock('@/features/editor/deps/projects', () => ({
  useProjectStore: Object.assign(
    (selector: (state: { currentProject: Project | null }) => unknown) =>
      selector({ currentProject }),
    { getState: () => ({ currentProject, setProjectBlocks }) },
  ),
}))

const { BlockLibraryPanel } = await import('./block-library-panel')

const projectBlock = (id: string, name: string) => ({
  definition: {
    id,
    name,
    category: 'prop' as const,
    width: 100,
    height: 100,
    parts: [
      { id: 'body', label: 'Body', d: 'M 0 0 L 90 0 L 90 90 Z', fill: 'accent' as const, z: 0 },
    ],
  },
  createdAt: 1,
  updatedAt: 1,
})

function makeProject(blocks?: ReturnType<typeof projectBlock>[]): Project {
  return {
    id: 'p1',
    name: 'P',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 0,
    metadata: { width: 1920, height: 1080, fps: 30 },
    ...(blocks ? { blocks } : {}),
  }
}

describe('BlockLibraryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentProject = makeProject()
  })

  it('lists the committed library', () => {
    render(<BlockLibraryPanel />)
    expect(screen.getByText('Astronaut')).toBeTruthy()
  })

  it('offers import even when the project owns no blocks', () => {
    // Otherwise there is no way to get the first one in.
    render(<BlockLibraryPanel />)
    expect(screen.getByText('Project blocks')).toBeTruthy()
    expect(screen.getByText('Import')).toBeTruthy()
    expect(screen.queryByTitle(/^Edit /)).toBeNull()
  })

  it('lists the project own blocks in their own section', () => {
    currentProject = makeProject([projectBlock('local-badge', 'Badge')])
    render(<BlockLibraryPanel />)
    expect(screen.getByText('Project blocks')).toBeTruthy()
    expect(screen.getByText('Badge')).toBeTruthy()
  })

  it('inserts a project block with the same path committed artwork takes', () => {
    currentProject = makeProject([projectBlock('local-badge', 'Badge')])
    render(<BlockLibraryPanel />)
    fireEvent.click(screen.getByTitle('Insert Badge'))
    expect(insertBlock).toHaveBeenCalledTimes(1)
    expect(insertBlock.mock.calls[0]?.[0]).toMatchObject({
      block: { id: 'local-badge' },
    })
  })

  it('removes a project block, leaving the rest', async () => {
    currentProject = makeProject([projectBlock('local-a', 'A'), projectBlock('local-b', 'B')])
    render(<BlockLibraryPanel />)
    fireEvent.click(screen.getByTitle('Remove A'))
    await Promise.resolve()
    expect(setProjectBlocks).toHaveBeenCalledTimes(1)
    const call = setProjectBlocks.mock.calls[0] as unknown as [
      string,
      ReturnType<typeof projectBlock>[],
    ]
    expect(call[1].map((entry) => entry.definition.id)).toEqual(['local-b'])
  })

  it('offers no remove control for committed artwork', () => {
    render(<BlockLibraryPanel />)
    expect(screen.queryByTitle('Remove Astronaut')).toBeNull()
  })
})

describe('BlockLibraryPanel export and import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentProject = makeProject([projectBlock('local-badge', 'Badge')])
  })

  it('downloads a block as a file named after it', () => {
    const created: HTMLAnchorElement[] = []
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = realCreate(tag) as HTMLAnchorElement
      if (tag === 'a') {
        element.click = vi.fn()
        created.push(element)
      }
      return element
    })
    const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    render(<BlockLibraryPanel />)
    fireEvent.click(screen.getByTitle('Export Badge'))

    expect(created[0]?.download).toBe('badge.freecut-block.json')
    expect(created[0]?.click).toHaveBeenCalled()
    // The blob URL is released, or every export leaks one for the session.
    expect(revoke).toHaveBeenCalledWith('blob:test')
    objectUrl.mockRestore()
    revoke.mockRestore()
    vi.mocked(document.createElement).mockRestore()
  })

  it('offers edit, export and remove for a project block', () => {
    render(<BlockLibraryPanel />)
    expect(screen.getByTitle('Edit Badge')).toBeTruthy()
    expect(screen.getByTitle('Export Badge')).toBeTruthy()
    expect(screen.getByTitle('Remove Badge')).toBeTruthy()
  })

  it('opens the rig editor on edit', () => {
    render(<BlockLibraryPanel />)
    fireEvent.click(screen.getByTitle('Edit Badge'))
    expect(screen.getByText('Rig: Badge')).toBeTruthy()
  })
})
