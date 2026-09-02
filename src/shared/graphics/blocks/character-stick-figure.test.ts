// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { bakeGesture } from './gesture-bake'
import { instantiateBlock } from './instantiate'
import {
  STICK_FIGURE_BLOCK,
  STICK_FIGURE_GESTURES,
  STICK_FIGURE_POSES,
  STICK_JUMP_GESTURE,
  STICK_WALK_GESTURE,
} from './character-stick-figure'
import { STICKMAN_DARK_PALETTE, STICKMAN_LIGHT_PALETTE } from './scene-palette'

const base = {
  block: STICK_FIGURE_BLOCK,
  from: 0,
  durationInFrames: 300,
  placement: { scale: 1 },
  fps: 30,
}

describe('stick figure block', () => {
  it('lowers every articulated part into editable path layers', () => {
    const result = instantiateBlock({ ...base, palette: STICKMAN_LIGHT_PALETTE })
    expect(result.skipped).toEqual([])
    expect(result.items).toHaveLength(STICK_FIGURE_BLOCK.parts.length)
    expect(result.tracks).toHaveLength(STICK_FIGURE_BLOCK.parts.length + 1)
    expect(result.items.every((item) => item.type === 'shape' && item.shapeType === 'path')).toBe(
      true,
    )
  })

  it('keeps the head hollow and swaps line polarity with the scene palette', () => {
    const light = instantiateBlock({ ...base, palette: STICKMAN_LIGHT_PALETTE })
    const dark = instantiateBlock({ ...base, palette: STICKMAN_DARK_PALETTE })
    const lightHead = light.items.find((item) => item.id.endsWith('-head'))!
    const darkHead = dark.items.find((item) => item.id.endsWith('-head'))!

    expect(lightHead).toMatchObject({
      fillEnabled: false,
      strokeEnabled: true,
      strokeColor: '#111111',
    })
    expect(darkHead).toMatchObject({
      fillEnabled: false,
      strokeEnabled: true,
      strokeColor: '#f7f7f7',
    })
  })

  it('keeps attachment slots on the connected limb tips', () => {
    const partIds = new Set(STICK_FIGURE_BLOCK.parts.map((part) => part.id))
    const slots = STICK_FIGURE_BLOCK.slots ?? []
    expect(slots.every((slot) => slot.partId !== undefined && partIds.has(slot.partId))).toBe(true)
    expect(STICK_FIGURE_BLOCK.parts.some((part) => part.id.startsWith('hand-'))).toBe(false)
    expect(slots.find((slot) => slot.id === 'hand-front')).toMatchObject({
      at: [171, 265],
      partId: 'forearm-front',
    })
  })

  it('ships ambient, locomotion and expressive action vocabulary', () => {
    expect(STICK_FIGURE_GESTURES.map((gesture) => gesture.id)).toEqual([
      'stick-idle',
      'stick-walk',
      'stick-wave',
      'stick-jump',
      'stick-celebrate',
    ])
    expect(STICK_WALK_GESTURE.loop).toBe(true)
    expect(STICK_JUMP_GESTURE.loop).toBe(false)
    expect(STICK_FIGURE_POSES.map((pose) => pose.id)).toContain('stick-explain')
    expect(STICK_FIGURE_POSES.every((pose) => pose.blockId === STICK_FIGURE_BLOCK.id)).toBe(true)
  })

  it('closes a walk cycle and gives a jump a real airborne apex', () => {
    const walk = bakeGesture(STICK_WALK_GESTURE, { durationInFrames: 60 })
    for (const track of walk) {
      expect(track.keyframes.at(-1)?.value).toBeCloseTo(track.keyframes[0]!.value)
    }

    const jump = bakeGesture(STICK_JUMP_GESTURE, { durationInFrames: 90 })
    const pelvisY = jump.find((track) => track.partId === 'pelvis' && track.channel === 'y')!
    expect(Math.min(...pelvisY.keyframes.map((keyframe) => keyframe.value))).toBeLessThanOrEqual(
      -100,
    )
    expect(pelvisY.keyframes.at(-1)?.value).toBe(0)
  })
})
