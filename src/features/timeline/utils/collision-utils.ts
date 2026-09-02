import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'

/**
 * Collision detection utilities for timeline drag-and-drop
 * Pure functions for overlap detection and push-forward calculations
 */

export interface CollisionRect {
  trackId: string
  from: number
  durationInFrames: number
}

const EMPTY_TRACK_ITEMS: CollisionRect[] = []

function compareCollisionRectsByFrom(a: CollisionRect, b: CollisionRect): number {
  return a.from - b.from
}

function getSortedCollisionRects(
  trackItems: ReadonlyArray<CollisionRect>,
): ReadonlyArray<CollisionRect> {
  for (let index = 1; index < trackItems.length; index += 1) {
    if (trackItems[index - 1]!.from > trackItems[index]!.from) {
      return [...trackItems].sort(compareCollisionRectsByFrom)
    }
  }
  return trackItems
}

/**
 * Check if two time ranges overlap
 *
 * @param start1 - Start of first range
 * @param end1 - End of first range
 * @param start2 - Start of second range
 * @param end2 - End of second range
 * @returns True if ranges overlap
 */
function rangesOverlap(start1: number, end1: number, start2: number, end2: number): boolean {
  // Ranges overlap if: start1 < end2 AND start2 < end1
  return start1 < end2 && start2 < end1
}

/**
 * Check if a position has enough space for an item (no collisions)
 *
 * @param position - Start position to check
 * @param durationInFrames - Duration of item to place
 * @param trackItems - Items on the track (sorted by start frame)
 * @returns True if the position has no collisions
 */
function hasAvailableSpace(
  position: number,
  durationInFrames: number,
  trackItems: ReadonlyArray<CollisionRect>,
): boolean {
  const testEnd = position + durationInFrames
  return !trackItems.some((item) => {
    const itemEnd = item.from + item.durationInFrames
    return rangesOverlap(position, testEnd, item.from, itemEnd)
  })
}

/**
 * Find available space by snapping backward (before the colliding item)
 *
 * @param proposedFrom - Desired start position
 * @param durationInFrames - Duration of item to place
 * @param trackItems - Items on the track (sorted by start frame)
 * @returns Available position snapped backward, or null if no space
 */
function findSpaceBackward(
  proposedFrom: number,
  durationInFrames: number,
  trackItems: ReadonlyArray<CollisionRect>,
): number | null {
  let testPosition = proposedFrom

  // Walk toward frame zero. Once a collision moves the candidate backward,
  // every already-visited item starts at or after its new end and cannot
  // collide again. This remains linear even for thousands of adjacent clips.
  for (let index = trackItems.length - 1; index >= 0; index -= 1) {
    const item = trackItems[index]!
    const itemEnd = item.from + item.durationInFrames
    if (!rangesOverlap(testPosition, testPosition + durationInFrames, item.from, itemEnd)) {
      continue
    }

    testPosition = item.from - durationInFrames
    if (testPosition < 0) return null
  }

  return testPosition
}

/**
 * Find available space by snapping forward (after the colliding item)
 *
 * @param proposedFrom - Desired start position
 * @param durationInFrames - Duration of item to place
 * @param trackItems - Items on the track (sorted by start frame)
 * @returns Available position snapped forward, or null if no space
 */
function findSpaceForward(
  proposedFrom: number,
  durationInFrames: number,
  trackItems: ReadonlyArray<CollisionRect>,
): number | null {
  let testPosition = proposedFrom

  // Sweep the ordered intervals once. Moving to the end of a collision means
  // earlier intervals can never affect the candidate again.
  for (const item of trackItems) {
    const itemEnd = item.from + item.durationInFrames
    if (!rangesOverlap(testPosition, testPosition + durationInFrames, item.from, itemEnd)) {
      continue
    }
    testPosition = Math.max(testPosition, itemEnd)
  }

  return testPosition
}

export function buildCollisionTrackItemsMap(
  allItems: ReadonlyArray<CollisionRect | TimelineItem>,
): Map<string, CollisionRect[]> {
  const trackItemsById = new Map<string, CollisionRect[]>()

  allItems.forEach((item) => {
    const existingTrackItems = trackItemsById.get(item.trackId)
    if (existingTrackItems) {
      existingTrackItems.push(item)
    } else {
      trackItemsById.set(item.trackId, [item])
    }
  })

  trackItemsById.forEach((trackItems) => {
    trackItems.sort(compareCollisionRectsByFrom)
  })

  return trackItemsById
}

export function findNearestAvailableSpaceInTrackItems(
  proposedFrom: number,
  durationInFrames: number,
  trackItems: ReadonlyArray<CollisionRect>,
): number | null {
  const sortedTrackItems = getSortedCollisionRects(trackItems)

  // If no collision, return proposed position
  if (hasAvailableSpace(proposedFrom, durationInFrames, sortedTrackItems)) {
    return proposedFrom
  }

  const backwardPosition = findSpaceBackward(proposedFrom, durationInFrames, sortedTrackItems)
  const forwardPosition = findSpaceForward(proposedFrom, durationInFrames, sortedTrackItems)

  if (backwardPosition === null) return forwardPosition
  if (forwardPosition === null) return backwardPosition

  const backwardDistance = Math.abs(proposedFrom - backwardPosition)
  const forwardDistance = Math.abs(forwardPosition - proposedFrom)
  return backwardDistance <= forwardDistance ? backwardPosition : forwardPosition
}

/**
 * Find the nearest available space for an item on a track
 * Snaps to the closest edge (backward or forward) based on distance,
 * checking if space is available in that direction first.
 *
 * @param proposedFrom - Desired start position
 * @param durationInFrames - Duration of item to place
 * @param trackId - Target track ID
 * @param allItems - All timeline items
 * @returns Available position (snapped to closest edge) or null if no space in either direction
 */
export function findNearestAvailableSpace(
  proposedFrom: number,
  durationInFrames: number,
  trackId: string,
  allItems: ReadonlyArray<CollisionRect | TimelineItem>,
): number | null {
  const trackItems = buildCollisionTrackItemsMap(allItems).get(trackId) ?? EMPTY_TRACK_ITEMS
  return findNearestAvailableSpaceInTrackItems(proposedFrom, durationInFrames, trackItems)
}

export interface OverlapInfo {
  itemA: string
  itemB: string
  trackId: string
  overlapFrames: number
}

/**
 * Detect non-transition overlapping items on the same track.
 * Transition-linked overlaps are intentional and excluded.
 */
export function detectOverlappingItems(
  items: ReadonlyArray<TimelineItem>,
  transitions: ReadonlyArray<Transition>,
): OverlapInfo[] {
  const transitionPairs = new Set<string>()
  for (const t of transitions) {
    transitionPairs.add(`${t.leftClipId}:${t.rightClipId}`)
    transitionPairs.add(`${t.rightClipId}:${t.leftClipId}`)
  }

  const byTrack = new Map<string, TimelineItem[]>()
  for (const item of items) {
    let group = byTrack.get(item.trackId)
    if (!group) {
      group = []
      byTrack.set(item.trackId, group)
    }
    group.push(item)
  }

  const overlaps: OverlapInfo[] = []

  for (const [trackId, trackItems] of byTrack) {
    const sorted = [...trackItems].sort((a, b) => a.from - b.from)

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i]!
      const currentEnd = current.from + current.durationInFrames

      for (let j = i + 1; j < sorted.length; j++) {
        const next = sorted[j]!
        if (next.from >= currentEnd) break

        if (transitionPairs.has(`${current.id}:${next.id}`)) continue

        overlaps.push({
          itemA: current.id,
          itemB: next.id,
          trackId,
          overlapFrames: currentEnd - next.from,
        })
      }
    }
  }

  return overlaps
}
