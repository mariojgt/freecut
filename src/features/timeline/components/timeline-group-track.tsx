import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import type { TimelineTrack } from '@/types/timeline'
import { cn } from '@/shared/ui/cn'
import { useItemsStore } from '../stores/items-store'
import { isTrackDisabled } from '../utils/classic-tracks'
import { getTimelineDescendantTrackIds } from '../utils/group-utils'

interface TimelineGroupTrackProps {
  track: TimelineTrack
}

function getFramePositionStyle(frame: number): string {
  return `calc(${frame} * var(--timeline-percent-per-frame, 0%))`
}

/**
 * Lightweight aggregate lane for an organizational layer group.
 *
 * It deliberately has no media drop target and no clip roots: the real child
 * lanes retain ownership of editing/playback while a collapsed SVG can display
 * one useful duration summary instead of hundreds of mounted rows.
 */
export const TimelineGroupTrack = memo(function TimelineGroupTrack({
  track,
}: TimelineGroupTrackProps) {
  const { t } = useTranslation()
  const summary = useItemsStore(
    useShallow((state) => {
      const descendantTrackIds = getTimelineDescendantTrackIds(state.tracks, track.id)
      const trackById = new Map(state.tracks.map((candidate) => [candidate.id, candidate] as const))
      let itemCount = 0
      let layerCount = 0
      let startFrame = Infinity
      let endFrame = -Infinity

      for (const descendantTrackId of descendantTrackIds) {
        const descendantTrack = trackById.get(descendantTrackId)
        if (descendantTrack && !descendantTrack.isGroup) layerCount += 1

        for (const item of state.itemsByTrackId[descendantTrackId] ?? []) {
          itemCount += 1
          startFrame = Math.min(startFrame, item.from)
          endFrame = Math.max(endFrame, item.from + item.durationInFrames)
        }
      }

      return {
        itemCount,
        layerCount,
        startFrame: Number.isFinite(startFrame) ? startFrame : 0,
        endFrame: Number.isFinite(endFrame) ? endFrame : 0,
      }
    }),
  )
  const disabled = isTrackDisabled(track)
  const rangeLabel = `${t('editor.compose.groupLayerCount', {
    count: summary.layerCount,
  })} · ${t('timeline.trackHeader.clipCount', { count: summary.itemCount })}`

  return (
    <div
      data-track-id={track.id}
      data-timeline-group-track="true"
      className={cn('relative bg-group-stripes', disabled && 'opacity-45')}
      style={{
        height: `${track.height}px`,
        contain: 'layout style paint',
        contentVisibility: 'auto',
        containIntrinsicSize: `auto ${track.height}px`,
      }}
      aria-label={`${track.name}, ${rangeLabel}`}
    >
      {summary.itemCount > 0 ? (
        <div
          data-timeline-group-span="true"
          data-from-frame={summary.startFrame}
          data-to-frame={summary.endFrame}
          className="pointer-events-none absolute inset-y-2 overflow-hidden rounded-sm border border-timeline-shape/60 bg-timeline-shape/20 px-2 text-[10px] font-semibold text-foreground/80 shadow-sm"
          style={{
            left: getFramePositionStyle(summary.startFrame),
            width: getFramePositionStyle(Math.max(1, summary.endFrame - summary.startFrame)),
          }}
          title={`${track.name} · ${rangeLabel}`}
        >
          <span className="block truncate leading-[22px]">{track.name}</span>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 flex items-center px-2 text-[10px] text-muted-foreground">
          {rangeLabel}
        </div>
      )}
    </div>
  )
})
