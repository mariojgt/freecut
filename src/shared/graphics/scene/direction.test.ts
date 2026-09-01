// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { compileDirectedAction } from './direction'
import type { DirectedActionOptions, DirectedTarget } from './direction'

const rest = { x: 0, y: 0, width: 200, height: 100, rotation: 0, opacity: 1 }

const target = (overrides: Partial<DirectedTarget> = {}): DirectedTarget => ({
  itemId: 'a',
  rest,
  isRoot: true,
  ...overrides,
})

const beat: Pick<DirectedActionOptions, 'from' | 'durationInFrames'> = {
  from: 0,
  durationInFrames: 30,
}

const lane = (
  keyframes: ReturnType<typeof compileDirectedAction>,
  itemId: string,
  property: string,
) => keyframes.filter((k) => k.itemId === itemId && k.property === property)

const values = (
  keyframes: ReturnType<typeof compileDirectedAction>,
  itemId: string,
  property: string,
) => lane(keyframes, itemId, property).map((k) => k.value)

describe('enter', () => {
  it('travels in from the named direction and lands at rest', () => {
    const out = compileDirectedAction([target()], { ...beat, action: 'enter', direction: 'left' })
    const xs = values(out, 'a', 'x')
    // Starts left of rest, ends exactly at rest.
    expect(xs[0]).toBeLessThan(0)
    expect(xs.at(-1)).toBe(0)
  })

  it('overshoots slightly before settling, so it reads as arrival', () => {
    const out = compileDirectedAction([target()], { ...beat, action: 'enter', direction: 'left' })
    const xs = values(out, 'a', 'x')
    // The penultimate key passes the rest position.
    expect(xs[1]).toBeGreaterThan(0)
  })

  it('fades in on every part but only moves the roots', () => {
    const out = compileDirectedAction(
      [target({ itemId: 'root' }), target({ itemId: 'child', isRoot: false })],
      { ...beat, action: 'enter', direction: 'up' },
    )
    // Opacity is not inherited, so both fade.
    expect(lane(out, 'root', 'opacity').length).toBeGreaterThan(0)
    expect(lane(out, 'child', 'opacity').length).toBeGreaterThan(0)
    // Geometry IS inherited, so only the root translates.
    expect(lane(out, 'root', 'y').length).toBeGreaterThan(0)
    expect(lane(out, 'child', 'y')).toEqual([])
  })

  it('starts fully transparent and ends at the part rest opacity', () => {
    const out = compileDirectedAction([target({ rest: { ...rest, opacity: 0.6 } })], {
      ...beat,
      action: 'enter',
    })
    const opacities = values(out, 'a', 'opacity')
    expect(opacities[0]).toBe(0)
    expect(opacities.at(-1)).toBe(0.6)
  })

  it('reads depth as scale rather than translation', () => {
    const out = compileDirectedAction([target()], { ...beat, action: 'enter', direction: 'in' })
    expect(lane(out, 'a', 'x')).toEqual([])
    const widths = values(out, 'a', 'width')
    // Arrives from smaller, settles at the authored size.
    expect(widths[0]).toBeLessThan(200)
    expect(widths.at(-1)).toBe(200)
  })

  it('derives its travel from the target size, so small props start close', () => {
    const small = compileDirectedAction([target({ rest: { ...rest, width: 50 } })], {
      ...beat,
      action: 'enter',
      direction: 'left',
    })
    const large = compileDirectedAction([target({ rest: { ...rest, width: 1600 } })], {
      ...beat,
      action: 'enter',
      direction: 'left',
    })
    expect(Math.abs(values(small, 'a', 'x')[0]!)).toBeLessThan(
      Math.abs(values(large, 'a', 'x')[0]!),
    )
  })

  it('honours an explicit distance and scales it by intensity', () => {
    const out = compileDirectedAction([target()], {
      ...beat,
      action: 'enter',
      direction: 'right',
      distance: 500,
      intensity: 0.5,
    })
    expect(values(out, 'a', 'x')[0]).toBeCloseTo(250, 6)
  })

  it('lands its keyframes inside the beat', () => {
    const out = compileDirectedAction([target()], {
      action: 'enter',
      direction: 'left',
      from: 60,
      durationInFrames: 20,
    })
    for (const keyframe of out) {
      expect(keyframe.frame).toBeGreaterThanOrEqual(60)
      expect(keyframe.frame).toBeLessThanOrEqual(80)
    }
  })
})

describe('exit', () => {
  it('leaves from rest toward the named direction', () => {
    const out = compileDirectedAction([target()], { ...beat, action: 'exit', direction: 'down' })
    const ys = values(out, 'a', 'y')
    expect(ys[0]).toBe(0)
    expect(ys.at(-1)).toBeGreaterThan(0)
  })

  it('ends fully transparent', () => {
    const out = compileDirectedAction([target()], { ...beat, action: 'exit' })
    expect(values(out, 'a', 'opacity').at(-1)).toBe(0)
  })

  it('does not overshoot, because nothing is arriving', () => {
    const out = compileDirectedAction([target()], { ...beat, action: 'exit', direction: 'right' })
    const xs = values(out, 'a', 'x')
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })
})

describe('emphasize', () => {
  it('pops and returns to the authored size', () => {
    const out = compileDirectedAction([target()], { ...beat, action: 'emphasize' })
    const widths = values(out, 'a', 'width')
    expect(widths[0]).toBe(200)
    expect(Math.max(...widths)).toBeGreaterThan(200)
    expect(widths.at(-1)).toBe(200)
  })

  it('scales both dimensions together, so nothing is distorted', () => {
    const out = compileDirectedAction([target()], { ...beat, action: 'emphasize' })
    const widthRatio = Math.max(...values(out, 'a', 'width')) / 200
    const heightRatio = Math.max(...values(out, 'a', 'height')) / 100
    expect(widthRatio).toBeCloseTo(heightRatio, 6)
  })

  it('does not touch position or opacity', () => {
    const out = compileDirectedAction([target()], { ...beat, action: 'emphasize' })
    expect(lane(out, 'a', 'x')).toEqual([])
    expect(lane(out, 'a', 'opacity')).toEqual([])
  })
})

describe('moveTo', () => {
  it('travels from rest to the destination', () => {
    const out = compileDirectedAction([target()], {
      ...beat,
      action: 'moveTo',
      to: { x: 400, y: -200 },
    })
    expect(values(out, 'a', 'x')).toEqual([0, 400])
    expect(values(out, 'a', 'y')).toEqual([0, -200])
  })

  it('leaves an unspecified axis alone', () => {
    const out = compileDirectedAction([target()], { ...beat, action: 'moveTo', to: { x: 400 } })
    expect(lane(out, 'a', 'y')).toEqual([])
  })

  it('bows off the straight line when given an arc', () => {
    const out = compileDirectedAction([target()], {
      ...beat,
      action: 'moveTo',
      to: { x: 400, y: 0 },
      arc: 120,
    })
    const ys = values(out, 'a', 'y')
    // A straight horizontal move would hold y at 0 throughout.
    expect(Math.max(...ys.map(Math.abs))).toBeGreaterThan(40)
    // It still starts and ends on the line.
    expect(ys[0]).toBeCloseTo(0, 6)
    expect(ys.at(-1)).toBeCloseTo(0, 6)
  })

  it('samples the arc densely enough to read as a curve', () => {
    const out = compileDirectedAction([target()], {
      ...beat,
      action: 'moveTo',
      to: { x: 400, y: 0 },
      arc: 120,
    })
    expect(values(out, 'a', 'x').length).toBeGreaterThan(8)
  })

  it('drops the bow on a zero-length move rather than dividing by zero', () => {
    const out = compileDirectedAction([target()], {
      ...beat,
      action: 'moveTo',
      to: { x: 0, y: 0 },
      arc: 100,
    })
    for (const keyframe of out) expect(Number.isFinite(keyframe.value)).toBe(true)
  })
})

describe('shake', () => {
  it('settles back at rest with a decaying swing', () => {
    const out = compileDirectedAction([target()], { ...beat, action: 'shake' })
    const xs = values(out, 'a', 'x')
    expect(xs[0]).toBe(0)
    expect(xs.at(-1)).toBe(0)
    // Each swing is smaller than the one before it.
    const peaks = xs.slice(1, -1).map(Math.abs)
    expect(peaks[0]).toBeGreaterThan(peaks.at(-1)!)
  })

  it('shakes vertically when asked', () => {
    const out = compileDirectedAction([target()], {
      ...beat,
      action: 'shake',
      direction: 'up',
    })
    expect(lane(out, 'a', 'y').length).toBeGreaterThan(2)
    expect(lane(out, 'a', 'x')).toEqual([])
  })
})

describe('reveal', () => {
  const three = [target({ itemId: 'a' }), target({ itemId: 'b' }), target({ itemId: 'c' })]

  it('starts each item later than the last', () => {
    const out = compileDirectedAction(three, { ...beat, action: 'reveal' })
    const starts = ['a', 'b', 'c'].map((id) => lane(out, id, 'opacity')[0]!.frame)
    expect(starts[0]).toBeLessThan(starts[1]!)
    expect(starts[1]).toBeLessThan(starts[2]!)
  })

  it('finishes the whole cascade inside the beat', () => {
    const out = compileDirectedAction(three, { ...beat, action: 'reveal' })
    for (const keyframe of out) expect(keyframe.frame).toBeLessThanOrEqual(30)
  })

  it('lifts each item into place as it appears', () => {
    const out = compileDirectedAction(three, { ...beat, action: 'reveal' })
    const ys = values(out, 'b', 'y')
    expect(ys[0]).toBeGreaterThan(0)
    expect(ys.at(-1)).toBe(0)
  })

  it('can cascade opacity alone', () => {
    const out = compileDirectedAction(three, { ...beat, action: 'reveal', distance: 0 })
    expect(lane(out, 'b', 'y')).toEqual([])
  })

  it('reveals a single item without dividing by zero', () => {
    const out = compileDirectedAction([target()], { ...beat, action: 'reveal' })
    for (const keyframe of out) expect(Number.isFinite(keyframe.frame)).toBe(true)
  })
})

describe('compileDirectedAction', () => {
  it('returns nothing for an empty target list or a zero-length beat', () => {
    expect(compileDirectedAction([], { ...beat, action: 'enter' })).toEqual([])
    expect(
      compileDirectedAction([target()], { action: 'enter', from: 0, durationInFrames: 0 }),
    ).toEqual([])
  })

  it('never emits two keyframes for the same item, property and frame', () => {
    // A one-frame beat rounds every curve point onto the same frame.
    const out = compileDirectedAction([target()], {
      action: 'enter',
      direction: 'left',
      from: 0,
      durationInFrames: 1,
    })
    const keys = out.map((k) => `${k.itemId}:${k.property}:${k.frame}`)
    expect(keys.length).toBe(new Set(keys).size)
  })

  it('is deterministic and stably ordered', () => {
    const options = { ...beat, action: 'enter' as const, direction: 'left' as const }
    const first = compileDirectedAction(three(), options)
    const second = compileDirectedAction(three(), options)
    expect(first).toEqual(second)
  })
})

function three(): DirectedTarget[] {
  return [target({ itemId: 'c' }), target({ itemId: 'a' }), target({ itemId: 'b' })]
}
