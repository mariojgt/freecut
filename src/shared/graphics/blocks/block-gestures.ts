import type { EasingType } from '@/types/keyframe'
import type { BlockDefinition, GestureDefinition, GestureTrack } from './types'

/**
 * Gestures derived from a block's own part list.
 *
 * A reveal has to touch every part, because opacity is NOT inherited through the
 * transform-parent chain — fading a root part leaves its children fully opaque.
 * Writing that by hand for a twenty-part block is both tedious and a place for a
 * part to be forgotten, so it is generated from the definition instead.
 *
 * These stay honest about rest state. Contributions are relative and the
 * resolver clamps opacity, so a part authored hidden (a focus ring, an error
 * banner) contributes -1 from 0 and stays at 0 — a whole-block fade-in cannot
 * accidentally reveal a state the block was not asked to be in.
 */

export interface FadeGestureOptions {
  id: string
  name: string
  /** `in` ends at the rest pose; `out` starts there. */
  direction?: 'in' | 'out'
  easing?: EasingType
  /** Restrict the fade to these parts and their descendants are left alone. */
  partIds?: readonly string[]
}

function fadeKeyframes(
  direction: 'in' | 'out',
  easing: EasingType,
  from: number,
  to: number,
): GestureTrack['keyframes'] {
  // -1 is "fully transparent relative to rest"; 0 is the part's authored opacity.
  const hidden = -1
  return direction === 'in'
    ? [
        { at: from, value: hidden, easing },
        { at: to, value: 0, easing },
      ]
    : [
        { at: from, value: 0, easing },
        { at: to, value: hidden, easing },
      ]
}

/** Fade a whole block as one, in or out. */
export function fadeGesture(
  block: BlockDefinition,
  options: FadeGestureOptions,
): GestureDefinition {
  const wanted = options.partIds?.length ? new Set(options.partIds) : null
  const easing = options.easing ?? 'ease-in-out'
  const direction = options.direction ?? 'in'
  return {
    id: options.id,
    name: options.name,
    loop: false,
    tracks: block.parts
      .filter((part) => !wanted || wanted.has(part.id))
      .map((part) => ({
        partId: part.id,
        channel: 'opacity' as const,
        keyframes: fadeKeyframes(direction, easing, 0, 1),
      })),
  }
}

export interface StaggerGestureOptions extends FadeGestureOptions {
  /**
   * Part ids in reveal order. Parts not listed are revealed after them, in
   * definition order, so adding a part to a block cannot silently drop it from
   * an existing stagger.
   */
  order?: readonly string[]
  /**
   * Fraction of the span one part's own fade occupies, 0..1. Smaller reads as a
   * crisper cascade; at 1 every part fades across the whole span and the stagger
   * disappears.
   */
  step?: number
  /** Also rise into place, in block units. 0 is a pure opacity cascade. */
  rise?: number
}

/**
 * Reveal a block one part at a time.
 *
 * The cascade is what makes a diagram feel authored rather than switched on, and
 * it is the difference between a list appearing and a list being presented. The
 * per-part windows overlap by construction so the whole reveal still reads as
 * one move rather than as a queue.
 */
export function staggerGesture(
  block: BlockDefinition,
  options: StaggerGestureOptions,
): GestureDefinition {
  const wanted = options.partIds?.length ? new Set(options.partIds) : null
  const parts = block.parts.filter((part) => !wanted || wanted.has(part.id))
  const rank = new Map((options.order ?? []).map((partId, index) => [partId, index]))
  const ordered = [...parts].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  )

  const easing = options.easing ?? 'ease-out'
  const direction = options.direction ?? 'in'
  const step = Math.min(1, Math.max(0.05, options.step ?? 0.45))
  const rise = options.rise ?? 0
  // Windows are spread across whatever the fades leave over, so the last part
  // still finishes exactly at the end of the span.
  const spread = ordered.length > 1 ? (1 - step) / (ordered.length - 1) : 0

  const tracks: GestureTrack[] = []
  for (const [index, part] of ordered.entries()) {
    const from = index * spread
    const to = from + step
    tracks.push({
      partId: part.id,
      channel: 'opacity',
      keyframes: fadeKeyframes(direction, easing, from, to),
    })
    if (rise === 0) continue
    tracks.push({
      partId: part.id,
      channel: 'y',
      keyframes:
        direction === 'in'
          ? [
              { at: from, value: rise, easing },
              { at: to, value: 0, easing },
            ]
          : [
              { at: from, value: 0, easing },
              { at: to, value: rise, easing },
            ],
    })
  }
  return { id: options.id, name: options.name, loop: false, tracks }
}
