import type { RigChannel } from './types'

/**
 * How a rig channel reaches the timeline.
 *
 * This mapping is needed twice — once when a block is first lowered onto the
 * timeline, and again when a gesture is baked onto an instance that already
 * exists — so it lives here rather than in either caller. Keeping two copies is
 * what previously let the `scale` channel resolve correctly on insert and
 * silently do nothing on `applyGesture`.
 */

/** Item transform properties a rig channel can drive. */
export type RigLaneProperty = 'rotation' | 'x' | 'y' | 'opacity' | 'width' | 'height'

/** Rest pose a contribution is measured against, in canvas pixels and degrees. */
export interface RigRest {
  rotation: number
  x: number
  y: number
  opacity: number
  width: number
  height: number
}

/**
 * Every channel, in the order contributions are collected.
 *
 * Fixed rather than derived so the emitted keyframe order is stable across runs
 * and two renders of the same project stay byte-comparable.
 */
export const RIG_CHANNELS: readonly RigChannel[] = [
  'rotation',
  'x',
  'y',
  'opacity',
  'scale',
  'scaleX',
  'scaleY',
]

/**
 * Properties one channel feeds.
 *
 * `scale` and `scaleX` both reach `width`, which is why contributions are summed
 * per *property* and not per channel: a uniform squash and a horizontal-only
 * stretch on the same part must add, not overwrite each other.
 */
export function rigChannelProperties(channel: RigChannel): readonly RigLaneProperty[] {
  switch (channel) {
    case 'rotation':
      return ['rotation']
    case 'x':
      return ['x']
    case 'y':
      return ['y']
    case 'opacity':
      return ['opacity']
    case 'scale':
      return ['width', 'height']
    case 'scaleX':
      return ['width']
    case 'scaleY':
      return ['height']
    default:
      return []
  }
}

/**
 * Turn a summed contribution into the concrete property value.
 *
 * Contributions are relative to the rest pose and authored in block units, so
 * this is where the rest value is added and block units become canvas pixels —
 * the reason one gesture reads correctly at any placement or scale of a block.
 */
export function resolveRigProperty(
  property: RigLaneProperty,
  contribution: number,
  rest: RigRest,
  scale: number,
): number {
  switch (property) {
    case 'rotation':
      return rest.rotation + contribution
    case 'x':
      return rest.x + contribution * scale
    case 'y':
      return rest.y + contribution * scale
    case 'opacity':
      return Math.max(0, Math.min(1, rest.opacity + contribution))
    // A size contribution is a factor around 0, so a muted gesture leaves the
    // part at its authored size and two scale gestures add rather than fight.
    case 'width':
      return rest.width * (1 + contribution)
    case 'height':
      return rest.height * (1 + contribution)
  }
}
