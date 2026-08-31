import type { EasingType } from '@/types/keyframe'

/**
 * Committed illustration blocks and their motion rigs.
 *
 * The contract that makes generated animation safe: a model picks a block by id
 * and fills typed props, it never authors a path, a coordinate or a colour.
 * Everything visible in a frame was drawn here and reviewed, so the quality
 * floor is set by the artwork rather than by model variance.
 *
 * A block lowers into ordinary FreeCut items — one `shapeType: 'path'` shape per
 * part, wired into a `transformParent` chain — so rigged artwork inherits the
 * dopesheet, trim paths, effects and export with no renderer work.
 */

/**
 * Semantic paint slot.
 *
 * Parts name a role rather than a colour so one scene palette recolours an
 * entire cast coherently, and so a project's own look can be applied to stock
 * blocks without editing their geometry.
 */
export type PaletteRole =
  | 'ink'
  | 'inkMuted'
  | 'surface'
  | 'surfaceDeep'
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'highlight'
  | 'glow'
  | 'shadow'

/** Transform channels a rigged part exposes to gestures. */
export type RigChannel = 'rotation' | 'x' | 'y' | 'scale' | 'opacity'

export interface BlockPart {
  /** Stable within the block; gestures target parts by this id. */
  id: string
  label: string
  /** Path data in block-local units, absolute within the block viewport. */
  d: string
  /** Parent part id. Absent means the part hangs off the block root. */
  parent?: string
  fill?: PaletteRole
  stroke?: PaletteRole
  strokeWidth?: number
  /** Painter's order within the block; lower draws first. */
  z: number
  /**
   * Rotation pivot in block-local units. Defaults to the part's bounding-box
   * centre, which is wrong for a limb — a thigh must swing from the hip, so
   * rigged parts state their joint explicitly.
   */
  pivot?: [number, number]
  /**
   * Depth plane for parallax, 0 (foreground) to 5 (far haze). Camera moves
   * scale by plane, which is what separates a real dolly from a flat slide.
   */
  depth?: number
}

/** A named anchor other content can be placed at or aimed toward. */
export interface BlockSlot {
  id: string
  label: string
  at: [number, number]
}

export interface BlockDefinition {
  id: string
  name: string
  category: 'character' | 'world' | 'prop'
  /** Authoring viewport; part coordinates are absolute inside it. */
  width: number
  height: number
  parts: BlockPart[]
  slots?: BlockSlot[]
  /** Gesture ids this block's rig can perform. */
  gestures?: string[]
}

/**
 * One keyframe in normalized gesture time.
 *
 * `at` runs 0..1 across the gesture rather than in frames, so the same gesture
 * retimes to any clip length or frame rate without being re-authored — the
 * property that lets narration drive the cut.
 */
export interface GestureKeyframe {
  at: number
  value: number
  easing: EasingType
}

export interface GestureTrack {
  partId: string
  channel: RigChannel
  /**
   * Contribution relative to the part's rest pose, in block-local units or
   * degrees. Gestures never carry absolute positions, so one gesture reads
   * correctly on any placement of the block.
   */
  keyframes: GestureKeyframe[]
}

export interface GestureDefinition {
  id: string
  name: string
  /** Whether the gesture is built to repeat seamlessly (first pose == last). */
  loop: boolean
  tracks: GestureTrack[]
}
