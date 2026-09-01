/**
 * Camera intent, compiled onto the items it moves.
 *
 * FreeCut has no camera object, and adding one would mean re-parenting every
 * item in a scene under it — a large change to the document for something that
 * is, mathematically, a transform applied to everything at once. So a camera move
 * is compiled directly onto the items instead.
 *
 * What makes it a camera rather than a group move is the depth plane. A real
 * dolly moves the foreground further than the background across the frame; if
 * every item moves by the same amount the result is a flat slide, which is the
 * single most common reason generated "camera work" looks like a slideshow.
 */

import type { EasingType } from '@/types/keyframe'
import type { DirectedKeyframe, DirectedTarget } from './direction'

export type CameraIntent = 'push' | 'pull' | 'pan-left' | 'pan-right' | 'rise' | 'settle'

export interface CameraTarget extends DirectedTarget {
  /**
   * Parallax plane, 0 (foreground) to 5 (far haze). Defaults to 0, so an
   * unplaced item moves fully — a wrong-but-obvious result rather than a
   * silently immobile one.
   */
  plane?: number
}

export interface CameraOptions {
  intent: CameraIntent
  from: number
  durationInFrames: number
  /**
   * Strength of the move, 1 being the authored amount. Pans are in canvas
   * pixels at plane 0; pushes are a fraction of the item's size.
   */
  amount?: number
  easing?: EasingType
  /** Hold the end pose instead of returning to rest. Default true. */
  hold?: boolean
}

/** Authored amounts at plane 0, tuned so `amount: 1` is a usable default move. */
const PAN_PIXELS = 260
const RISE_PIXELS = 190
const PUSH_FACTOR = 0.16
const SETTLE_FACTOR = 0.05

/**
 * How much of the camera move a plane receives.
 *
 * Hyperbolic rather than linear: the near-far ratio is what the eye reads as
 * depth, and a linear falloff makes plane 5 still move a third as much as the
 * foreground, which looks like a mistake rather than distance.
 */
export function parallaxFactor(plane: number): number {
  const clamped = Math.max(0, Math.min(5, plane))
  return 1 / (1 + clamped * 0.85)
}

function push(
  target: CameraTarget,
  factor: number,
  options: CameraOptions,
  easing: EasingType,
): DirectedKeyframe[] {
  const out: DirectedKeyframe[] = []
  const last = Math.round(options.from + options.durationInFrames)
  for (const property of ['width', 'height'] as const) {
    const rest = target.rest[property]
    out.push(
      { itemId: target.itemId, property, frame: options.from, value: rest, easing },
      { itemId: target.itemId, property, frame: last, value: rest * (1 + factor), easing },
    )
  }
  return out
}

function translate(
  target: CameraTarget,
  axis: 'x' | 'y',
  offset: number,
  options: CameraOptions,
  easing: EasingType,
): DirectedKeyframe[] {
  const last = Math.round(options.from + options.durationInFrames)
  return [
    {
      itemId: target.itemId,
      property: axis,
      frame: options.from,
      value: target.rest[axis],
      easing,
    },
    {
      itemId: target.itemId,
      property: axis,
      frame: last,
      value: target.rest[axis] + offset,
      easing,
    },
  ]
}

/**
 * Compile a camera move.
 *
 * Only roots are driven: geometry is inherited through the transform-parent
 * chain, so moving a rig's root carries it, and moving every part as well would
 * apply the camera twice to anything nested.
 */
export function compileCameraMove(
  targets: readonly CameraTarget[],
  options: CameraOptions,
): DirectedKeyframe[] {
  if (options.durationInFrames <= 0 || targets.length === 0) return []
  const amount = options.amount ?? 1
  const easing = options.easing ?? 'ease-in-out'
  const out: DirectedKeyframe[] = []

  for (const target of targets) {
    if (!target.isRoot) continue
    const factor = parallaxFactor(target.plane ?? 0) * amount

    switch (options.intent) {
      case 'push':
        out.push(...push(target, PUSH_FACTOR * factor, options, easing))
        break
      case 'pull':
        out.push(...push(target, -PUSH_FACTOR * factor, options, easing))
        break
      case 'pan-left':
        out.push(...translate(target, 'x', PAN_PIXELS * factor, options, easing))
        break
      case 'pan-right':
        out.push(...translate(target, 'x', -PAN_PIXELS * factor, options, easing))
        break
      case 'rise':
        // The camera rises, so the world descends through frame.
        out.push(...translate(target, 'y', RISE_PIXELS * factor, options, easing))
        break
      case 'settle':
        // A held shot that stops moving reads as a freeze; a settle keeps the
        // frame alive without going anywhere.
        out.push(...push(target, SETTLE_FACTOR * factor, options, easing))
        break
    }
  }

  return out.sort(
    (a, b) =>
      a.itemId.localeCompare(b.itemId) || a.property.localeCompare(b.property) || a.frame - b.frame,
  )
}
