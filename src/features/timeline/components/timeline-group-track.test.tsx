import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'

import type { ImageItem, TimelineTrack } from '@/types/timeline'

import { useItemsStore } from '../stores/items-store'
import { TimelineGroupTrack } from './timeline-group-track'

function makeTrack(overrides: Partial<TimelineTrack>): TimelineTrack {
  return {
    id: 'track-1',
    name: 'Track 1',
    kind: 'video',
    height: 72,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items: [],
    ...overrides,
  }
}

function makeImage(id: string, trackId: string, from: number, durationInFrames: number): ImageItem {
  return {
    id,
    type: 'image',
    trackId,
    from,
    durationInFrames,
    label: id,
    src: `blob:${id}`,
  }
}

describe('TimelineGroupTrack', () => {
  beforeEach(() => {
    useItemsStore.getState().setItems([])
    useItemsStore.getState().setTracks([])
  })

  it('summarizes all descendant layers without mounting a media drop lane', () => {
    const group = makeTrack({
      id: 'svg-group',
      name: 'Artwork',
      isGroup: true,
      isCollapsed: true,
    })
    const childA = makeTrack({ id: 'path-a', parentTrackId: group.id, order: 1 })
    const childB = makeTrack({ id: 'path-b', parentTrackId: group.id, order: 2 })

    useItemsStore.getState().setTracks([group, childA, childB])
    useItemsStore
      .getState()
      .setItems([makeImage('shape-a', childA.id, 30, 20), makeImage('shape-b', childB.id, 10, 10)])

    const { container } = render(<TimelineGroupTrack track={group} />)

    expect(screen.getByLabelText('Artwork, 2 layers · 2 clips')).toBeInTheDocument()
    expect(container.querySelector('[data-timeline-group-span]')).toHaveAttribute(
      'data-from-frame',
      '10',
    )
    expect(container.querySelector('[data-timeline-group-span]')).toHaveAttribute(
      'data-to-frame',
      '50',
    )
    expect(container.querySelector('[data-timeline-drop-target]')).toBeNull()
  })
})
