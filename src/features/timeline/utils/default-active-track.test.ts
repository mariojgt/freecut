// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'

import type { TimelineTrack } from '@/types/timeline'
import { getDefaultActiveTrackId } from './default-active-track'

function makeTrack(
  id: string,
  name: string,
  kind: 'video' | 'audio',
  order: number,
): TimelineTrack {
  return {
    id,
    name,
    kind,
    height: 72,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order,
    items: [],
  }
}

describe('getDefaultActiveTrackId', () => {
  it('uses the bottom-most video track so the default video viewport stays anchored to V1', () => {
    const tracks = [
      makeTrack('v3', 'V3', 'video', 0),
      makeTrack('v2', 'V2', 'video', 1),
      makeTrack('v1', 'V1', 'video', 2),
      makeTrack('a1', 'A1', 'audio', 3),
    ]

    expect(getDefaultActiveTrackId(tracks)).toBe('v1')
  })

  it('falls back to the first track when a project has no video tracks', () => {
    const tracks = [makeTrack('a1', 'A1', 'audio', 0), makeTrack('a2', 'A2', 'audio', 1)]

    expect(getDefaultActiveTrackId(tracks)).toBe('a1')
  })

  it('returns null for an empty timeline', () => {
    expect(getDefaultActiveTrackId([])).toBeNull()
  })

  it('does not activate a child hidden inside a collapsed layer group', () => {
    const group = {
      ...makeTrack('svg-group', 'Artwork', 'video', 0),
      isGroup: true,
      isCollapsed: true,
    }
    const hiddenChild = {
      ...makeTrack('svg-child', 'Path 1', 'video', 1),
      parentTrackId: group.id,
    }
    const audio = makeTrack('a1', 'A1', 'audio', 2)

    expect(getDefaultActiveTrackId([group, hiddenChild, audio])).toBe(audio.id)
    expect(getDefaultActiveTrackId([group, hiddenChild])).toBe(group.id)
  })
})
