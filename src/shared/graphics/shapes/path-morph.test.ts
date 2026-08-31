// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { MaskVertex } from '@/types/masks'
import { flattenBezierPath } from './bezier-path'
import {
  clonePath,
  pathVertexComponents,
  preparePathMorph,
  resamplePathVertices,
} from './path-morph'

function corner(x: number, y: number): MaskVertex {
  return { position: [x, y], inHandle: [0, 0], outHandle: [0, 0] }
}

/** Unit square, clockwise from the top-left. */
const square: MaskVertex[] = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)]

/** A closed four-anchor circle approximation. */
const circle: MaskVertex[] = [
  { position: [0.5, 0], inHandle: [-0.2761, 0], outHandle: [0.2761, 0] },
  { position: [1, 0.5], inHandle: [0, -0.2761], outHandle: [0, 0.2761] },
  { position: [0.5, 1], inHandle: [0.2761, 0], outHandle: [-0.2761, 0] },
  { position: [0, 0.5], inHandle: [0, 0.2761], outHandle: [0, -0.2761] },
]

const positionsOf = (vertices: MaskVertex[]) => vertices.map((vertex) => vertex.position)

describe('resamplePathVertices', () => {
  it('reaches the requested vertex count', () => {
    expect(resamplePathVertices(square, true, 9)).toHaveLength(9)
    expect(resamplePathVertices(circle, true, 16)).toHaveLength(16)
  })

  it('leaves a path alone when it already has enough vertices', () => {
    expect(resamplePathVertices(square, true, 4)).toEqual(square)
    expect(resamplePathVertices(square, true, 2)).toEqual(square)
  })

  it('subdivides without moving the outline', () => {
    const before = flattenBezierPath(circle, 400, 400, true)
    const after = flattenBezierPath(resamplePathVertices(circle, true, 17), 400, 400, true)
    expect(after.totalLength).toBeCloseTo(before.totalLength, 6)
  })

  it('places new anchors on the curve it split', () => {
    // Halving one edge of the unit square must land exactly on its midpoint.
    const resampled = resamplePathVertices([corner(0, 0), corner(1, 0)], false, 3)
    expect(positionsOf(resampled)).toEqual([
      [0, 0],
      [0.5, 0],
      [1, 0],
    ])
  })

  it('spreads added anchors across the longest edges rather than one', () => {
    // A 4-wide, 1-tall rectangle: the two long edges should absorb the new points.
    const rectangle = [corner(0, 0), corner(4, 0), corner(4, 1), corner(0, 1)]
    const resampled = resamplePathVertices(rectangle, true, 6)
    const xs = positionsOf(resampled).map(([x]) => x)
    expect(xs).toContain(2)
    expect(resampled).toHaveLength(6)
  })

  it('refuses to resample geometry with fewer than two anchors', () => {
    expect(resamplePathVertices([corner(0, 0)], false, 5)).toHaveLength(1)
    expect(resamplePathVertices([], true, 5)).toHaveLength(0)
  })

  it('does not mutate its input', () => {
    const original = clonePath(square)
    resamplePathVertices(square, true, 12)
    expect(square).toEqual(original)
  })
})

describe('preparePathMorph', () => {
  it('grows both paths to a shared vertex count', () => {
    const alignment = preparePathMorph(square, true, circle.slice(0, 3), true)
    expect(alignment.from).toHaveLength(4)
    expect(alignment.to).toHaveLength(4)
  })

  it('rotates a closed target so identical outlines pair up exactly', () => {
    // The same square, authored starting two vertices later.
    const shifted = [corner(1, 1), corner(0, 1), corner(0, 0), corner(1, 0)]
    const alignment = preparePathMorph(square, true, shifted, true)
    expect(positionsOf(alignment.to)).toEqual(positionsOf(square))
  })

  it('flips a target authored with the opposite winding', () => {
    const counterClockwise = [corner(0, 0), corner(0, 1), corner(1, 1), corner(1, 0)]
    const alignment = preparePathMorph(square, true, counterClockwise, true)
    expect(positionsOf(alignment.to)).toEqual(positionsOf(square))
    expect(alignment.reversed).toBe(true)
  })

  it('picks the cheapest pairing rather than the authored order', () => {
    const shifted = [corner(1, 0), corner(1, 1), corner(0, 1), corner(0, 0)]
    const naiveCost = square.reduce((total, vertex, index) => {
      const other = shifted[index]!.position
      return total + (vertex.position[0] - other[0]) ** 2 + (vertex.position[1] - other[1]) ** 2
    }, 0)
    expect(naiveCost).toBeGreaterThan(0)

    const alignment = preparePathMorph(square, true, shifted, true)
    const alignedCost = alignment.from.reduce((total, vertex, index) => {
      const other = alignment.to[index]!.position
      return total + (vertex.position[0] - other[0]) ** 2 + (vertex.position[1] - other[1]) ** 2
    }, 0)
    expect(alignedCost).toBeLessThan(naiveCost)
  })

  it('never rotates an open path, whose endpoints are fixed', () => {
    const line = [corner(0, 0), corner(1, 0), corner(2, 0)]
    const other = [corner(0, 1), corner(1, 1), corner(2, 1)]
    const alignment = preparePathMorph(line, false, other, false)
    expect(alignment.startOffset).toBe(0)
    expect(positionsOf(alignment.to)).toEqual(positionsOf(other))
  })

  it('degrades to an open morph when only one side is closed', () => {
    expect(preparePathMorph(square, true, square, false).closed).toBe(false)
    expect(preparePathMorph(square, false, square, true).closed).toBe(false)
    expect(preparePathMorph(square, true, square, true).closed).toBe(true)
  })

  it('survives degenerate geometry without throwing', () => {
    const alignment = preparePathMorph([corner(0, 0)], false, square, true)
    expect(alignment.from).toHaveLength(1)
    expect(alignment.startOffset).toBe(0)
  })

  it('does not mutate either input', () => {
    const from = clonePath(square)
    const to = clonePath(circle)
    preparePathMorph(square, true, circle, true)
    expect(square).toEqual(from)
    expect(circle).toEqual(to)
  })
})

describe('pathVertexComponents', () => {
  it('flattens vertices into the six animatable channels', () => {
    expect(
      pathVertexComponents([{ position: [0.25, 0.5], inHandle: [-0.1, 0], outHandle: [0.1, 0.2] }]),
    ).toEqual([{ positionX: 0.25, positionY: 0.5, inX: -0.1, inY: 0, outX: 0.1, outY: 0.2 }])
  })
})
