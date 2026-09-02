import type { TimelineTrack } from '@/types/timeline'
import { getTrackKind } from './classic-tracks'
import { getTimelineDisplayTracks } from './group-utils'

export function getDefaultActiveTrackId(tracks: TimelineTrack[]): string | null {
  const displayTracks = getTimelineDisplayTracks(tracks)
  const editableTracks = displayTracks.filter((track) => !track.isGroup)
  const bottomVideoTrack = editableTracks.findLast((track) => getTrackKind(track) === 'video')
  return bottomVideoTrack?.id ?? editableTracks[0]?.id ?? displayTracks[0]?.id ?? null
}
