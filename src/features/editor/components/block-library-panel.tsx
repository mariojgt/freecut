import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { createLogger } from '@/shared/logging/logger'
import { usePlaybackStore } from '@/shared/state/playback'
import { useProjectStore } from '@/features/editor/deps/projects'
import {
  useCompositionNavigationStore,
  useCompositionsStore,
  useTimelineStore,
  insertBlock,
} from '@/features/editor/deps/timeline-store'
import { getDefaultGeneratedLayerDurationInFrames } from '@/features/editor/deps/timeline-utils'
import { resolveGeneratedLayerCanvasSize } from '../utils/generated-layer-canvas-size'
import { getGesture, listBlocks } from '@/shared/graphics/blocks/registry'
import { DEEP_SPACE_PALETTE, resolvePaletteRole } from '@/shared/graphics/blocks/scene-palette'
import type { BlockDefinition } from '@/shared/graphics/blocks/types'

const logger = createLogger('BlockLibraryPanel')

/**
 * Rigged block browser.
 *
 * Thumbnails are drawn from each block's own committed path data rather than
 * shipped images, so a preview can never drift from the artwork it advertises.
 */

interface BlockThumbnailProps {
  block: BlockDefinition
  partIds?: readonly string[]
}

function BlockThumbnail({ block, partIds }: BlockThumbnailProps) {
  const parts = useMemo(() => {
    const visible = partIds?.length
      ? block.parts.filter((part) => partIds.includes(part.id))
      : block.parts
    return [...visible].sort((a, b) => a.z - b.z)
  }, [block, partIds])

  return (
    <svg
      viewBox={`0 0 ${block.width} ${block.height}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {parts.map((part) => (
        <path
          key={part.id}
          d={part.d}
          fill={part.fill ? resolvePaletteRole(DEEP_SPACE_PALETTE, part.fill) : 'none'}
          stroke={part.stroke ? resolvePaletteRole(DEEP_SPACE_PALETTE, part.stroke) : undefined}
          strokeWidth={part.stroke ? (part.strokeWidth ?? 1) : undefined}
        />
      ))}
    </svg>
  )
}

export function BlockLibraryPanel() {
  const { t } = useTranslation()
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null)
  const blocks = useMemo(() => listBlocks(), [])

  const addBlock = useCallback((block: BlockDefinition, partIds?: readonly string[]) => {
    // Read from stores directly rather than subscribing: this panel re-renders
    // on hover and does not need to track playback or composition state.
    const { fps } = useTimelineStore.getState()
    const currentProject = useProjectStore.getState().currentProject
    const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId
    const activeComposition = activeCompositionId
      ? useCompositionsStore.getState().getComposition(activeCompositionId)
      : undefined
    const { width: canvasWidth, height: canvasHeight } = resolveGeneratedLayerCanvasSize(
      activeComposition,
      currentProject?.metadata,
    )
    const durationInFrames = getDefaultGeneratedLayerDurationInFrames(fps)

    // A whole block arrives already performing; a hand-picked subset does not,
    // because its gesture may drive parts the user chose to leave out.
    const gestures = partIds?.length
      ? []
      : (block.gestures ?? [])
          .map((id) => getGesture(id))
          .filter((gesture) => gesture !== undefined)
          .filter((gesture) => gesture.loop)
          .map((gesture) => ({
            gesture,
            // One walk cycle per second reads naturally at any frame rate.
            ...(gesture.id === 'walk' && {
              cycles: Math.max(1, Math.round(durationInFrames / fps)),
            }),
          }))

    const result = insertBlock({
      block,
      palette: DEEP_SPACE_PALETTE,
      from: Math.max(0, usePlaybackStore.getState().currentFrame),
      durationInFrames,
      canvasWidth,
      canvasHeight,
      gestures,
      ...(partIds?.length ? { partIds } : {}),
    })

    if (!result) {
      logger.warn('Block produced no items', { blockId: block.id })
      return
    }
    if (result.skipped.length > 0) {
      logger.warn('Some block parts were skipped', {
        blockId: block.id,
        skipped: result.skipped,
      })
    }
  }, [])

  return (
    <div className="space-y-2">
      <div className="px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('editor.blockLibrary.title')}
      </div>

      {blocks.map((block) => {
        const expanded = expandedBlockId === block.id
        return (
          <div key={block.id} className="rounded-lg border border-border bg-secondary/20">
            <div className="flex items-stretch gap-2 p-2">
              <button
                type="button"
                onClick={() => addBlock(block)}
                title={t('editor.blockLibrary.insert', { name: block.name })}
                className="flex flex-1 items-center gap-2 rounded-md p-1 text-left transition-[transform,background-color] duration-150 hover:bg-secondary/60 active:scale-[0.98]"
              >
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-border bg-background/60">
                  <BlockThumbnail block={block} />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[11px] text-foreground">{block.name}</div>
                  <div className="truncate text-[9px] text-muted-foreground">
                    {t('editor.blockLibrary.partCount', { count: block.parts.length })}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setExpandedBlockId(expanded ? null : block.id)}
                aria-expanded={expanded}
                aria-label={t('editor.blockLibrary.showParts', { name: block.name })}
                className="flex w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    'h-3.5 w-3.5 transition-transform duration-150',
                    expanded && 'rotate-90',
                  )}
                />
              </button>
            </div>

            {expanded && (
              <div className="grid grid-cols-4 gap-1 border-t border-border p-2">
                {[...block.parts]
                  .sort((a, b) => a.z - b.z)
                  .map((part) => (
                    <button
                      key={part.id}
                      type="button"
                      onClick={() => addBlock(block, [part.id])}
                      title={t('editor.blockLibrary.insert', { name: part.label })}
                      className="flex flex-col items-center gap-0.5 rounded border border-border bg-background/40 p-1 transition-[transform,border-color] duration-150 hover:border-primary/50 active:scale-[0.98]"
                    >
                      <div className="h-7 w-7">
                        <BlockThumbnail block={block} partIds={[part.id]} />
                      </div>
                      <span className="w-full truncate text-center text-[8px] text-muted-foreground">
                        {part.label}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
