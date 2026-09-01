import { describe, expect, it } from 'vite-plus/test'
import { RIG_CHANNELS, resolveRigProperty, rigChannelProperties } from './rig-channels'
import type { RigRest } from './rig-channels'
import type { RigChannel } from './types'

const rest: RigRest = { rotation: 10, x: 100, y: -50, opacity: 1, width: 80, height: 200 }

describe('rigChannelProperties', () => {
  it('covers every channel the rig declares', () => {
    for (const channel of RIG_CHANNELS) {
      expect({ channel, properties: rigChannelProperties(channel).length }).toEqual({
        channel,
        properties: expect.any(Number),
      })
      expect(rigChannelProperties(channel).length).toBeGreaterThan(0)
    }
  })

  it('drives both dimensions from a uniform scale, and one from each axis', () => {
    expect(rigChannelProperties('scale')).toEqual(['width', 'height'])
    expect(rigChannelProperties('scaleX')).toEqual(['width'])
    expect(rigChannelProperties('scaleY')).toEqual(['height'])
  })

  it('returns nothing for a channel outside the union', () => {
    expect(rigChannelProperties('nope' as RigChannel)).toEqual([])
  })
})

describe('resolveRigProperty', () => {
  it('adds a rotation contribution in degrees, unscaled', () => {
    expect(resolveRigProperty('rotation', -30, rest, 2)).toBe(-20)
  })

  it('converts positional contributions from block units to canvas pixels', () => {
    expect(resolveRigProperty('x', 5, rest, 2)).toBe(110)
    expect(resolveRigProperty('y', 5, rest, 2)).toBe(-40)
  })

  it('clamps opacity into range instead of emitting an invalid value', () => {
    expect(resolveRigProperty('opacity', 0.5, rest, 1)).toBe(1)
    expect(resolveRigProperty('opacity', -3, rest, 1)).toBe(0)
  })

  it('treats a size contribution as a factor around zero, so rest is unchanged', () => {
    expect(resolveRigProperty('width', 0, rest, 1)).toBe(80)
    expect(resolveRigProperty('height', 0, rest, 1)).toBe(200)
  })

  it('squashes and stretches around the authored size', () => {
    expect(resolveRigProperty('height', -0.25, rest, 1)).toBe(150)
    expect(resolveRigProperty('width', 0.5, rest, 1)).toBe(120)
  })

  it('leaves size independent of placement scale, since rest is already scaled', () => {
    expect(resolveRigProperty('width', 0.5, rest, 4)).toBe(120)
  })
})
