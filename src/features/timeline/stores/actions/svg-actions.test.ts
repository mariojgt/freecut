import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useItemsStore } from '../items-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { importSvgLayers } from './svg-actions'

const SOURCE = `
<svg viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg">
  <rect id="sky" width="100" height="50" fill="#123456" />
  <circle id="sun" cx="75" cy="15" r="8" fill="#ffcc00" />
</svg>`

describe('importSvgLayers', () => {
  beforeEach(() => {
    useItemsStore.getState().setItems([])
    useItemsStore.getState().setTracks([])
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
  })

  it('commits a grouped editable import as one undoable command', () => {
    const result = importSvgLayers({
      source: SOURCE,
      name: 'Solar system.svg',
      idPrefix: 'solar',
      from: 15,
      durationInFrames: 90,
      canvasWidth: 1000,
      canvasHeight: 500,
    })

    expect(result.itemIds).toEqual(['solar-1-0', 'solar-0-0'])
    expect(result.groupTrackId).toBe('solar-group')
    expect(useItemsStore.getState().items).toHaveLength(2)
    expect(useItemsStore.getState().tracks).toHaveLength(3)
    expect(useItemsStore.getState().tracks[0]).toMatchObject({
      id: 'solar-group',
      name: 'Solar system',
      order: -3,
      isGroup: true,
      isCollapsed: true,
    })
    expect(useItemsStore.getState().tracks.map((track) => track.order)).toEqual([-3, -2, -1])
    expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)

    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().items).toEqual([])
    expect(useItemsStore.getState().tracks).toEqual([])

    useTimelineCommandStore.getState().redo()
    expect(useItemsStore.getState().items).toHaveLength(2)
    expect(useItemsStore.getState().tracks).toHaveLength(3)
  })

  it('does not mutate the timeline when the SVG is invalid or empty', () => {
    expect(() =>
      importSvgLayers({
        source: '<not-svg>',
        name: 'Broken.svg',
        idPrefix: 'broken',
        from: 0,
        durationInFrames: 30,
        canvasWidth: 100,
        canvasHeight: 100,
      }),
    ).toThrow('valid SVG')

    expect(() =>
      importSvgLayers({
        source: '<svg viewBox="0 0 10 10"><text>Hello</text></svg>',
        name: 'Empty.svg',
        idPrefix: 'empty',
        from: 0,
        durationInFrames: 30,
        canvasWidth: 100,
        canvasHeight: 100,
      }),
    ).toThrow('no supported editable vector paths')

    expect(useItemsStore.getState().items).toEqual([])
    expect(useItemsStore.getState().tracks).toEqual([])
    expect(useTimelineCommandStore.getState().undoStack).toEqual([])
  })
})
