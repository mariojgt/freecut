// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { getEmptyTrackIdsForRemoval } from './track-removal'

function makeTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'track-1',
    name: 'Track 1',
    height: 64,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order: 0,
    items: [],
    ...overrides,
  }
}

function makeItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'item-1',
    type: 'audio',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: 'Audio clip',
    src: 'audio.mp3',
    ...overrides,
  } as TimelineItem
}

describe('getEmptyTrackIdsForRemoval', () => {
  it('keeps tracks that have items in itemsByTrackId', () => {
    const tracks = [
      makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
      makeTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 2 }),
    ]

    const itemsByTrackId = {
      a1: [makeItem({ id: 'audio-1', trackId: 'a1' })],
    }

    expect(getEmptyTrackIdsForRemoval(tracks, itemsByTrackId, 'v1')).toEqual(['v1', 'a2'])
  })

  it('preserves the context track when every track is empty', () => {
    const tracks = [
      makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
    ]

    expect(getEmptyTrackIdsForRemoval(tracks, {}, 'a1')).toEqual(['v1'])
  })

  it('does not treat a populated layer-group container as an empty lane', () => {
    const tracks = [
      makeTrack({ id: 'group', name: 'Artwork', isGroup: true, order: 0 }),
      makeTrack({ id: 'shape', name: 'Shape', parentTrackId: 'group', order: 1 }),
      makeTrack({ id: 'empty', name: 'V1', order: 2 }),
    ]
    const itemsByTrackId = {
      shape: [makeItem({ id: 'shape-item', trackId: 'shape' })],
    }

    expect(getEmptyTrackIdsForRemoval(tracks, itemsByTrackId, 'group')).toEqual(['empty'])
  })

  it('removes a group only when all of its empty descendant lanes are removed', () => {
    const tracks = [
      makeTrack({ id: 'group', name: 'Artwork', isGroup: true, order: 0 }),
      makeTrack({ id: 'shape', name: 'Shape', parentTrackId: 'group', order: 1 }),
      makeTrack({ id: 'populated', name: 'V1', order: 2 }),
    ]
    const itemsByTrackId = {
      populated: [makeItem({ id: 'clip', trackId: 'populated' })],
    }

    expect(getEmptyTrackIdsForRemoval(tracks, itemsByTrackId, 'populated')).toEqual([
      'group',
      'shape',
    ])
  })

  it('preserves a child lane when an empty group is the deletion context', () => {
    const tracks = [
      makeTrack({ id: 'group', name: 'Artwork', isGroup: true, order: 0 }),
      makeTrack({ id: 'shape', name: 'Shape', parentTrackId: 'group', order: 1 }),
      makeTrack({ id: 'empty', name: 'V1', order: 2 }),
    ]

    expect(getEmptyTrackIdsForRemoval(tracks, {}, 'group')).toEqual(['empty'])
  })
})
