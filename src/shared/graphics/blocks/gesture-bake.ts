import type { EasingType } from '@/types/keyframe'
import type { GestureDefinition, RigChannel } from './types'

/**
 * Normalized gesture time -> frame-based keyframes.
 *
 * Gestures are authored across 0..1 so one definition covers any clip length or
 * frame rate; baking is where a duration is finally applied. Retiming a beat is
 * therefore a re-bake, not a re-animation, which is what lets a cut follow a
 * recorded narration without the artwork being touched.
 *
 * Values stay *contributions* relative to the part's rest pose. The layer that
 * creates timeline items adds the rest value, so the same baked walk reads
 * correctly on a character standing anywhere on the canvas.
 */

export interface BakedKeyframe {
  frame: number
  value: number
  easing: EasingType
}

export interface BakedTrack {
  partId: string
  channel: RigChannel
  keyframes: BakedKeyframe[]
}

export interface BakeGestureOptions {
  /** Total frames the gesture spans. */
  durationInFrames: number
  /** Repeats packed into that duration. A walk needs one cycle per two steps. */
  cycles?: number
  /** Scales every contribution; 0 mutes the gesture without removing it. */
  intensity?: number
  /** Offset of the first frame, relative to the item's start. */
  startFrame?: number
}

/**
 * Expand a gesture into keyframes.
 *
 * Cycle boundaries are deduplicated: a looping gesture's final pose is its first
 * pose, so the shared frame would otherwise carry two keyframes and the second
 * would silently win in the dopesheet.
 */
export function bakeGesture(gesture: GestureDefinition, options: BakeGestureOptions): BakedTrack[] {
  const { durationInFrames, cycles = 1, intensity = 1, startFrame = 0 } = options
  const cycleCount = Math.max(1, Math.floor(cycles))
  if (durationInFrames <= 0) return []
  const cycleFrames = durationInFrames / cycleCount

  return gesture.tracks.map((track) => {
    const byFrame = new Map<number, BakedKeyframe>()
    for (let cycle = 0; cycle < cycleCount; cycle++) {
      for (const keyframe of track.keyframes) {
        const frame = Math.round(startFrame + (cycle + keyframe.at) * cycleFrames)
        // A later cycle's opening pose must not overwrite the previous cycle's
        // closing pose; they are the same value, and first-wins keeps the
        // easing that carries into the boundary.
        if (byFrame.has(frame)) continue
        byFrame.set(frame, {
          frame,
          value: keyframe.value * intensity,
          easing: keyframe.easing,
        })
      }
    }
    // A non-looping gesture ends on its authored final pose; a looping one
    // needs the closing frame restated so the last cycle interpolates to it.
    if (gesture.loop && track.keyframes.length > 0) {
      const closingFrame = Math.round(startFrame + durationInFrames)
      if (!byFrame.has(closingFrame)) {
        const first = track.keyframes[0]!
        byFrame.set(closingFrame, {
          frame: closingFrame,
          value: first.value * intensity,
          easing: first.easing,
        })
      }
    }
    return {
      partId: track.partId,
      channel: track.channel,
      keyframes: [...byFrame.values()].sort((a, b) => a.frame - b.frame),
    }
  })
}

/**
 * Sample an analytic curve into a normalized track.
 *
 * Gestures built from continuous functions are stored as dense samples with
 * linear interpolation rather than a few eased poses: the shape already carries
 * the timing, and per-sample easing would fight it and read as stutter.
 */
export function sampleGestureTrack(
  partId: string,
  channel: RigChannel,
  sampleCount: number,
  at: (t: number) => number,
): {
  partId: string
  channel: RigChannel
  keyframes: Array<{ at: number; value: number; easing: EasingType }>
} {
  const count = Math.max(2, Math.floor(sampleCount))
  const keyframes = Array.from({ length: count + 1 }, (_unused, index) => {
    const t = index / count
    return { at: t, value: at(t), easing: 'linear' as EasingType }
  })
  return { partId, channel, keyframes }
}
