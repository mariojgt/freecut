import type { TimelineItem, TimelineTrack } from '@/types/timeline'

/**
 * Return the rows that should be mounted by the classic timeline.
 *
 * Layer groups are real organizational rows. Their children stay in project
 * state for playback and editing, but a collapsed ancestor removes those rows
 * from the visible track stack. Missing parents are treated as top-level so a
 * partially recovered project never loses access to an orphaned lane.
 */
export function getTimelineDisplayTracks(tracks: TimelineTrack[]): TimelineTrack[] {
  const trackById = new Map(tracks.map((track) => [track.id, track] as const))

  return tracks.filter((track) => {
    let parentTrackId = track.parentTrackId
    const visited = new Set<string>([track.id])

    while (parentTrackId) {
      if (visited.has(parentTrackId)) {
        // A malformed cycle must not hide the whole stack.
        return true
      }
      visited.add(parentTrackId)

      const parent = trackById.get(parentTrackId)
      if (!parent || !parent.isGroup) {
        return true
      }
      if (parent.isCollapsed) {
        return false
      }
      parentTrackId = parent.parentTrackId
    }

    return true
  })
}

/** Collect all nested lanes owned by a layer group without trusting the input order. */
export function getTimelineDescendantTrackIds(
  tracks: TimelineTrack[],
  groupTrackId: string,
): Set<string> {
  const childIdsByParentId = new Map<string, string[]>()
  for (const track of tracks) {
    if (!track.parentTrackId) continue
    const siblings = childIdsByParentId.get(track.parentTrackId) ?? []
    siblings.push(track.id)
    childIdsByParentId.set(track.parentTrackId, siblings)
  }

  const descendants = new Set<string>()
  const pending = [...(childIdsByParentId.get(groupTrackId) ?? [])]
  while (pending.length > 0) {
    const trackId = pending.pop()!
    if (descendants.has(trackId) || trackId === groupTrackId) continue
    descendants.add(trackId)
    pending.push(...(childIdsByParentId.get(trackId) ?? []))
  }
  return descendants
}

/**
 * Build a set of track IDs whose items should contribute snap targets.
 */
export function getVisibleTrackIds(tracks: TimelineTrack[]): Set<string> {
  return new Set(
    resolveEffectiveTrackStates(tracks)
      .filter((track) => track.visible !== false)
      .map((track) => track.id),
  )
}

/**
 * Remove layer-group containers that no longer own any child tracks.
 *
 * A layer group is an organizational timeline container, not an item lane of
 * its own, so retaining an empty container only leaves an orphaned UI row.
 */
export function pruneEmptyLayerGroups(tracks: TimelineTrack[]): TimelineTrack[] {
  const trackById = new Map(tracks.map((track) => [track.id, track] as const))
  const populatedGroupIds = new Set<string>()

  for (const track of tracks) {
    if (track.isGroup) continue

    let parentTrackId = track.parentTrackId
    const visited = new Set<string>()
    while (parentTrackId && !visited.has(parentTrackId)) {
      visited.add(parentTrackId)
      const group = trackById.get(parentTrackId)
      if (!group?.isGroup) break
      populatedGroupIds.add(group.id)
      parentTrackId = group.parentTrackId
    }
  }

  const nextTracks = tracks.filter((track) => !track.isGroup || populatedGroupIds.has(track.id))
  return nextTracks.length === tracks.length ? tracks : nextTracks
}

/**
 * Remove empty child lanes after deleting Motion layers, then remove any Layer
 * Group containers that no longer have children. Empty top-level classic
 * timeline tracks remain valid and are deliberately preserved.
 */
export function pruneEmptyLayerGroupHierarchy(
  tracks: TimelineTrack[],
  items: ReadonlyArray<Pick<TimelineItem, 'trackId'>>,
): TimelineTrack[] {
  const populatedTrackIds = new Set(items.map((item) => item.trackId))
  const tracksWithPopulatedGroupChildren = tracks.filter(
    (track) => track.isGroup || !track.parentTrackId || populatedTrackIds.has(track.id),
  )

  return pruneEmptyLayerGroups(tracksWithPopulatedGroupChildren)
}

interface EffectiveTrackState {
  locked: boolean
  muted: boolean
  visible: boolean
  solo: boolean
}

function mergeEffectiveTrackState(
  state: EffectiveTrackState,
  parentGroup: TimelineTrack,
): EffectiveTrackState {
  return {
    locked: state.locked || parentGroup.locked,
    muted: state.muted || parentGroup.muted,
    visible: state.visible && parentGroup.visible !== false,
    solo: state.solo || parentGroup.solo,
  }
}

function hasSameEffectiveTrackState(track: TimelineTrack, state: EffectiveTrackState): boolean {
  return (
    state.locked === track.locked &&
    state.muted === track.muted &&
    state.visible === track.visible &&
    state.solo === track.solo
  )
}

function resolveEffectiveTrackState(
  track: TimelineTrack,
  groupsById: ReadonlyMap<string, TimelineTrack>,
): TimelineTrack {
  if (!track.parentTrackId) return track

  let state: EffectiveTrackState = {
    locked: track.locked,
    muted: track.muted,
    visible: track.visible !== false,
    solo: track.solo,
  }
  let parentTrackId: string | undefined = track.parentTrackId
  const visited = new Set<string>()

  while (parentTrackId) {
    if (visited.has(parentTrackId)) break
    visited.add(parentTrackId)

    const parentGroup = groupsById.get(parentTrackId)
    if (!parentGroup) break
    state = mergeEffectiveTrackState(state, parentGroup)
    parentTrackId = parentGroup.parentTrackId
  }

  return hasSameEffectiveTrackState(track, state) ? track : { ...track, ...state }
}

/**
 * Return active timeline lanes with inherited Layer Group state and without
 * the organizational container rows themselves.
 */
export function resolveEffectiveTrackStates(tracks: TimelineTrack[]): TimelineTrack[] {
  const groupsById = new Map(
    tracks.filter((track) => track.isGroup).map((track) => [track.id, track] as const),
  )

  return tracks
    .filter((track) => !track.isGroup)
    .map((track) => resolveEffectiveTrackState(track, groupsById))
}
