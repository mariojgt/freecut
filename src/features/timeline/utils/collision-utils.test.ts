// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { CollisionRect } from './collision-utils'
import { findNearestAvailableSpaceInTrackItems } from './collision-utils'

function clip(from: number, durationInFrames = 10): CollisionRect {
  return { trackId: 'video-1', from, durationInFrames }
}

describe('findNearestAvailableSpaceInTrackItems', () => {
  it('finds space beyond more than one thousand contiguous clips', () => {
    const occupied = Array.from({ length: 1_500 }, (_, index) => clip(index * 10))

    expect(findNearestAvailableSpaceInTrackItems(0, 10, occupied)).toBe(15_000)
  })

  it('treats touching clip edges as available space', () => {
    expect(findNearestAvailableSpaceInTrackItems(10, 10, [clip(0)])).toBe(10)
  })

  it('walks through overlapping and nested ranges even when input is unordered', () => {
    const occupied = [clip(110, 10), clip(0, 200), clip(90, 40)]

    expect(findNearestAvailableSpaceInTrackItems(115, 10, occupied)).toBe(200)
  })

  it('selects the truly nearest free range after resolving both directions', () => {
    expect(findNearestAvailableSpaceInTrackItems(28, 2, [clip(20)])).toBe(30)
    expect(findNearestAvailableSpaceInTrackItems(22, 2, [clip(20)])).toBe(18)
  })
})
