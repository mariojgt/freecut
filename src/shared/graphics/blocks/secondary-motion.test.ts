import { describe, expect, it } from 'vite-plus/test'
import type { BakedTrack } from './gesture-bake'
import { compileSecondaryTracks } from './secondary-motion'
import type { SecondaryLink } from './types'

const link = (overrides: Partial<SecondaryLink> = {}): SecondaryLink => ({
  id: 'pack',
  driverPartId: 'torso',
  driverChannel: 'y',
  followerPartId: 'backpack',
  followerChannel: 'y',
  gain: 1,
  lagSeconds: 0.1,
  ...overrides,
})

/** A driver that steps from rest to -10 at frame 10 and holds. */
const stepDriver = (): BakedTrack[] => [
  {
    partId: 'torso',
    channel: 'y',
    keyframes: [
      { frame: 0, value: 0, easing: 'linear' },
      { frame: 9, value: 0, easing: 'linear' },
      { frame: 10, value: -10, easing: 'linear' },
      { frame: 60, value: -10, easing: 'linear' },
    ],
  },
]

const options = { durationInFrames: 60, fps: 30 }

const valueAt = (track: BakedTrack, frame: number): number => {
  const exact = track.keyframes.find((keyframe) => keyframe.frame === frame)
  if (exact) return exact.value
  const before = [...track.keyframes].reverse().find((keyframe) => keyframe.frame <= frame)
  const after = track.keyframes.find((keyframe) => keyframe.frame >= frame)
  if (!before) return after?.value ?? 0
  if (!after) return before.value
  const span = after.frame - before.frame
  if (span === 0) return before.value
  return before.value + ((after.value - before.value) * (frame - before.frame)) / span
}

describe('compileSecondaryTracks', () => {
  it('emits one track per link, targeting the follower', () => {
    const tracks = compileSecondaryTracks([link()], stepDriver(), options)
    expect(tracks).toHaveLength(1)
    expect({ partId: tracks[0]?.partId, channel: tracks[0]?.channel }).toEqual({
      partId: 'backpack',
      channel: 'y',
    })
  })

  it('starts at rest and arrives after the driver', () => {
    const [track] = compileSecondaryTracks([link()], stepDriver(), options)
    // The driver jumps at frame 10 and the lag is 3 frames at 30fps, so the
    // follower must still be essentially at rest when the driver has moved.
    expect(Math.abs(valueAt(track!, 10))).toBeLessThan(0.5)
    expect(Math.abs(valueAt(track!, 40))).toBeGreaterThan(5)
  })

  it('settles on the driver value rather than drifting past it', () => {
    const [track] = compileSecondaryTracks([link()], stepDriver(), options)
    expect(valueAt(track!, 60)).toBeCloseTo(-10, 1)
  })

  it('overshoots a step, which is what reads as weight', () => {
    const [track] = compileSecondaryTracks(
      [link({ stiffness: 0.5, damping: 0.8 })],
      stepDriver(),
      options,
    )
    const extreme = Math.min(...track!.keyframes.map((keyframe) => keyframe.value))
    expect(extreme).toBeLessThan(-10)
  })

  it('scales the follower by gain, and inverts on a negative gain', () => {
    const [track] = compileSecondaryTracks([link({ gain: -0.5 })], stepDriver(), options)
    expect(valueAt(track!, 60)).toBeCloseTo(5, 1)
  })

  it('converts across channels, so one part can drive another property', () => {
    const [track] = compileSecondaryTracks(
      [link({ followerChannel: 'rotation', gain: 2 })],
      stepDriver(),
      options,
    )
    expect(track?.channel).toBe('rotation')
    expect(valueAt(track!, 60)).toBeCloseTo(-20, 1)
  })

  it('sums every gesture driving the channel before deriving the follower', () => {
    const doubled: BakedTrack[] = [...stepDriver(), ...stepDriver()]
    const [track] = compileSecondaryTracks([link()], doubled, options)
    expect(valueAt(track!, 60)).toBeCloseTo(-20, 1)
  })

  it('skips a link whose driver never moved, rather than writing a flat row', () => {
    const still: BakedTrack[] = [
      {
        partId: 'torso',
        channel: 'y',
        keyframes: [
          { frame: 0, value: 0, easing: 'linear' },
          { frame: 60, value: 0, easing: 'linear' },
        ],
      },
    ]
    expect(compileSecondaryTracks([link()], still, options)).toEqual([])
  })

  it('skips a link whose driver channel is absent', () => {
    const other: BakedTrack[] = [
      {
        partId: 'torso',
        channel: 'rotation',
        keyframes: [{ frame: 0, value: 5, easing: 'linear' }],
      },
    ]
    expect(compileSecondaryTracks([link()], other, options)).toEqual([])
  })

  it('is deterministic — the same input compiles to identical keyframes', () => {
    const first = compileSecondaryTracks([link()], stepDriver(), options)
    const second = compileSecondaryTracks([link()], stepDriver(), options)
    expect(first).toEqual(second)
  })

  it('scales lag with the frame rate, so the feel survives a rate change', () => {
    const [slow] = compileSecondaryTracks([link()], stepDriver(), { ...options, fps: 15 })
    const [fast] = compileSecondaryTracks([link()], stepDriver(), { ...options, fps: 60 })
    // A 0.1s lag is 1 frame at 15fps and 6 at 60fps, so the higher rate is
    // measurably further behind at the same frame.
    expect(Math.abs(valueAt(slow!, 14))).toBeGreaterThan(Math.abs(valueAt(fast!, 14)))
  })

  it('writes far fewer keyframes than frames simulated', () => {
    const [track] = compileSecondaryTracks([link()], stepDriver(), options)
    expect(track!.keyframes.length).toBeLessThan(30)
    expect(track!.keyframes.length).toBeGreaterThan(2)
  })

  it('returns nothing for an empty link list or a zero-length span', () => {
    expect(compileSecondaryTracks([], stepDriver(), options)).toEqual([])
    expect(
      compileSecondaryTracks([link()], stepDriver(), { ...options, durationInFrames: 0 }),
    ).toEqual([])
  })
})
