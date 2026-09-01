import type { EasingType } from '@/types/keyframe'
import type { GestureDefinition, GestureTrack, PoseDefinition, RigChannel } from './types'

/**
 * Poses compile to gestures.
 *
 * Deliberately no new machinery: a held pose is a gesture with a few keyframes
 * and a pose sequence is a gesture with more, so both inherit retiming, cycles,
 * intensity, contribution summing and the dopesheet from the path gestures
 * already take. The only thing poses add is a vocabulary.
 */

export interface PoseStep {
  poseId: string
  /** Normalized position in the sequence, 0..1. */
  at: number
  easing?: EasingType
}

export interface PoseSequenceOptions {
  id?: string
  name?: string
  /**
   * Whether the compiled gesture is marked loopable. Only pass true when the
   * caller has made the first and last step the same pose.
   */
  loop?: boolean
}

const DEFAULT_EASING: EasingType = 'ease-in-out'

/** `partId:channel`, split from the right so a part id containing ':' survives. */
function splitChannelKey(key: string): { partId: string; channel: RigChannel } {
  const separator = key.lastIndexOf(':')
  return {
    partId: key.slice(0, separator),
    channel: key.slice(separator + 1) as RigChannel,
  }
}

/**
 * Compile an ordered pose sequence into a normalized gesture.
 *
 * Every channel any step touches gets a keyframe at every step. That matters:
 * without it a channel set by the first pose and unmentioned by the second would
 * hold its value forever, so "point, then stand" would leave the arm up. An
 * unmentioned channel resolves to 0, which is the part's rest pose.
 */
export function posesToGesture(
  steps: readonly PoseStep[],
  poses: ReadonlyMap<string, PoseDefinition>,
  options: PoseSequenceOptions = {},
): GestureDefinition {
  if (steps.length === 0) throw new Error('A pose sequence needs at least one step.')

  const resolved = steps.map((step) => {
    const pose = poses.get(step.poseId)
    if (!pose) throw new Error(`Unknown pose "${step.poseId}".`)
    return { step, pose }
  })

  const blockIds = new Set(resolved.map((entry) => entry.pose.blockId))
  if (blockIds.size > 1) {
    throw new Error(
      `A pose sequence cannot mix blocks (${[...blockIds].sort().join(', ')}); poses are authored per rig.`,
    )
  }

  const ordered = [...resolved].sort((a, b) => a.step.at - b.step.at)

  // Union of channels across the whole sequence, in first-seen order so the
  // emitted track order is stable and two renders stay byte-comparable.
  const channelKeys: string[] = []
  const seen = new Set<string>()
  for (const entry of ordered) {
    for (const channel of entry.pose.channels) {
      const key = `${channel.partId}:${channel.channel}`
      if (seen.has(key)) continue
      seen.add(key)
      channelKeys.push(key)
    }
  }

  const tracks: GestureTrack[] = channelKeys.map((key) => {
    const { partId, channel } = splitChannelKey(key)
    return {
      partId,
      channel,
      keyframes: ordered.map((entry) => ({
        at: Math.min(1, Math.max(0, entry.step.at)),
        value:
          entry.pose.channels.find(
            (candidate) => candidate.partId === partId && candidate.channel === channel,
          )?.value ?? 0,
        easing: entry.step.easing ?? DEFAULT_EASING,
      })),
    }
  })

  return {
    id: options.id ?? `pose-${ordered.map((entry) => entry.pose.id).join('-to-')}`,
    name: options.name ?? ordered.map((entry) => entry.pose.name).join(' → '),
    loop: options.loop ?? false,
    tracks: tracks.filter((track) => track.keyframes.length > 0),
  }
}

/**
 * Compile a single pose, eased into from rest and then held.
 *
 * The opening keyframe at rest is what makes this an ease-in rather than a snap:
 * a curve whose first keyframe already carries the pose value resolves to that
 * value on frame zero, so the character would be mid-gesture before the clip
 * has started.
 */
export function poseToGesture(
  pose: PoseDefinition,
  options: { easing?: EasingType; reachBy?: number } = {},
): GestureDefinition {
  const easing = options.easing ?? DEFAULT_EASING
  const reachBy = Math.min(1, Math.max(0.01, options.reachBy ?? 0.3))

  const tracks: GestureTrack[] = pose.channels.map((channel) => ({
    partId: channel.partId,
    channel: channel.channel,
    keyframes: [
      { at: 0, value: 0, easing },
      { at: reachBy, value: channel.value, easing },
      { at: 1, value: channel.value, easing },
    ],
  }))

  return { id: `pose-${pose.id}`, name: pose.name, loop: false, tracks }
}
