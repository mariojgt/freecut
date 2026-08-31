// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { GestureDefinition } from './types'
import { bakeGesture, sampleGestureTrack } from './gesture-bake'
import { WALK_GESTURE } from './character-astronaut'
import { PARALLAX_PAN_GESTURE, parallaxFactorForDepth } from './world-moon'

const pulse: GestureDefinition = {
  id: 'pulse',
  name: 'Pulse',
  loop: true,
  tracks: [
    {
      partId: 'torso',
      channel: 'y',
      keyframes: [
        { at: 0, value: 0, easing: 'linear' },
        { at: 0.5, value: -10, easing: 'linear' },
        { at: 1, value: 0, easing: 'linear' },
      ],
    },
  ],
}

const oneShot: GestureDefinition = { ...pulse, id: 'one-shot', loop: false }

const trackFor = (gesture: GestureDefinition, partId: string, channel: string) =>
  gesture.tracks.find((track) => track.partId === partId && track.channel === channel)

describe('bakeGesture', () => {
  it('spreads normalized time across the requested frames', () => {
    const [track] = bakeGesture(pulse, { durationInFrames: 60 })
    expect(track?.keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 30, 60])
    expect(track?.keyframes.map((keyframe) => keyframe.value)).toEqual([0, -10, 0])
  })

  it('packs repeats into the same duration', () => {
    const [track] = bakeGesture(pulse, { durationInFrames: 60, cycles: 3 })
    expect(track?.keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 10, 20, 30, 40, 50, 60])
  })

  it('does not stack two keyframes on a shared cycle boundary', () => {
    const [track] = bakeGesture(pulse, { durationInFrames: 40, cycles: 2 })
    const frames = track?.keyframes.map((keyframe) => keyframe.frame) ?? []
    expect(new Set(frames).size).toBe(frames.length)
    // Frame 20 closes cycle one and opens cycle two; both poses are 0.
    expect(track?.keyframes.find((keyframe) => keyframe.frame === 20)?.value).toBe(0)
  })

  it('restates the closing pose so a looping gesture lands on it', () => {
    const spin: GestureDefinition = {
      id: 'spin',
      name: 'Spin',
      loop: true,
      tracks: [
        {
          partId: 'torso',
          channel: 'rotation',
          keyframes: [
            { at: 0, value: 0, easing: 'linear' },
            { at: 0.5, value: 5, easing: 'linear' },
          ],
        },
      ],
    }
    const [track] = bakeGesture(spin, { durationInFrames: 30 })
    expect(track?.keyframes.at(-1)).toMatchObject({ frame: 30, value: 0 })
  })

  it('leaves a one-shot gesture holding its authored final pose', () => {
    const [track] = bakeGesture(oneShot, { durationInFrames: 30 })
    expect(track?.keyframes.at(-1)).toMatchObject({ frame: 30, value: 0 })
    expect(track?.keyframes).toHaveLength(3)
  })

  it('scales contributions by intensity', () => {
    const [track] = bakeGesture(pulse, { durationInFrames: 60, intensity: 0.5 })
    expect(track?.keyframes.map((keyframe) => keyframe.value)).toEqual([0, -5, 0])
  })

  it('mutes a gesture at zero intensity without dropping its lanes', () => {
    const [track] = bakeGesture(pulse, { durationInFrames: 60, intensity: 0 })
    expect(track?.keyframes.every((keyframe) => keyframe.value === 0)).toBe(true)
  })

  it('offsets every frame by the start frame', () => {
    const [track] = bakeGesture(pulse, { durationInFrames: 60, startFrame: 12 })
    expect(track?.keyframes.map((keyframe) => keyframe.frame)).toEqual([12, 42, 72])
  })

  it('produces nothing for a zero-length span', () => {
    expect(bakeGesture(pulse, { durationInFrames: 0 })).toEqual([])
  })

  it('treats a fractional cycle count as a single pass', () => {
    const [track] = bakeGesture(pulse, { durationInFrames: 60, cycles: 0.4 })
    expect(track?.keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 30, 60])
  })
})

describe('sampleGestureTrack', () => {
  it('samples inclusively from 0 to 1', () => {
    const track = sampleGestureTrack('torso', 'y', 4, (t) => t)
    expect(track.keyframes.map((keyframe) => keyframe.at)).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(track.keyframes.at(-1)?.value).toBe(1)
  })

  it('refuses to degenerate below two samples', () => {
    expect(sampleGestureTrack('torso', 'y', 0, () => 1).keyframes.length).toBeGreaterThanOrEqual(3)
  })
})

describe('walk cycle', () => {
  it('closes seamlessly on every track', () => {
    for (const track of WALK_GESTURE.tracks) {
      const first = track.keyframes[0]!
      const last = track.keyframes.at(-1)!
      expect({ part: track.partId, at: last.at }).toEqual({ part: track.partId, at: 1 })
      expect(last.value).toBeCloseTo(first.value, 10)
    }
  })

  it('runs the legs exactly a half cycle apart', () => {
    const near = trackFor(WALK_GESTURE, 'thigh-near', 'rotation')!
    const far = trackFor(WALK_GESTURE, 'thigh-far', 'rotation')!
    near.keyframes.forEach((keyframe, index) => {
      expect(keyframe.value).toBeCloseTo(-far.keyframes[index]!.value, 10)
    })
  })

  it('bends each knee in one direction only', () => {
    // A knee that crosses zero is hyperextending the wrong way.
    for (const partId of ['shin-near', 'shin-far']) {
      const track = trackFor(WALK_GESTURE, partId, 'rotation')!
      expect(track.keyframes.every((keyframe) => keyframe.value >= 0)).toBe(true)
      expect(Math.max(...track.keyframes.map((keyframe) => keyframe.value))).toBeGreaterThan(10)
    }
  })

  it('swings each arm against the leg on its own side', () => {
    const thigh = trackFor(WALK_GESTURE, 'thigh-near', 'rotation')!
    const arm = trackFor(WALK_GESTURE, 'arm-near', 'rotation')!
    const opposed = thigh.keyframes.filter((keyframe, index) => {
      const armValue = arm.keyframes[index]!.value
      return Math.abs(keyframe.value) < 1e-9 || keyframe.value * armValue < 0
    })
    expect(opposed).toHaveLength(thigh.keyframes.length)
  })

  it('lifts the body twice per cycle, once per passing pose', () => {
    const track = trackFor(WALK_GESTURE, 'torso', 'y')!
    // Negative is up: contact poses sit at 0, the two passes reach the peak.
    expect(track.keyframes[0]?.value).toBeCloseTo(0, 10)
    expect(track.keyframes[4]?.value).toBeCloseTo(-4, 10)
    expect(track.keyframes[8]?.value).toBeCloseTo(0, 10)
    expect(track.keyframes[12]?.value).toBeCloseTo(-4, 10)
  })

  it('drives both legs, both arms and the body', () => {
    const parts = new Set(WALK_GESTURE.tracks.map((track) => track.partId))
    for (const required of ['thigh-near', 'thigh-far', 'arm-near', 'arm-far', 'torso']) {
      expect({ required, driven: parts.has(required) }).toEqual({ required, driven: true })
    }
  })
})

describe('parallax', () => {
  it('moves nearer planes further than distant ones', () => {
    const factors = [0, 1, 2, 3, 4, 5].map(parallaxFactorForDepth)
    for (let index = 1; index < factors.length; index++) {
      expect(factors[index]!).toBeLessThan(factors[index - 1]!)
    }
    expect(factors[0]).toBe(1)
    expect(factors.at(-1)!).toBeGreaterThan(0)
  })

  it('clamps depths outside the plane range', () => {
    expect(parallaxFactorForDepth(-3)).toBe(parallaxFactorForDepth(0))
    expect(parallaxFactorForDepth(99)).toBe(parallaxFactorForDepth(5))
  })

  it('pans the foreground further than the sky', () => {
    const travelFor = (partId: string) => {
      const track = PARALLAX_PAN_GESTURE.tracks.find((entry) => entry.partId === partId)
      return Math.abs(track?.keyframes.at(-1)?.value ?? 0)
    }
    expect(travelFor('rock-near')).toBeGreaterThan(travelFor('ground'))
    expect(travelFor('ground')).toBeGreaterThan(travelFor('sky'))
  })

  it('never animates a parented part, which already inherits its parent travel', () => {
    const panned = new Set(PARALLAX_PAN_GESTURE.tracks.map((track) => track.partId))
    expect(panned.has('crater-a')).toBe(false)
    expect(panned.has('ground')).toBe(true)
  })
})
