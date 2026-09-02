import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  ChevronDown,
  ChevronRight,
  Power,
  PowerOff,
  Lock,
  GripVertical,
  Radio,
  FoldHorizontal,
  Link2,
} from 'lucide-react'
import type { TimelineTrack } from '@/types/timeline'
import { cn } from '@/shared/ui/cn'
import { useTrackDrag } from '../hooks/use-track-drag'
import { TIMELINE_SIDEBAR_WIDTH } from '../constants'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'
import { useItemsStore } from '../stores/items-store'
import { isTrackDisabled } from '@/features/timeline/utils/classic-tracks'
import { isTrackSyncLockActive } from '../utils/track-sync-lock'

interface TrackHeaderProps {
  track: TimelineTrack
  isActive: boolean
  isSelected: boolean
  canDeleteTrack: boolean
  canDeleteEmptyTracks: boolean
  groupChildCount?: number
  onToggleLock: () => void
  onToggleSyncLock: () => void
  onToggleDisabled: () => void
  onToggleSolo: () => void
  onSelect: (e: React.MouseEvent) => void
  onCloseGaps?: () => void
  onAddVideoTrack: () => void
  onAddAudioTrack: () => void
  onDeleteTrack: () => void
  onDeleteEmptyTracks: () => void
  onToggleCollapsed?: () => void
}

/**
 * Custom equality for TrackHeader memo - ignores callback props which are recreated each render
 */
function areTrackHeaderPropsEqual(prev: TrackHeaderProps, next: TrackHeaderProps): boolean {
  return (
    prev.track === next.track &&
    prev.isActive === next.isActive &&
    prev.isSelected === next.isSelected &&
    prev.canDeleteTrack === next.canDeleteTrack &&
    prev.canDeleteEmptyTracks === next.canDeleteEmptyTracks &&
    prev.groupChildCount === next.groupChildCount
  )
  // Callbacks (onToggleLock, etc.) are ignored - they're recreated each render but functionality is same
}

function getTrackHeaderBodyClassName(options: {
  isGroup: boolean
  isSelected: boolean
  isActive: boolean
  isDisabled: boolean
}): string {
  return cn(
    'relative flex flex-col overflow-hidden px-1 transition-colors duration-150',
    options.isGroup ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
    options.isSelected
      ? 'bg-primary/10'
      : options.isDisabled
        ? 'bg-muted/30 hover:bg-muted/40'
        : 'hover:bg-secondary/50',
    options.isActive ? 'border-l-3 border-l-primary' : 'border-l-3 border-l-transparent',
    options.isDisabled && 'text-muted-foreground',
  )
}

function TrackLeadControl({
  track,
  onToggleCollapsed,
}: {
  track: TimelineTrack
  onToggleCollapsed?: () => void
}) {
  const { t } = useTranslation()
  if (!track.isGroup) {
    return <GripVertical className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
  }

  const disclosureLabel = track.isCollapsed
    ? t('editor.compose.expandGroup')
    : t('editor.compose.collapseGroup')

  return (
    <button
      type="button"
      className="flex h-5 w-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation()
        onToggleCollapsed?.()
      }}
      onMouseDown={(event) => event.stopPropagation()}
      aria-label={disclosureLabel}
      aria-expanded={!track.isCollapsed}
    >
      {track.isCollapsed ? (
        <ChevronRight className="h-3.5 w-3.5" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5" />
      )}
    </button>
  )
}

interface TrackControlButtonsProps {
  track: TimelineTrack
  isGroup: boolean
  trackDisabled: boolean
  syncLockEnabled: boolean
  onToggleDisabled: () => void
  onToggleSolo: () => void
  onToggleLock: () => void
  onToggleSyncLock: () => void
  onCloseGaps?: () => void
}

function TrackControlButtons({
  track,
  isGroup,
  trackDisabled,
  syncLockEnabled,
  onToggleDisabled,
  onToggleSolo,
  onToggleLock,
  onToggleSyncLock,
  onCloseGaps,
}: TrackControlButtonsProps) {
  const { t } = useTranslation()
  const disabledLabel = trackDisabled
    ? t('timeline.trackHeader.enableTrack')
    : t('timeline.trackHeader.disableTrack')
  const soloLabel = track.solo
    ? t('timeline.trackHeader.unsoloTrack')
    : t('timeline.trackHeader.soloTrack')
  const lockLabel = track.locked
    ? t('timeline.trackHeader.unlockTrack')
    : t('timeline.trackHeader.lockTrack')
  const syncLockLabel = syncLockEnabled
    ? t('timeline.trackHeader.disableSyncLock')
    : t('timeline.trackHeader.enableSyncLock')
  const closeGapsLabel = t('timeline.trackHeader.closeAllGaps')
  const buttonStyle = {
    width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
    height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="rounded hover:bg-secondary"
        style={buttonStyle}
        onClick={(event) => {
          event.stopPropagation()
          onToggleDisabled()
        }}
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={disabledLabel}
        data-tooltip={disabledLabel}
      >
        {trackDisabled ? (
          <PowerOff className="h-3 w-3 text-primary" />
        ) : (
          <Power className="h-3 w-3 opacity-70" />
        )}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="rounded hover:bg-secondary"
        style={buttonStyle}
        onClick={(event) => {
          event.stopPropagation()
          onToggleSolo()
        }}
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={soloLabel}
        data-tooltip={soloLabel}
      >
        <Radio className={cn('h-3 w-3', track.solo && 'text-primary')} />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="rounded hover:bg-secondary"
        style={buttonStyle}
        onClick={(event) => {
          event.stopPropagation()
          onToggleLock()
        }}
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={lockLabel}
        data-tooltip={lockLabel}
      >
        <Lock className={cn('h-3 w-3', track.locked ? 'text-primary' : 'opacity-70')} />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="rounded hover:bg-secondary"
        style={buttonStyle}
        onClick={(event) => {
          event.stopPropagation()
          onToggleSyncLock()
        }}
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={syncLockLabel}
        data-tooltip={syncLockLabel}
      >
        <Link2 className={cn('h-3 w-3', syncLockEnabled ? 'text-primary' : 'opacity-70')} />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="rounded hover:bg-secondary"
        style={buttonStyle}
        disabled={isGroup}
        onClick={(event) => {
          event.stopPropagation()
          onCloseGaps?.()
        }}
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={closeGapsLabel}
        data-tooltip={closeGapsLabel}
      >
        <FoldHorizontal className="h-3 w-3" />
      </Button>
    </>
  )
}

/**
 * Track Header Component
 *
 * Displays track name, controls, and handles selection.
 * Shows active state with background color.
 * Supports group tracks with collapse/expand and indentation.
 * Right-click context menu for track actions.
 * Memoized to prevent re-renders when props haven't changed.
 */
export const TrackHeader = memo(function TrackHeader({
  track,
  isActive,
  isSelected,
  canDeleteTrack,
  canDeleteEmptyTracks,
  groupChildCount = 0,
  onToggleLock,
  onToggleSyncLock,
  onToggleDisabled,
  onToggleSolo,
  onSelect,
  onCloseGaps,
  onAddVideoTrack,
  onAddAudioTrack,
  onDeleteTrack,
  onDeleteEmptyTracks,
  onToggleCollapsed,
}: TrackHeaderProps) {
  const { t } = useTranslation()
  const itemCount = useItemsStore((s) => s.itemsByTrackId[track.id]?.length ?? 0)
  const syncLockEnabled = isTrackSyncLockActive(track)
  const trackDisabled = isTrackDisabled(track)
  const isGroup = track.isGroup === true
  const isChild = Boolean(track.parentTrackId)

  // Use track drag hook (visuals handled centrally by timeline.tsx via DOM)
  const { handleDragStart } = useTrackDrag(track)
  const itemCountLabel = isGroup
    ? t('editor.compose.groupLayerCount', { count: groupChildCount })
    : t('timeline.trackHeader.clipCount', { count: itemCount })

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="relative overflow-hidden"
          style={{
            height: `${track.height}px`,
            contentVisibility: 'auto',
            containIntrinsicSize: `${TIMELINE_SIDEBAR_WIDTH}px ${track.height}px`,
          }}
          data-track-id={track.id}
          data-track-group={isGroup ? 'true' : undefined}
          data-track-parent-id={track.parentTrackId}
          data-track-disabled={trackDisabled ? 'true' : undefined}
        >
          <div
            className={getTrackHeaderBodyClassName({
              isGroup,
              isSelected,
              isActive,
              isDisabled: trackDisabled,
            })}
            style={{ height: `${track.height}px` }}
            onClick={onSelect}
            onMouseDown={isGroup ? undefined : handleDragStart}
          >
            <div
              className="flex h-6 shrink-0 items-center gap-0.5 overflow-hidden border-b border-border/60"
              style={{ paddingLeft: isChild ? 12 : 0 }}
            >
              <div className="flex h-5 w-4 shrink-0 items-center justify-center">
                <TrackLeadControl track={track} onToggleCollapsed={onToggleCollapsed} />
              </div>
              <TrackControlButtons
                track={track}
                isGroup={isGroup}
                trackDisabled={trackDisabled}
                syncLockEnabled={syncLockEnabled}
                onToggleDisabled={onToggleDisabled}
                onToggleSolo={onToggleSolo}
                onToggleLock={onToggleLock}
                onToggleSyncLock={onToggleSyncLock}
                onCloseGaps={onCloseGaps}
              />
            </div>

            <div className="flex min-h-0 flex-1 items-center gap-1.5 overflow-hidden px-1.5">
              <span
                className={cn(
                  'min-w-0 truncate text-xs font-semibold leading-none',
                  !isGroup && 'font-mono',
                )}
              >
                {track.name}
              </span>
              <span className="shrink-0 text-[10px] leading-none text-muted-foreground">
                {itemCountLabel}
              </span>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        <ContextMenuItem disabled={isGroup} onClick={onCloseGaps}>
          {t('timeline.trackHeader.closeAllGaps')}
        </ContextMenuItem>

        <ContextMenuSeparator />
        <ContextMenuItem onClick={onAddVideoTrack}>
          {t('timeline.trackHeader.addVideoTrack')}
        </ContextMenuItem>
        <ContextMenuItem onClick={onAddAudioTrack}>
          {t('timeline.trackHeader.addAudioTrack')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!canDeleteTrack} onClick={onDeleteTrack}>
          {t('timeline.trackHeader.deleteTrack')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!canDeleteEmptyTracks} onClick={onDeleteEmptyTracks}>
          {t('timeline.trackHeader.deleteEmptyTracks')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}, areTrackHeaderPropsEqual)
