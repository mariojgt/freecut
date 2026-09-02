import type { TimelineItem, TimelineTrack } from '@/types/timeline'

export function getEmptyTrackIdsForRemoval(
  tracks: TimelineTrack[],
  itemsByTrackId: Record<string, TimelineItem[]>,
  contextTrackId: string,
): string[] {
  const editableTracks = tracks.filter((track) => !track.isGroup)
  if (editableTracks.length === 0) return []

  const emptyTrackIds = editableTracks
    .filter((track) => (itemsByTrackId[track.id]?.length ?? 0) === 0)
    .map((track) => track.id)

  const removalIds = new Set(emptyTrackIds)
  if (emptyTrackIds.length >= editableTracks.length) {
    const trackById = new Map(tracks.map((track) => [track.id, track] as const))
    const contextLane = editableTracks.find((track) => {
      if (track.id === contextTrackId) return true

      let parentTrackId = track.parentTrackId
      const visited = new Set<string>()
      while (parentTrackId && !visited.has(parentTrackId)) {
        if (parentTrackId === contextTrackId) return true
        visited.add(parentTrackId)
        parentTrackId = trackById.get(parentTrackId)?.parentTrackId
      }
      return false
    })
    const preservedTrackId = contextLane?.id ?? editableTracks.at(-1)?.id
    if (preservedTrackId) removalIds.delete(preservedTrackId)
  }

  // Groups are organizational rows, so they are removed only when removing
  // their empty descendants leaves them with no children. Resolve repeatedly
  // to support nested group hierarchies.
  let changed = true
  while (changed) {
    changed = false
    for (const group of tracks) {
      if (!group.isGroup || removalIds.has(group.id)) continue
      const hasRemainingChild = tracks.some(
        (track) => track.parentTrackId === group.id && !removalIds.has(track.id),
      )
      if (!hasRemainingChild) {
        removalIds.add(group.id)
        changed = true
      }
    }
  }

  return tracks.filter((track) => removalIds.has(track.id)).map((track) => track.id)
}
