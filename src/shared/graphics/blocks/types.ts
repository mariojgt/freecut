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

/**
 * Transform channels a rigged part exposes to gestures.
 *
 * `scale` is uniform; `scaleX`/`scaleY` exist because squash and stretch is
 * non-uniform by definition — a landing figure widens as it flattens, and a
 * uniform factor can only ever make it smaller.
 */
export type RigChannel = 'rotation' | 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'opacity'

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
  /**
   * Part that carries this slot. Content attached here is parented to that
   * part's item, so a prop placed in a hand travels with the arm instead of
   * sitting at a fixed canvas position while the character walks away from it.
   * Absent for slots that only mark a location in a static world.
   */
  partId?: string
}

/**
 * A part driven by another part, one beat behind it.
 *
 * This is the difference between artwork that moves and artwork that feels like
 * it has mass. A cape, an antenna or a backpack has no muscles of its own — it
 * is dragged by whatever it hangs from, arrives late and overshoots. Authoring
 * that by hand means copying the driver's curve and nudging it, which drifts the
 * moment the driver is retimed; deriving it keeps the two locked forever.
 */
export interface SecondaryLink {
  id: string
  /** Part whose motion is read. */
  driverPartId: string
  /** Part the derived motion is written to. */
  followerPartId: string
  driverChannel: RigChannel
  followerChannel: RigChannel
  /**
   * Follower units per driver unit. Carries the unit conversion too, so a link
   * from a driver's `y` (block units) to a follower's `rotation` (degrees) is
   * expressed entirely here.
   */
  gain: number
  /** How far behind the driver the follower runs. */
  lagSeconds: number
  /**
   * Spring response, 0..1. Lower is looser and overshoots more; the default
   * settles in about a third of a second without a visible second bounce.
   */
  stiffness?: number
  /** Velocity retained per frame, 0..1. Higher rings longer. */
  damping?: number
}

/**
 * One channel of a named pose, as a contribution to the part's rest pose.
 *
 * Relative rather than absolute for the same reason gestures are: a pose then
 * composes with ambient life instead of stamping over it, and reads correctly
 * wherever the block was placed.
 */
export interface PoseChannel {
  partId: string
  channel: RigChannel
  value: number
}

/**
 * A held pose.
 *
 * Poses are the acting vocabulary a generated scene selects from. Without them
 * a model asked to make a character point has to invent joint angles, which is
 * exactly the kind of authoring that produces broken limbs; with them it picks
 * a reviewed silhouette by id.
 */
export interface PoseDefinition {
  id: string
  name: string
  /** Block this pose was authored against. Applying it elsewhere is refused. */
  blockId: string
  channels: PoseChannel[]
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
  /** Pose ids authored for this block. */
  poses?: string[]
  /**
   * Physical followers, applied after gestures are baked. They read the final
   * driven curve, so they trail whatever the scene actually asked for rather
   * than one specific gesture.
   */
  secondary?: SecondaryLink[]
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
