import { beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  useItemsStore,
  useTimelineCommandStore,
  useTimelineSettingsStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import type { TimelineTrack, VideoItem } from '@/types/timeline'
import { buildClipRefs } from './clip-refs'
import { getEditorTool } from './registry'

function makeTimelineTrack(overrides: Partial<TimelineTrack>): TimelineTrack {
  return {
    id: 'track-v1',
    name: 'V1',
    kind: 'video',
    order: 0,
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    items: [],
    ...overrides,
  }
}

function makeTimelineVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'track-v1',
    from: 0,
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:video',
    mediaId: 'media-1',
    sourceStart: 0,
    sourceEnd: 60,
    sourceDuration: 120,
    sourceFps: 30,
    ...overrides,
  }
}

function toolArgs(name: string, args: unknown) {
  const tool = getEditorTool(name)
  if (!tool) throw new Error(`Missing tool: ${name}`)
  const validation = tool.validate(args)
  if (!validation.ok) throw new Error(validation.error)
  return { tool, args: validation.value }
}

describe('editor agent mutation tools', () => {
  beforeEach(() => {
    useItemsStore.getState().setItems([])
    useItemsStore.getState().setTracks([])
    useTimelineStore.setState({ transitions: [] })
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useEditorStore.setState({ linkedSelectionEnabled: false })
    useSelectionStore.getState().clearSelection()
    useItemsStore
      .getState()
      .setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
  })

  it('maps the model-facing fade style to a real crossfade presentation', async () => {
    useItemsStore.getState().setItems([
      makeTimelineVideoItem({
        id: 'left',
        from: 0,
        sourceStart: 0,
        sourceEnd: 60,
        sourceDuration: 120,
      }),
      makeTimelineVideoItem({
        id: 'right',
        from: 60,
        sourceStart: 60,
        sourceEnd: 120,
        sourceDuration: 180,
      }),
    ])
    buildClipRefs()

    const call = toolArgs('add_transition', {
      clips: ['c1', 'c2'],
      type: 'fade',
      durationSeconds: 0.5,
    })
    const result = await call.tool.execute(call.args)

    expect(result.ok).toBe(true)
    expect(useTimelineStore.getState().transitions).toEqual([
      expect.objectContaining({ type: 'crossfade', presentation: 'fade', durationInFrames: 15 }),
    ])
  })

  it('adds transitions across all adjacent videos with one bulk tool call', async () => {
    useItemsStore.getState().setItems([
      makeTimelineVideoItem({
        id: 'first',
        from: 0,
        sourceStart: 0,
        sourceEnd: 60,
        sourceDuration: 120,
      }),
      makeTimelineVideoItem({
        id: 'second',
        from: 60,
        sourceStart: 60,
        sourceEnd: 120,
        sourceDuration: 180,
      }),
      makeTimelineVideoItem({
        id: 'third',
        from: 120,
        sourceStart: 60,
        sourceEnd: 120,
        sourceDuration: 180,
      }),
    ])
    buildClipRefs()

    const call = toolArgs('add_transitions', {
      scope: 'all',
      type: 'fade',
      durationSeconds: 0.5,
    })
    const result = await call.tool.execute(call.args)

    expect(result.ok).toBe(true)
    expect(useTimelineStore.getState().transitions).toHaveLength(2)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it('uses visible fade edges when full-source clips have no hidden transition handles', async () => {
    useItemsStore.getState().setItems([
      makeTimelineVideoItem({
        id: 'first',
        from: 0,
        sourceStart: 0,
        sourceEnd: 60,
        sourceDuration: 60,
      }),
      makeTimelineVideoItem({
        id: 'second',
        from: 60,
        sourceStart: 0,
        sourceEnd: 60,
        sourceDuration: 60,
      }),
    ])
    buildClipRefs()

    const call = toolArgs('add_transitions', {
      scope: 'all',
      type: 'fade',
      durationSeconds: 0.5,
    })
    const result = await call.tool.execute(call.args)

    expect(result.ok).toBe(true)
    expect(useTimelineStore.getState().transitions).toHaveLength(0)
    expect(useItemsStore.getState().items).toEqual([
      expect.objectContaining({ id: 'first', fadeOut: 0.5 }),
      expect.objectContaining({ id: 'second', fadeIn: 0.5 }),
    ])
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it('applies visual fades to every video in one undoable command', async () => {
    useItemsStore
      .getState()
      .setItems([
        makeTimelineVideoItem({ id: 'first' }),
        makeTimelineVideoItem({ id: 'second', from: 60 }),
      ])
    buildClipRefs()
    const undoDepth = useTimelineCommandStore.getState().undoStack.length

    const call = toolArgs('set_fades', {
      scope: 'all',
      direction: 'both',
      kind: 'visual',
      durationSeconds: 0.5,
    })
    await call.tool.execute(call.args)

    expect(useItemsStore.getState().items).toEqual([
      expect.objectContaining({ fadeIn: 0.5, fadeOut: 0.5 }),
      expect.objectContaining({ fadeIn: 0.5, fadeOut: 0.5 }),
    ])
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(undoDepth + 1)

    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().items.every((item) => item.fadeIn === undefined)).toBe(true)
  })

  it('maps a natural volume percentage to the timeline dB scale', async () => {
    useItemsStore
      .getState()
      .setItems([makeTimelineVideoItem({ id: 'first' }), makeTimelineVideoItem({ id: 'second' })])
    buildClipRefs()

    const call = toolArgs('set_volume', { scope: 'all', volume: 50 })
    const result = await call.tool.execute(call.args)

    expect(result.ok).toBe(true)
    expect(useItemsStore.getState().items).toEqual([
      expect.objectContaining({ volume: -6.020599913279624 }),
      expect.objectContaining({ volume: -6.020599913279624 }),
    ])
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it('creates a styled, positioned title from plain-language tool arguments', async () => {
    buildClipRefs()
    const call = toolArgs('add_title', {
      text: 'X Y and Z',
      atSeconds: 1,
      durationSeconds: 3,
      position: 'lower-third',
      fontSize: 72,
      color: '#ffcc00',
    })

    const result = await call.tool.execute(call.args)

    expect(result.ok).toBe(true)
    expect(useItemsStore.getState().items).toEqual([
      expect.objectContaining({
        type: 'text',
        text: 'X Y and Z',
        from: 30,
        durationInFrames: 90,
        fontSize: 72,
        color: '#ffcc00',
        transform: expect.objectContaining({ y: 259.2 }),
      }),
    ])
  })

  it('removes an exact middle range and restores it with one Undo', async () => {
    useItemsStore.getState().setItems([
      makeTimelineVideoItem({
        id: 'long-video',
        durationInFrames: 300,
        sourceStart: 0,
        sourceEnd: 300,
        sourceDuration: 300,
      }),
    ])
    buildClipRefs()

    const call = toolArgs('remove_range', {
      scope: 'all',
      startSeconds: 2,
      endSeconds: 4,
    })
    const result = await call.tool.execute(call.args)

    expect(result.ok).toBe(true)
    expect(
      useItemsStore
        .getState()
        .items.toSorted((a, b) => a.from - b.from)
        .map((item) => [item.from, item.durationInFrames]),
    ).toEqual([
      [0, 60],
      [60, 180],
    ])
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)

    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().items).toEqual([
      expect.objectContaining({ id: 'long-video', from: 0, durationInFrames: 300 }),
    ])
  })
})
