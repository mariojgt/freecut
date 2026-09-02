import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { ShapeItem, TimelineTrack } from '@/types/timeline'
import {
  useItemsStore,
  useKeyframesStore,
  useTimelineCommandStore,
  useTimelineSettingsStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import { DEFAULT_MOTION_GENERATOR_SETTINGS, MOTION_PRESETS } from '@/features/editor/deps/keyframes'
import { applyBuiltInMotion } from './apply-built-in-motion'

function track(id: string, order: number): TimelineTrack {
  return {
    id,
    name: id,
    kind: 'video',
    height: 40,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order,
    items: [],
  }
}

function shape(id: string, trackId: string): ShapeItem {
  return {
    id,
    trackId,
    type: 'shape',
    shapeType: 'rectangle',
    from: 0,
    durationInFrames: 90,
    label: id,
    fillColor: '#ffffff',
    transform: { x: 0, y: 0, width: 100, height: 100, opacity: 1 },
  }
}

function preset(id: string) {
  const found = MOTION_PRESETS.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`Missing preset ${id}`)
  return found
}

describe('applyBuiltInMotion', () => {
  beforeEach(() => {
    useItemsStore.getState().setTracks([track('front', 0), track('back', 1)])
    useItemsStore.getState().setItems([shape('a', 'front'), shape('b', 'back')])
    useKeyframesStore.getState().setKeyframes([])
    useTimelineStore.setState({ transitions: [] })
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useTimelineCommandStore.getState().clearHistory()
  })

  it('creates editable, staggered keyframes for an ordered layer selection', () => {
    const items = useItemsStore.getState().items
    const result = applyBuiltInMotion({
      preset: preset('slide-in-up'),
      items,
      canvas: { width: 1920, height: 1080, fps: 30 },
      settings: { ...DEFAULT_MOTION_GENERATOR_SETTINGS, staggerFrames: 5 },
      mode: 'replace',
      presetName: 'Slide in up',
    })

    expect(result).toMatchObject({ applied: true, layers: 0 })
    const lanes = useKeyframesStore.getState().keyframesByItemId
    expect(lanes.a?.properties.find((lane) => lane.property === 'y')?.keyframes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ frame: 0 }),
        expect.objectContaining({ frame: 15 }),
      ]),
    )
    expect(lanes.b?.properties.find((lane) => lane.property === 'y')?.keyframes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ frame: 5 }),
        expect.objectContaining({ frame: 20 }),
      ]),
    )
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it('can author a removable non-destructive animation layer', () => {
    const result = applyBuiltInMotion({
      preset: preset('pulse'),
      items: useItemsStore.getState().items,
      canvas: { width: 1920, height: 1080, fps: 30 },
      settings: DEFAULT_MOTION_GENERATOR_SETTINGS,
      mode: 'layer',
      presetName: 'Pulse',
    })

    expect(result).toEqual({ applied: true, keyframes: 0, layers: 2 })
    expect(useItemsStore.getState().items.every((item) => item.motionLayers?.length === 1)).toBe(
      true,
    )
    expect(useKeyframesStore.getState().keyframes).toEqual([])

    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().items.every((item) => !item.motionLayers?.length)).toBe(true)
  })
})
