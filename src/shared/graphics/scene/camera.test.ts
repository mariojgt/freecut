// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { compileCameraMove, parallaxFactor } from './camera'
import type { CameraTarget } from './camera'

const rest = { x: 0, y: 0, width: 400, height: 300, rotation: 0, opacity: 1 }

const target = (overrides: Partial<CameraTarget> = {}): CameraTarget => ({
  itemId: 'a',
  rest,
  isRoot: true,
  ...overrides,
})

const beat = { from: 0, durationInFrames: 40 }

const values = (
  keyframes: ReturnType<typeof compileCameraMove>,
  itemId: string,
  property: string,
) => keyframes.filter((k) => k.itemId === itemId && k.property === property).map((k) => k.value)

describe('parallaxFactor', () => {
  it('moves the foreground fully', () => {
    expect(parallaxFactor(0)).toBe(1)
  })

  it('falls off with distance', () => {
    expect(parallaxFactor(1)).toBeLessThan(parallaxFactor(0))
    expect(parallaxFactor(5)).toBeLessThan(parallaxFactor(1))
  })

  it('leaves the far plane nearly still, which is what reads as distance', () => {
    // A linear falloff would still move plane 5 a third as much as the
    // foreground, which looks like a mistake rather than depth.
    expect(parallaxFactor(5)).toBeLessThan(0.2)
  })

  it('clamps planes outside the range', () => {
    expect(parallaxFactor(-3)).toBe(parallaxFactor(0))
    expect(parallaxFactor(99)).toBe(parallaxFactor(5))
  })
})

describe('compileCameraMove', () => {
  it('pushes in by growing every root', () => {
    const out = compileCameraMove([target()], { ...beat, intent: 'push' })
    const widths = values(out, 'a', 'width')
    expect(widths[0]).toBe(400)
    expect(widths.at(-1)).toBeGreaterThan(400)
  })

  it('pulls out by shrinking', () => {
    const out = compileCameraMove([target()], { ...beat, intent: 'pull' })
    expect(values(out, 'a', 'width').at(-1)).toBeLessThan(400)
  })

  it('pans horizontally in the opposite sense to the camera', () => {
    // The camera moving left sends the world right.
    const left = compileCameraMove([target()], { ...beat, intent: 'pan-left' })
    const right = compileCameraMove([target()], { ...beat, intent: 'pan-right' })
    expect(values(left, 'a', 'x').at(-1)).toBeGreaterThan(0)
    expect(values(right, 'a', 'x').at(-1)).toBeLessThan(0)
  })

  it('rises by sending the world down through frame', () => {
    const out = compileCameraMove([target()], { ...beat, intent: 'rise' })
    expect(values(out, 'a', 'y').at(-1)).toBeGreaterThan(0)
  })

  it('settles with a move small enough to read as a held shot', () => {
    const settle = compileCameraMove([target()], { ...beat, intent: 'settle' })
    const push = compileCameraMove([target()], { ...beat, intent: 'push' })
    const settleDelta = values(settle, 'a', 'width').at(-1)! - 400
    const pushDelta = values(push, 'a', 'width').at(-1)! - 400
    expect(settleDelta).toBeGreaterThan(0)
    expect(settleDelta).toBeLessThan(pushDelta / 2)
  })

  it('moves a near plane further than a far one — the whole point of a camera', () => {
    const out = compileCameraMove(
      [
        target({ itemId: 'near', plane: 0 }),
        target({ itemId: 'mid', plane: 2 }),
        target({ itemId: 'far', plane: 5 }),
      ],
      { ...beat, intent: 'pan-left' },
    )
    const near = values(out, 'near', 'x').at(-1)!
    const mid = values(out, 'mid', 'x').at(-1)!
    const far = values(out, 'far', 'x').at(-1)!
    expect(near).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(far)
  })

  it('treats an unplaced item as foreground', () => {
    const placed = compileCameraMove([target({ plane: 0 })], { ...beat, intent: 'pan-left' })
    const unplaced = compileCameraMove([target()], { ...beat, intent: 'pan-left' })
    expect(values(unplaced, 'a', 'x')).toEqual(values(placed, 'a', 'x'))
  })

  it('drives only roots, so a rig is not moved twice', () => {
    const out = compileCameraMove(
      [target({ itemId: 'root' }), target({ itemId: 'child', isRoot: false })],
      { ...beat, intent: 'push' },
    )
    expect(values(out, 'root', 'width').length).toBeGreaterThan(0)
    expect(values(out, 'child', 'width')).toEqual([])
  })

  it('scales the whole move by amount', () => {
    const full = compileCameraMove([target()], { ...beat, intent: 'pan-left' })
    const half = compileCameraMove([target()], { ...beat, intent: 'pan-left', amount: 0.5 })
    expect(values(half, 'a', 'x').at(-1)).toBeCloseTo(values(full, 'a', 'x').at(-1)! / 2, 6)
  })

  it('spans exactly the beat it was given', () => {
    const out = compileCameraMove([target()], { intent: 'push', from: 12, durationInFrames: 18 })
    const frames = out.map((k) => k.frame)
    expect(Math.min(...frames)).toBe(12)
    expect(Math.max(...frames)).toBe(30)
  })

  it('returns nothing for an empty target list or a zero-length beat', () => {
    expect(compileCameraMove([], { ...beat, intent: 'push' })).toEqual([])
    expect(compileCameraMove([target()], { intent: 'push', from: 0, durationInFrames: 0 })).toEqual(
      [],
    )
  })

  it('is deterministic and stably ordered', () => {
    const shuffled = [target({ itemId: 'z' }), target({ itemId: 'a' }), target({ itemId: 'm' })]
    const first = compileCameraMove(shuffled, { ...beat, intent: 'push' })
    expect(first.map((k) => k.itemId)).toEqual([...first.map((k) => k.itemId)].sort())
    expect(first).toEqual(compileCameraMove(shuffled, { ...beat, intent: 'push' }))
  })
})
