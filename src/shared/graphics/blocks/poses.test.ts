import { describe, expect, it } from 'vite-plus/test'
import { poseToGesture, posesToGesture } from './poses'
import type { PoseDefinition } from './types'

const POINT: PoseDefinition = {
  id: 'point',
  name: 'Point',
  blockId: 'rig',
  channels: [
    { partId: 'arm', channel: 'rotation', value: -80 },
    { partId: 'head', channel: 'rotation', value: 5 },
  ],
}

const CROUCH: PoseDefinition = {
  id: 'crouch',
  name: 'Crouch',
  blockId: 'rig',
  channels: [{ partId: 'thigh', channel: 'rotation', value: 50 }],
}

const STAND: PoseDefinition = { id: 'stand', name: 'Stand', blockId: 'rig', channels: [] }

const OTHER_RIG: PoseDefinition = {
  id: 'wave',
  name: 'Wave',
  blockId: 'different-rig',
  channels: [{ partId: 'arm', channel: 'rotation', value: -100 }],
}

const library = new Map([POINT, CROUCH, STAND, OTHER_RIG].map((pose) => [pose.id, pose]))

const track = (gesture: ReturnType<typeof posesToGesture>, partId: string, channel: string) =>
  gesture.tracks.find((entry) => entry.partId === partId && entry.channel === channel)

describe('posesToGesture', () => {
  it('emits one track per channel any pose in the sequence touches', () => {
    const gesture = posesToGesture(
      [
        { poseId: 'point', at: 0 },
        { poseId: 'crouch', at: 1 },
      ],
      library,
    )
    expect(gesture.tracks.map((entry) => `${entry.partId}:${entry.channel}`).sort()).toEqual([
      'arm:rotation',
      'head:rotation',
      'thigh:rotation',
    ])
  })

  it('returns an unmentioned channel to rest instead of letting it stick', () => {
    const gesture = posesToGesture(
      [
        { poseId: 'point', at: 0 },
        { poseId: 'crouch', at: 1 },
      ],
      library,
    )
    // Without this, "point then crouch" would leave the arm up forever.
    expect(track(gesture, 'arm', 'rotation')?.keyframes).toEqual([
      { at: 0, value: -80, easing: 'ease-in-out' },
      { at: 1, value: 0, easing: 'ease-in-out' },
    ])
  })

  it('lets a rest pose bookend a sequence back to neutral', () => {
    const gesture = posesToGesture(
      [
        { poseId: 'point', at: 0 },
        { poseId: 'stand', at: 1 },
      ],
      library,
    )
    expect(track(gesture, 'arm', 'rotation')?.keyframes.at(-1)?.value).toBe(0)
  })

  it('sorts steps by time, so an out-of-order sequence still reads forward', () => {
    const gesture = posesToGesture(
      [
        { poseId: 'crouch', at: 0.8 },
        { poseId: 'point', at: 0.2 },
      ],
      library,
    )
    const keyframes = track(gesture, 'arm', 'rotation')?.keyframes ?? []
    expect(keyframes.map((keyframe) => keyframe.at)).toEqual([0.2, 0.8])
    expect(keyframes[0]?.value).toBe(-80)
  })

  it('clamps step times into the normalized range', () => {
    const gesture = posesToGesture(
      [
        { poseId: 'point', at: -1 },
        { poseId: 'crouch', at: 4 },
      ],
      library,
    )
    expect(track(gesture, 'arm', 'rotation')?.keyframes.map((k) => k.at)).toEqual([0, 1])
  })

  it('carries a per-step easing', () => {
    const gesture = posesToGesture([{ poseId: 'point', at: 1, easing: 'hold' }], library)
    expect(track(gesture, 'arm', 'rotation')?.keyframes[0]?.easing).toBe('hold')
  })

  it('is not marked loopable unless the caller says so', () => {
    expect(posesToGesture([{ poseId: 'point', at: 1 }], library).loop).toBe(false)
    expect(posesToGesture([{ poseId: 'point', at: 1 }], library, { loop: true }).loop).toBe(true)
  })

  it('refuses an unknown pose', () => {
    expect(() => posesToGesture([{ poseId: 'moonwalk', at: 0 }], library)).toThrow(
      /Unknown pose "moonwalk"/,
    )
  })

  it('refuses to mix poses from different rigs', () => {
    // Part ids are only meaningful inside one block, so a mixed sequence would
    // silently drive nothing on half its tracks.
    expect(() =>
      posesToGesture(
        [
          { poseId: 'point', at: 0 },
          { poseId: 'wave', at: 1 },
        ],
        library,
      ),
    ).toThrow(/cannot mix blocks/)
  })

  it('refuses an empty sequence', () => {
    expect(() => posesToGesture([], library)).toThrow(/at least one step/)
  })
})

describe('poseToGesture', () => {
  it('eases in from rest rather than snapping on the first frame', () => {
    const keyframes = poseToGesture(POINT).tracks[0]?.keyframes ?? []
    expect(keyframes[0]).toEqual({ at: 0, value: 0, easing: 'ease-in-out' })
    expect(keyframes.at(-1)?.at).toBe(1)
  })

  it('holds the pose once reached', () => {
    const keyframes = poseToGesture(POINT, { reachBy: 0.4 }).tracks[0]?.keyframes ?? []
    expect(keyframes.map((keyframe) => keyframe.at)).toEqual([0, 0.4, 1])
    expect(keyframes[1]?.value).toBe(keyframes[2]?.value)
  })

  it('drives every channel the pose names', () => {
    expect(poseToGesture(POINT).tracks).toHaveLength(2)
  })

  it('compiles a rest pose to no tracks at all', () => {
    expect(poseToGesture(STAND).tracks).toEqual([])
  })
})
