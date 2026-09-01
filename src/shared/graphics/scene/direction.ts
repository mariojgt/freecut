/**
 * Directed motion, compiled from intent.
 *
 * The reason this exists: an agent authoring animation at the item level has to
 * invent numbers — how far off screen is "off screen", how much overshoot reads
 * as weight, how long a beat should be. Every one of those is a craft decision
 * that belongs in committed code, and a model asked to guess them produces
 * plausible values that are subtly wrong in a different way each time.
 *
 * So the wire vocabulary is a recipe name and a direction. The numbers are here,
 * once, where they can be reviewed.
 *
 * Everything is pure: targets in, keyframes out. No stores, no project, so the
 * recipes are testable without a browser and identical for every caller.
 */

import type { EasingType } from '@/types/keyframe'

export type MotionAction = 'enter' | 'exit' | 'emphasize' | 'moveTo' | 'shake' | 'reveal'

export type MotionDirection = 'left' | 'right' | 'up' | 'down' | 'in' | 'out'

/** Item properties a recipe may drive. */
export type DirectedProperty = 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity'

export interface DirectedKeyframe {
  itemId: string
  property: DirectedProperty
  frame: number
  value: number
  easing: EasingType
}

/** Rest pose of one target, in canvas pixels. */
export interface TargetRest {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
}

export interface DirectedTarget {
  itemId: string
  rest: TargetRest
  /**
   * Whether this item carries the group's position.
   *
   * Geometry is inherited through the transform-parent chain and opacity is not,
   * so a recipe moves only the roots but fades every part. Getting this backwards
   * either tears a rig apart or leaves half of it visible.
   */
  isRoot: boolean
}

export interface DirectedActionOptions {
  action: MotionAction
  direction?: MotionDirection
  /** First frame of the beat. */
  from: number
  durationInFrames: number
  /**
   * Travel distance in canvas pixels for `enter`/`exit`. Defaults to a distance
   * derived from the target's own size, so a small prop does not fly in from the
   * same place as a full-frame backdrop.
   */
  distance?: number
  /** Destination for `moveTo`, in canvas pixels from canvas centre. */
  to?: { x?: number; y?: number }
  /**
   * Perpendicular bow on a `moveTo`, in pixels. A straight line between two
   * points reads as mechanical; real motion arcs.
   */
  arc?: number
  /** Scales the recipe's own amplitude. 1 is the authored strength. */
  intensity?: number
  easing?: EasingType
  /**
   * Fraction of the beat one item occupies in a `reveal`, 0..1. Smaller reads as
   * a crisper cascade.
   */
  step?: number
}

/** Samples along an arc. Dense enough that linear interpolation hides them. */
const ARC_SAMPLES = 10
/** How far a `reveal` lifts each item into place, in pixels. */
const REVEAL_RISE = 26

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Unit vector for a direction, in screen space where +y is down. */
function vectorFor(direction: MotionDirection): { x: number; y: number } {
  switch (direction) {
    case 'left':
      return { x: -1, y: 0 }
    case 'right':
      return { x: 1, y: 0 }
    case 'up':
      return { x: 0, y: -1 }
    case 'down':
      return { x: 0, y: 1 }
    // `in` and `out` are depth, expressed as scale rather than translation.
    case 'in':
    case 'out':
      return { x: 0, y: 0 }
  }
}

/**
 * Default travel distance.
 *
 * Derived from the target's own size so the recipe reads the same on a badge and
 * on a full-frame plate: both start just clear of their own edge.
 */
function defaultDistance(rest: TargetRest, direction: MotionDirection): number {
  const span = direction === 'left' || direction === 'right' ? rest.width : rest.height
  return Math.max(120, span * 1.15)
}

interface Curve {
  at: number
  value: number
}

/** Map a normalized curve onto the beat's frames. */
function toFrames(
  curve: readonly Curve[],
  itemId: string,
  property: DirectedProperty,
  options: DirectedActionOptions,
  easing: EasingType,
): DirectedKeyframe[] {
  return curve.map((point) => ({
    itemId,
    property,
    frame: Math.round(options.from + clampUnit(point.at) * options.durationInFrames),
    value: point.value,
    easing,
  }))
}

/** Point on a quadratic arc between two points, bowed perpendicular to the line. */
function arcPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number,
  bow: number,
): { x: number; y: number } {
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  // A zero-length move has no perpendicular, so the bow is simply dropped.
  const controlX = length === 0 ? midX : midX + (-dy / length) * bow
  const controlY = length === 0 ? midY : midY + (dx / length) * bow
  const inverse = 1 - t
  return {
    x: inverse * inverse * from.x + 2 * inverse * t * controlX + t * t * to.x,
    y: inverse * inverse * from.y + 2 * inverse * t * controlY + t * t * to.y,
  }
}

/** Opacity, which every part needs because it is not inherited. */
function enterExitOpacity(
  target: DirectedTarget,
  entering: boolean,
  options: DirectedActionOptions,
  easing: EasingType,
): DirectedKeyframe[] {
  return toFrames(
    entering
      ? [
          { at: 0, value: 0 },
          { at: 0.45, value: target.rest.opacity },
          { at: 1, value: target.rest.opacity },
        ]
      : [
          { at: 0, value: target.rest.opacity },
          { at: 0.7, value: 0 },
          { at: 1, value: 0 },
        ],
    target.itemId,
    'opacity',
    options,
    easing,
  )
}

/** Depth, which reads as scale: `in` arrives from far away, `out` recedes. */
function enterExitDepth(
  target: DirectedTarget,
  entering: boolean,
  direction: MotionDirection,
  intensity: number,
  options: DirectedActionOptions,
  easing: EasingType,
): DirectedKeyframe[] {
  const shrunk = direction === 'in' ? 0.72 : 1.28
  const factor = 1 + (shrunk - 1) * intensity
  return (['width', 'height'] as const).flatMap((property) => {
    const restSize = target.rest[property]
    return toFrames(
      entering
        ? [
            { at: 0, value: restSize * factor },
            { at: 0.78, value: restSize * (1 + 0.02 * intensity) },
            { at: 1, value: restSize },
          ]
        : [
            { at: 0, value: restSize },
            { at: 1, value: restSize * factor },
          ],
      target.itemId,
      property,
      options,
      easing,
    )
  })
}

/** Travel along the screen plane. */
function enterExitTranslate(
  target: DirectedTarget,
  entering: boolean,
  direction: MotionDirection,
  intensity: number,
  options: DirectedActionOptions,
  easing: EasingType,
): DirectedKeyframe[] {
  const vector = vectorFor(direction)
  const distance = (options.distance ?? defaultDistance(target.rest, direction)) * intensity
  return (['x', 'y'] as const).flatMap((axis) => {
    const component = vector[axis]
    if (component === 0) return []
    const offset = target.rest[axis] + component * distance
    return toFrames(
      entering
        ? [
            { at: 0, value: offset },
            // A small overshoot past rest is what reads as arrival rather than
            // as a slide that happened to stop.
            { at: 0.76, value: target.rest[axis] - component * distance * 0.04 },
            { at: 1, value: target.rest[axis] },
          ]
        : [
            { at: 0, value: target.rest[axis] },
            { at: 1, value: offset },
          ],
      target.itemId,
      axis,
      options,
      easing,
    )
  })
}

function compileEnterExit(
  targets: readonly DirectedTarget[],
  options: DirectedActionOptions,
): DirectedKeyframe[] {
  const entering = options.action === 'enter'
  const direction = options.direction ?? (entering ? 'up' : 'down')
  const intensity = options.intensity ?? 1
  const easing = options.easing ?? (entering ? 'ease-out' : 'ease-in')
  const depth = direction === 'in' || direction === 'out'

  return targets.flatMap((target) => [
    ...enterExitOpacity(target, entering, options, easing),
    // Geometry is inherited, so only the roots are moved.
    ...(target.isRoot
      ? depth
        ? enterExitDepth(target, entering, direction, intensity, options, easing)
        : enterExitTranslate(target, entering, direction, intensity, options, easing)
      : []),
  ])
}

function compileEmphasize(
  targets: readonly DirectedTarget[],
  options: DirectedActionOptions,
): DirectedKeyframe[] {
  const intensity = options.intensity ?? 1
  const easing = options.easing ?? 'ease-in-out'
  const peak = 0.11 * intensity
  const out: DirectedKeyframe[] = []
  for (const target of targets) {
    if (!target.isRoot) continue
    for (const property of ['width', 'height'] as const) {
      const rest = target.rest[property]
      out.push(
        ...toFrames(
          [
            { at: 0, value: rest },
            { at: 0.4, value: rest * (1 + peak) },
            { at: 0.72, value: rest * (1 - peak * 0.22) },
            { at: 1, value: rest },
          ],
          target.itemId,
          property,
          options,
          easing,
        ),
      )
    }
  }
  return out
}

/** Two eased lanes, which is all a straight move needs. */
function straightMove(
  target: DirectedTarget,
  to: { x: number; y: number },
  options: DirectedActionOptions,
  easing: EasingType,
): DirectedKeyframe[] {
  return (['x', 'y'] as const).flatMap((axis) =>
    target.rest[axis] === to[axis]
      ? []
      : toFrames(
          [
            { at: 0, value: target.rest[axis] },
            { at: 1, value: to[axis] },
          ],
          target.itemId,
          axis,
          options,
          easing,
        ),
  )
}

/**
 * A bowed path, sampled.
 *
 * An arc cannot be expressed as two independent eased curves — the shape lives in
 * the relationship between the axes — so it is sampled and the lanes stay linear.
 */
function arcedMove(
  target: DirectedTarget,
  to: { x: number; y: number },
  bow: number,
  options: DirectedActionOptions,
): DirectedKeyframe[] {
  const from = { x: target.rest.x, y: target.rest.y }
  const out: DirectedKeyframe[] = []
  for (let index = 0; index <= ARC_SAMPLES; index++) {
    const t = index / ARC_SAMPLES
    const point = arcPoint(from, to, t, bow)
    const frame = Math.round(options.from + t * options.durationInFrames)
    out.push(
      { itemId: target.itemId, property: 'x', frame, value: point.x, easing: 'linear' },
      { itemId: target.itemId, property: 'y', frame, value: point.y, easing: 'linear' },
    )
  }
  return out
}

function compileMoveTo(
  targets: readonly DirectedTarget[],
  options: DirectedActionOptions,
): DirectedKeyframe[] {
  const easing = options.easing ?? 'ease-in-out'
  const bow = options.arc ?? 0
  return targets
    .filter((target) => target.isRoot)
    .flatMap((target) => {
      const to = {
        x: options.to?.x ?? target.rest.x,
        y: options.to?.y ?? target.rest.y,
      }
      return bow === 0
        ? straightMove(target, to, options, easing)
        : arcedMove(target, to, bow, options)
    })
}

function compileShake(
  targets: readonly DirectedTarget[],
  options: DirectedActionOptions,
): DirectedKeyframe[] {
  const intensity = options.intensity ?? 1
  const easing = options.easing ?? 'ease-in-out'
  // Decaying amplitude: a shake that does not settle reads as a loop.
  const swings = [-1, 0.84, -0.55, 0.32, -0.12, 0]
  const amplitude = (options.distance ?? 24) * intensity
  const out: DirectedKeyframe[] = []
  for (const target of targets) {
    if (!target.isRoot) continue
    const horizontal = options.direction !== 'up' && options.direction !== 'down'
    const axis = horizontal ? 'x' : 'y'
    out.push(
      ...toFrames(
        [
          { at: 0, value: target.rest[axis] },
          ...swings.map((swing, index) => ({
            at: ((index + 1) / (swings.length + 1)) * 1,
            value: target.rest[axis] + swing * amplitude,
          })),
          { at: 1, value: target.rest[axis] },
        ],
        target.itemId,
        axis,
        options,
        easing,
      ),
    )
  }
  return out
}

/**
 * A cascade.
 *
 * The difference between a diagram appearing and a diagram being presented. The
 * per-item windows overlap so the whole thing still reads as one move rather
 * than as a queue.
 */
function compileReveal(
  targets: readonly DirectedTarget[],
  options: DirectedActionOptions,
): DirectedKeyframe[] {
  const easing = options.easing ?? 'ease-out'
  const step = Math.min(1, Math.max(0.05, options.step ?? 0.45))
  const rise = (options.distance ?? REVEAL_RISE) * (options.intensity ?? 1)
  const spread = targets.length > 1 ? (1 - step) / (targets.length - 1) : 0
  const out: DirectedKeyframe[] = []

  for (const [index, target] of targets.entries()) {
    const start = index * spread
    const end = start + step
    out.push(
      ...toFrames(
        [
          { at: start, value: 0 },
          { at: end, value: target.rest.opacity },
          { at: 1, value: target.rest.opacity },
        ],
        target.itemId,
        'opacity',
        options,
        easing,
      ),
    )
    if (!target.isRoot || rise === 0) continue
    out.push(
      ...toFrames(
        [
          { at: start, value: target.rest.y + rise },
          { at: end, value: target.rest.y },
          { at: 1, value: target.rest.y },
        ],
        target.itemId,
        'y',
        options,
        easing,
      ),
    )
  }
  return out
}

/**
 * Compile one directed action into keyframes.
 *
 * Deduplicates on (item, property, frame) with last-write-wins, because a recipe
 * whose curve points round to the same frame would otherwise emit two keyframes
 * there and leave which one applies to the resolver.
 */
export function compileDirectedAction(
  targets: readonly DirectedTarget[],
  options: DirectedActionOptions,
): DirectedKeyframe[] {
  if (options.durationInFrames <= 0 || targets.length === 0) return []

  const emitted = (() => {
    switch (options.action) {
      case 'enter':
      case 'exit':
        return compileEnterExit(targets, options)
      case 'emphasize':
        return compileEmphasize(targets, options)
      case 'moveTo':
        return compileMoveTo(targets, options)
      case 'shake':
        return compileShake(targets, options)
      case 'reveal':
        return compileReveal(targets, options)
    }
  })()

  const byKey = new Map<string, DirectedKeyframe>()
  for (const keyframe of emitted) {
    byKey.set(`${keyframe.itemId}:${keyframe.property}:${keyframe.frame}`, keyframe)
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.itemId.localeCompare(b.itemId) || a.property.localeCompare(b.property) || a.frame - b.frame,
  )
}
