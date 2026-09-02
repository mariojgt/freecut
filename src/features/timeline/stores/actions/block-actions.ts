import type { BlockDefinition, GestureDefinition } from '@/shared/graphics/blocks/types'
import type { ScenePalette } from '@/shared/graphics/blocks/scene-palette'
import { instantiateBlock } from '@/shared/graphics/blocks/instantiate'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { execute } from './shared'

/**
 * Insert a rigged illustration block onto the timeline.
 *
 * The whole insert is one undo step. A block is twenty-odd parented items
 * across their own tracks, so committing them piecemeal would leave the user
 * pressing undo twenty times to take back a single click — and could strand a
 * child whose parent had already been undone.
 */

export interface InsertBlockParams {
  block: BlockDefinition
  palette: ScenePalette
  from: number
  durationInFrames: number
  canvasWidth: number
  canvasHeight: number
  /** Composition rate. Secondary motion times its lag in seconds against it. */
  fps?: number
  gestures?: Array<{ gesture: GestureDefinition; cycles?: number; intensity?: number }>
  /** Insert a subset; ancestors are pulled in so the rig stays articulated. */
  partIds?: readonly string[]
}

export interface InsertBlockResult {
  idPrefix: string
  itemIds: string[]
  trackIds: string[]
  skipped: Array<{ partId: string; reason: string }>
}

/** Fit a block's authored viewport inside the canvas with a little air. */
function fitScale(block: BlockDefinition, canvasWidth: number, canvasHeight: number): number {
  if (block.width <= 0 || block.height <= 0) return 1
  const fit = Math.min(canvasWidth / block.width, canvasHeight / block.height)
  // A world block is drawn to fill frame; a character should not tower over it.
  return block.category === 'world' ? fit : fit * 0.72
}

export function insertBlock(params: InsertBlockParams): InsertBlockResult | null {
  const { block, palette, from, durationInFrames, canvasWidth, canvasHeight } = params

  const result = instantiateBlock({
    block,
    palette,
    from,
    durationInFrames,
    placement: { x: 0, y: 0, scale: fitScale(block, canvasWidth, canvasHeight) },
    ...(params.fps !== undefined && { fps: params.fps }),
    ...(params.gestures && { gestures: params.gestures }),
    ...(params.partIds && { partIds: params.partIds }),
    // Blocks claim the orders above existing content, so a newly inserted
    // character lands in front of whatever is already on the timeline.
    baseTrackOrder: nextTopOrder(block.parts.length),
    idPrefix: `${block.id}-${crypto.randomUUID().slice(0, 8)}`,
  })

  if (result.items.length === 0) return null

  return execute(
    'INSERT_BLOCK',
    () => {
      const itemsState = useItemsStore.getState()
      itemsState.setTracks([
        ...itemsState.tracks,
        ...result.tracks.map((track) => ({ ...track, items: [] })),
      ])
      // The `addItem` action's overlap placement is deliberately skipped: every
      // part lands on a track created for it in this same commit, so there is
      // nothing to collide with, and nudging one part would break the rig.
      for (const item of result.items) itemsState._addItem(item)

      const keyframesState = useKeyframesStore.getState()
      keyframesState._addKeyframes(
        result.keyframes.flatMap((lane) =>
          lane.properties.flatMap((entry) =>
            entry.keyframes.map((keyframe) => ({
              itemId: lane.itemId,
              property: entry.property,
              frame: keyframe.frame,
              value: keyframe.value,
              easing: keyframe.easing,
            })),
          ),
        ),
      )
      useTimelineSettingsStore.getState().markDirty()

      return {
        idPrefix: result.items[0]!.id,
        itemIds: result.items.map((item) => item.id),
        trackIds: result.tracks.map((track) => track.id),
        skipped: result.skipped,
      }
    },
    { blockId: block.id, parts: result.items.length },
  )
}

function nextTopOrder(partCount: number): number {
  const orders = useItemsStore.getState().tracks.map((track) => track.order)
  return Math.min(0, ...orders) - partCount - 1
}

// SVG artwork and reusable blocks share the editor's grouped-vector insertion
// seam, keeping one cross-feature action boundary for both authoring paths.
export { importSvgLayers } from './svg-actions'
