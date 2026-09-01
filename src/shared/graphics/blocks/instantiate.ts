import type { ItemKeyframes, Keyframe, PropertyKeyframes } from '@/types/keyframe'
import { ANIMATION_CORE_VERSION } from '@/types/keyframe'
import type { ShapeItem, TimelineTrack } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import { createTransformParentBinding } from '@/shared/utils/transform-parenting'
import { parseSvgPathData, subpathBounds, subpathToMaskVertices } from '../shapes/svg-path-parse'
import type { BakedKeyframe, BakedTrack } from './gesture-bake'
import { bakeGesture } from './gesture-bake'
import { partsInHierarchyOrder } from './registry'
import type { RigLaneProperty } from './rig-channels'
import { RIG_CHANNELS, resolveRigProperty, rigChannelProperties } from './rig-channels'
import { resolvePaletteRole, type ScenePalette } from './scene-palette'
import { compileSecondaryTracks } from './secondary-motion'
import type { BlockDefinition, BlockPart, GestureDefinition } from './types'

/**
 * Lower a block onto the timeline.
 *
 * Produces plain, serializable timeline data rather than touching a store, so
 * the same code path serves the editor, the headless API and tests. The caller
 * splices the result into a project.
 *
 * Each part becomes one `shapeType: 'path'` item on its own track, collected
 * under a Layer Group. Per-part tracks are how z-order is expressed here —
 * FreeCut derives stacking from track order, not from item order within a
 * track — and it matches how After Effects and Animate treat a rigged puppet.
 */

export interface BlockPlacement {
  /** Canvas offset of the block centre, in pixels from canvas centre. */
  x?: number
  y?: number
  /** Canvas pixels per block unit. */
  scale?: number
}

export interface GestureApplication {
  gesture: GestureDefinition
  cycles?: number
  intensity?: number
  startFrame?: number
  /** Frames the gesture spans. Defaults to the clip's full duration. */
  durationInFrames?: number
}

export interface InstantiateBlockOptions {
  block: BlockDefinition
  palette: ScenePalette
  /** Timeline placement, in composition frames. */
  from: number
  durationInFrames: number
  placement?: BlockPlacement
  gestures?: GestureApplication[]
  /**
   * Track order the block's topmost part takes. Lower orders render in front,
   * so the group occupies `[baseTrackOrder, baseTrackOrder + parts]`.
   */
  baseTrackOrder?: number
  /** Namespaces generated ids so two instances of a block never collide. */
  idPrefix?: string
  /**
   * Insert only these parts, plus whatever ancestors they need to stay rigged.
   * A block doubles as a kit this way — one castle block yields a lone tower,
   * a gate, or the whole silhouette without a second definition.
   */
  partIds?: readonly string[]
  /**
   * Composition frame rate. Only secondary motion needs it — a follower's lag is
   * authored in seconds so it feels the same at any frame rate — so it defaults
   * rather than becoming required for every caller.
   */
  fps?: number
  /** Skip the block's derived follow-through. Mainly for tests and diffing. */
  disableSecondaryMotion?: boolean
}

export interface InstantiatedBlock {
  /** One Layer Group followed by one track per drawn part, front to back. */
  tracks: TimelineTrack[]
  items: ShapeItem[]
  keyframes: ItemKeyframes[]
  /** Parts that carried no drawable geometry and were skipped. */
  skipped: Array<{ partId: string; reason: string }>
}

const DEFAULT_TRACK_HEIGHT = 40

/** Rest pose of a part, in canvas pixels. */
interface PartPlacement {
  transform: ResolvedTransform
  itemId: string
}

function linearValueAt(keyframes: BakedKeyframe[], frame: number): number {
  if (keyframes.length === 0) return 0
  const first = keyframes[0]!
  if (frame <= first.frame) return first.value
  const last = keyframes[keyframes.length - 1]!
  if (frame >= last.frame) return last.value
  for (let index = 1; index < keyframes.length; index++) {
    const previous = keyframes[index - 1]!
    const current = keyframes[index]!
    if (frame <= current.frame) {
      const span = current.frame - previous.frame
      if (span <= 0) return current.value
      const t = (frame - previous.frame) / span
      return previous.value + (current.value - previous.value) * t
    }
  }
  return last.value
}

/**
 * Sum every gesture driving one part channel.
 *
 * Gestures are contributions, so a walk and an idle breath on the same torso
 * add rather than one replacing the other. Summing on the union of both frame
 * grids keeps each curve's own sampling intact.
 */
function mergeContributions(tracks: BakedTrack[]): BakedKeyframe[] {
  if (tracks.length === 0) return []
  if (tracks.length === 1) return tracks[0]!.keyframes
  const frames = [...new Set(tracks.flatMap((track) => track.keyframes.map((k) => k.frame)))].sort(
    (a, b) => a - b,
  )
  return frames.map((frame) => ({
    frame,
    value: tracks.reduce((total, track) => total + linearValueAt(track.keyframes, frame), 0),
    easing: 'linear' as const,
  }))
}

/**
 * Turn one property's summed contributions into concrete keyframes.
 *
 * Contributions are relative to the rest pose and expressed in block units, so
 * this is where the rest value is added and block units become canvas pixels.
 * A gesture is therefore independent of where its block was placed or how large
 * it was drawn.
 */
function toPropertyKeyframes(
  property: RigLaneProperty,
  contributions: BakedKeyframe[],
  rest: ResolvedTransform,
  scale: number,
  itemId: string,
): PropertyKeyframes {
  return {
    property,
    keyframes: contributions.map(
      (contribution): Keyframe => ({
        id: `${itemId}-${property}-${contribution.frame}`,
        frame: contribution.frame,
        value: resolveRigProperty(property, contribution.value, rest, scale),
        easing: contribution.easing,
      }),
    ),
  }
}

/**
 * Group a part's channel contributions by the property each one drives.
 *
 * Summing per property rather than per channel is what lets a uniform `scale`
 * gesture and a `scaleX` squash coexist on one part: both reach `width`, and the
 * two contributions add instead of the second silently replacing the first.
 */
function contributionsByProperty(
  partId: string,
  byPartChannel: Map<string, BakedTrack[]>,
): Map<RigLaneProperty, BakedTrack[]> {
  const grouped = new Map<RigLaneProperty, BakedTrack[]>()
  for (const channel of RIG_CHANNELS) {
    const tracks = byPartChannel.get(`${partId}:${channel}`)
    if (!tracks || tracks.length === 0) continue
    for (const property of rigChannelProperties(channel)) {
      const existing = grouped.get(property)
      if (existing) existing.push(...tracks)
      else grouped.set(property, [...tracks])
    }
  }
  return grouped
}

/** Geometry of one part in canvas space, or null when it draws nothing. */
function placePart(
  part: BlockPart,
  block: BlockDefinition,
  placement: Required<BlockPlacement>,
): { transform: ResolvedTransform; vertices: ShapeItem['pathVertices']; closed: boolean } | null {
  const subpaths = parseSvgPathData(part.d)
  const first = subpaths[0]
  if (!first) return null
  const bounds = subpathBounds([first])
  if (bounds.width <= 0 && bounds.height <= 0) return null

  const { scale } = placement
  const centreX = bounds.minX + bounds.width / 2
  const centreY = bounds.minY + bounds.height / 2
  const width = bounds.width * scale
  const height = bounds.height * scale

  return {
    vertices: subpathToMaskVertices(first, bounds),
    closed: first.closed,
    transform: {
      x: (centreX - block.width / 2) * scale + placement.x,
      y: (centreY - block.height / 2) * scale + placement.y,
      width,
      height,
      // A limb must rotate at its joint; a bounding-box centre would bend it
      // in the middle of the bone.
      anchorX: part.pivot ? (part.pivot[0] - bounds.minX) * scale : width / 2,
      anchorY: part.pivot ? (part.pivot[1] - bounds.minY) * scale : height / 2,
      rotation: 0,
      // A part can be authored hidden — a focus ring, an error banner, the text
      // in an empty field — so a pose can reveal it rather than only hide things.
      opacity: Math.max(0, Math.min(1, part.opacity ?? 1)),
      cornerRadius: 0,
    },
  }
}

/**
 * Narrow a block to a requested subset, keeping each survivor's parent chain.
 *
 * Dropping an ancestor would orphan its children — they would still bind to an
 * item that was never created, and the limb would detach from the rig. Pulling
 * ancestors in is what makes a partial insert stay articulated.
 */
function selectParts(
  ordered: BlockDefinition['parts'],
  partIds: readonly string[] | undefined,
): BlockDefinition['parts'] {
  if (!partIds || partIds.length === 0) return ordered
  const byId = new Map(ordered.map((part) => [part.id, part]))
  const keep = new Set<string>()
  for (const partId of partIds) {
    let cursor: string | undefined = partId
    const guard = new Set<string>()
    while (cursor && byId.has(cursor) && !guard.has(cursor)) {
      guard.add(cursor)
      keep.add(cursor)
      cursor = byId.get(cursor)?.parent
    }
  }
  return ordered.filter((part) => keep.has(part.id))
}

/** One part's timeline item, parented to its rig ancestor when it has one. */
function buildPartItem(args: {
  part: BlockPart
  geometry: NonNullable<ReturnType<typeof placePart>>
  palette: ScenePalette
  placement: Required<BlockPlacement>
  ids: { itemId: string; trackId: string }
  span: { from: number; durationInFrames: number }
  parent?: PartPlacement
}): ShapeItem {
  const { part, geometry, palette, placement, ids, span, parent } = args
  const { transform } = geometry
  return {
    id: ids.itemId,
    trackId: ids.trackId,
    type: 'shape',
    shapeType: 'path',
    from: span.from,
    durationInFrames: span.durationInFrames,
    label: part.label,
    pathVertices: geometry.vertices,
    pathClosed: geometry.closed,
    fillColor: resolvePaletteRole(palette, part.fill),
    fillEnabled: Boolean(part.fill),
    ...(part.stroke && {
      strokeColor: resolvePaletteRole(palette, part.stroke),
      strokeEnabled: true,
      strokeWidth: (part.strokeWidth ?? 1) * placement.scale,
    }),
    transform: {
      x: transform.x,
      y: transform.y,
      width: transform.width,
      height: transform.height,
      anchorX: transform.anchorX,
      anchorY: transform.anchorY,
      rotation: transform.rotation,
      opacity: transform.opacity,
      aspectRatioLocked: false,
    },
    // At rest the child sits exactly where it was authored, so local and world
    // references match and the basis is identity. Once the parent animates, the
    // binding carries the child by the parent's delta.
    ...(parent && {
      transformParent: createTransformParentBinding({
        childLocal: transform,
        childWorld: transform,
        parentItemId: parent.itemId,
        parentWorld: parent.transform,
      }),
    }),
  }
}

/** A part's animation, or null when nothing drives it. */
function buildPartKeyframes(
  partId: string,
  itemId: string,
  byPartChannel: Map<string, BakedTrack[]>,
  rest: ResolvedTransform,
  scale: number,
): ItemKeyframes | null {
  const properties: PropertyKeyframes[] = []
  for (const [property, tracks] of contributionsByProperty(partId, byPartChannel)) {
    const merged = mergeContributions(tracks)
    if (merged.length === 0) continue
    properties.push(toPropertyKeyframes(property, merged, rest, scale, itemId))
  }
  if (properties.length === 0) return null

  const separated: ItemKeyframes['separatedVectorProperties'] = []
  if (properties.some((entry) => entry.property === 'x' || entry.property === 'y')) {
    separated.push('position')
  }
  if (properties.some((entry) => entry.property === 'width' || entry.property === 'height')) {
    separated.push('scale')
  }
  return {
    itemId,
    animationVersion: ANIMATION_CORE_VERSION,
    properties,
    // Declared so the dopesheet shows these as separated component lanes; the
    // resolver reads the scalar lanes either way.
    ...(separated.length > 0 && { separatedVectorProperties: separated }),
  }
}

/**
 * Bake every gesture, then derive the block's followers from the result.
 *
 * Order matters: followers read the summed driven curve, so they trail whatever
 * the scene actually asked for rather than one gesture in isolation. They never
 * feed each other either — a follower driving a follower would make the result
 * depend on link order.
 */
function bakeContributions(
  block: BlockDefinition,
  gestures: readonly GestureApplication[],
  options: { durationInFrames: number; fps: number; secondary: boolean },
): Map<string, BakedTrack[]> {
  const byPartChannel = new Map<string, BakedTrack[]>()
  const collect = (tracks: readonly BakedTrack[]): void => {
    for (const track of tracks) {
      const key = `${track.partId}:${track.channel}`
      const existing = byPartChannel.get(key)
      if (existing) existing.push(track)
      else byPartChannel.set(key, [track])
    }
  }

  const driven: BakedTrack[] = []
  for (const application of gestures) {
    const baked = bakeGesture(application.gesture, {
      durationInFrames: application.durationInFrames ?? options.durationInFrames,
      cycles: application.cycles,
      intensity: application.intensity,
      startFrame: application.startFrame,
    })
    driven.push(...baked)
    collect(baked)
  }

  if (options.secondary && block.secondary?.length) {
    collect(
      compileSecondaryTracks(block.secondary, driven, {
        durationInFrames: options.durationInFrames,
        fps: options.fps,
      }),
    )
  }
  return byPartChannel
}

export function instantiateBlock(options: InstantiateBlockOptions): InstantiatedBlock {
  const {
    block,
    palette,
    from,
    durationInFrames,
    gestures = [],
    baseTrackOrder = 0,
    idPrefix = block.id,
  } = options
  const placement: Required<BlockPlacement> = {
    x: options.placement?.x ?? 0,
    y: options.placement?.y ?? 0,
    scale: options.placement?.scale ?? 1,
  }

  const skipped: InstantiatedBlock['skipped'] = []
  const items: ShapeItem[] = []
  const tracks: TimelineTrack[] = []
  const keyframes: ItemKeyframes[] = []
  const placed = new Map<string, PartPlacement>()

  const contributionsByPart = bakeContributions(block, gestures, {
    durationInFrames,
    fps: options.fps ?? 30,
    secondary: !options.disableSecondaryMotion,
  })

  const groupTrackId = `${idPrefix}-group`
  // Parents must exist before their children can bind to them, and a part that
  // draws on top needs the lower track order.
  const ordered = selectParts(partsInHierarchyOrder(block), options.partIds)
  const drawOrder = [...ordered].sort((a, b) => b.z - a.z)
  const trackOrderByPart = new Map(
    drawOrder.map((part, index) => [part.id, baseTrackOrder + 1 + index]),
  )

  for (const part of ordered) {
    const geometry = placePart(part, block, placement)
    if (!geometry) {
      skipped.push({ partId: part.id, reason: 'Part has no drawable geometry.' })
      continue
    }

    const itemId = `${idPrefix}-${part.id}`
    const trackId = `${idPrefix}-track-${part.id}`
    const { transform } = geometry
    const parent = part.parent ? placed.get(part.parent) : undefined

    const item = buildPartItem({
      part,
      geometry,
      palette,
      placement,
      ids: { itemId, trackId },
      span: { from, durationInFrames },
      ...(parent && { parent }),
    })

    items.push(item)
    placed.set(part.id, { itemId, transform })

    tracks.push(
      buildPartTrack({
        part,
        trackId,
        groupTrackId,
        order: trackOrderByPart.get(part.id) ?? baseTrackOrder + 1,
      }),
    )

    const animation = buildPartKeyframes(
      part.id,
      itemId,
      contributionsByPart,
      transform,
      placement.scale,
    )
    if (animation) keyframes.push(animation)
  }

  tracks.unshift({
    id: groupTrackId,
    name: block.name,
    kind: 'video',
    height: DEFAULT_TRACK_HEIGHT,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: baseTrackOrder,
    items: [],
    isGroup: true,
    isCollapsed: true,
  })

  attachItemsToTracks(tracks, items)
  return { tracks, items, keyframes, skipped }
}

/**
 * Put each item on its own track.
 *
 * Keeps the returned tracks directly usable as a timeline fragment, so a caller
 * can splice the result in without re-deriving which item belongs where.
 */
function attachItemsToTracks(tracks: TimelineTrack[], items: readonly ShapeItem[]): void {
  const itemsByTrack = new Map(items.map((item) => [item.trackId, item]))
  for (const track of tracks) {
    const item = itemsByTrack.get(track.id)
    if (item) track.items = [item]
  }
}

/** One part's own track. Per-part tracks are how z-order is expressed here. */
function buildPartTrack(args: {
  part: BlockPart
  trackId: string
  groupTrackId: string
  order: number
}): TimelineTrack {
  return {
    id: args.trackId,
    name: args.part.label,
    kind: 'video',
    height: DEFAULT_TRACK_HEIGHT,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: args.order,
    items: [],
    parentTrackId: args.groupTrackId,
  }
}
