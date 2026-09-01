import type { EasingType } from '@/types/keyframe'
import type { BakedKeyframe, BakedTrack } from './gesture-bake'
import type { SecondaryLink } from './types'

/**
 * Derive follow-through from already-baked motion.
 *
 * Runs after gestures rather than alongside them, on the summed result, so a
 * follower trails whatever the scene actually asked for — a walk, a walk plus a
 * breath, or a one-shot landing — instead of being authored against one of them
 * and drifting when a second is layered on.
 *
 * The integrator is a plain discrete spring stepped once per frame. It is
 * deterministic and frame-locked on purpose: the same project must resolve to
 * the same curve on every machine for renders to stay comparable.
 */

const DEFAULT_STIFFNESS = 0.34
const DEFAULT_DAMPING = 0.62
/** Below this a curve is numerically flat, not merely small. */
const EPSILON = 1e-6

export interface CompileSecondaryOptions {
  /** Frames the driven range spans. */
  durationInFrames: number
  /** Needed to turn a link's lag in seconds into whole frames. */
  fps: number
  /** First frame of the driven range. Frames before it read as rest. */
  startFrame?: number
}

/** Value of a sparse contribution curve at a frame, linearly interpolated. */
function valueAt(keyframes: readonly BakedKeyframe[], frame: number): number {
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
      return previous.value + (current.value - previous.value) * ((frame - previous.frame) / span)
    }
  }
  return last.value
}

/**
 * Drop samples a straight line already covers.
 *
 * A spring is simulated per frame, but writing a keyframe per frame would bury
 * the part's dopesheet row under a hundred points nobody can edit. Ramer–Douglas–
 * Peucker keeps the extremes — which is where the overshoot reads — and discards
 * the ramps between them.
 */
function simplify(samples: readonly BakedKeyframe[], tolerance: number): BakedKeyframe[] {
  if (samples.length <= 2) return [...samples]
  const keep = new Set<number>([0, samples.length - 1])

  const walk = (fromIndex: number, toIndex: number): void => {
    if (toIndex - fromIndex < 2) return
    const from = samples[fromIndex]!
    const to = samples[toIndex]!
    const span = to.frame - from.frame
    let worstIndex = -1
    let worstDistance = 0
    for (let index = fromIndex + 1; index < toIndex; index++) {
      const sample = samples[index]!
      const onLine =
        span === 0
          ? from.value
          : from.value + ((to.value - from.value) * (sample.frame - from.frame)) / span
      const distance = Math.abs(sample.value - onLine)
      if (distance > worstDistance) {
        worstDistance = distance
        worstIndex = index
      }
    }
    if (worstIndex < 0 || worstDistance <= tolerance) return
    keep.add(worstIndex)
    walk(fromIndex, worstIndex)
    walk(worstIndex, toIndex)
  }

  walk(0, samples.length - 1)
  return [...keep].sort((a, b) => a - b).map((index) => samples[index]!)
}

/**
 * Compile every link whose driver actually moved.
 *
 * A link over a still driver is skipped rather than emitted flat, so a scene
 * that never moves a character's torso does not gain a row of zero keyframes on
 * its backpack.
 */
export function compileSecondaryTracks(
  links: readonly SecondaryLink[],
  driven: readonly BakedTrack[],
  options: CompileSecondaryOptions,
): BakedTrack[] {
  const { durationInFrames, fps, startFrame = 0 } = options
  if (durationInFrames <= 0 || links.length === 0) return []

  const curves = mergeDriverCurves(driven)
  const results: BakedTrack[] = []

  for (const link of links) {
    const driver = curves.get(`${link.driverPartId}:${link.driverChannel}`)
    // A still driver is skipped rather than emitted flat, so a scene that never
    // moves a torso does not gain a row of zero keyframes on its backpack.
    if (!driver || driver.length === 0) continue
    if (Math.max(...driver.map((keyframe) => Math.abs(keyframe.value))) <= EPSILON) continue

    const samples = simulateFollower(driver, link, {
      fps,
      firstFrame: Math.round(startFrame),
      lastFrame: Math.round(startFrame + durationInFrames),
    })
    const settled = Math.max(...samples.map((sample) => Math.abs(sample.value)))
    if (settled <= EPSILON) continue

    results.push({
      partId: link.followerPartId,
      channel: link.followerChannel,
      keyframes: simplify(samples, Math.max(1e-4, settled * 0.02)),
    })
  }

  return results
}

/**
 * Sum every track driving the same part channel.
 *
 * Several gestures can drive one channel, and the follower must trail their sum
 * — not whichever one happened to be applied last.
 */
function mergeDriverCurves(driven: readonly BakedTrack[]): Map<string, BakedKeyframe[]> {
  const curves = new Map<string, BakedKeyframe[]>()
  for (const track of driven) {
    const key = `${track.partId}:${track.channel}`
    const existing = curves.get(key)
    if (!existing) {
      curves.set(key, [...track.keyframes])
      continue
    }
    const frames = [
      ...new Set([...existing, ...track.keyframes].map((keyframe) => keyframe.frame)),
    ].sort((a, b) => a - b)
    curves.set(
      key,
      frames.map((frame) => ({
        frame,
        value: valueAt(existing, frame) + valueAt(track.keyframes, frame),
        easing: 'linear' as EasingType,
      })),
    )
  }
  return curves
}

/** Step the spring once per frame over the driven range. */
function simulateFollower(
  driver: readonly BakedKeyframe[],
  link: SecondaryLink,
  range: { fps: number; firstFrame: number; lastFrame: number },
): BakedKeyframe[] {
  const lagFrames = Math.max(0, Math.round(link.lagSeconds * range.fps))
  const stiffness = link.stiffness ?? DEFAULT_STIFFNESS
  const damping = link.damping ?? DEFAULT_DAMPING

  const samples: BakedKeyframe[] = []
  let position = 0
  let velocity = 0
  for (let frame = range.firstFrame; frame <= range.lastFrame; frame++) {
    // Before the range opens the driver is at rest, so a lagged read clamps to
    // its first value rather than wrapping to the end of the curve.
    const target = valueAt(driver, frame - lagFrames) * link.gain
    velocity = (velocity + (target - position) * stiffness) * damping
    position += velocity
    samples.push({ frame, value: position, easing: 'linear' })
  }
  return samples
}
