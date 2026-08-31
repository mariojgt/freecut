// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { buildBezierPathData } from './bezier-path'
import {
  parseSvgPathData,
  parseSvgPathToVertices,
  subpathBounds,
  subpathToMaskVertices,
} from './svg-path-parse'

/** Round-trip a `d` through the editable model and back into `d`. */
function roundTrip(d: string): string[] {
  return parseSvgPathToVertices(d).map((path) =>
    buildBezierPathData(
      path.vertices,
      path.bounds.width || 1,
      path.bounds.height || 1,
      path.closed,
    ),
  )
}

describe('parseSvgPathData', () => {
  it('keeps straight segments handle-free so they re-emit as lines', () => {
    const [subpath] = parseSvgPathData('M 0 0 L 10 0 L 10 10')
    expect(subpath?.closed).toBe(false)
    expect(subpath?.anchors.map((anchor) => [anchor.x, anchor.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
    expect(subpath?.anchors.every((anchor) => anchor.outX === 0 && anchor.outY === 0)).toBe(true)
  })

  it('resolves relative commands against the running point', () => {
    const [absolute] = parseSvgPathData('M 10 10 L 20 10 L 20 20')
    const [relative] = parseSvgPathData('m 10 10 l 10 0 l 0 10')
    expect(relative?.anchors).toEqual(absolute?.anchors)
  })

  it('treats coordinates trailing a moveto as implicit linetos', () => {
    const [subpath] = parseSvgPathData('M 0 0 5 0 5 5')
    expect(subpath?.anchors.map((anchor) => [anchor.x, anchor.y])).toEqual([
      [0, 0],
      [5, 0],
      [5, 5],
    ])
  })

  it('expands horizontal and vertical shorthands', () => {
    const [subpath] = parseSvgPathData('M 4 4 H 12 V 20 h -4 v -2')
    expect(subpath?.anchors.map((anchor) => [anchor.x, anchor.y])).toEqual([
      [4, 4],
      [12, 4],
      [12, 20],
      [8, 20],
      [8, 18],
    ])
  })

  it('reflects the previous control point for smooth cubics', () => {
    const [subpath] = parseSvgPathData('M 0 0 C 0 10 10 10 10 0 S 20 -10 20 0')
    const middle = subpath?.anchors[1]
    // The trailing control of the first cubic sits at (10, 10), i.e. +10 in Y
    // from the anchor, so the reflected outgoing handle must be -10 in Y.
    expect(middle?.inY).toBe(10)
    expect(middle?.outY).toBe(-10)
    expect(middle?.outX).toBe(0)
  })

  it('starts a smooth cubic from the current point when nothing precedes it', () => {
    const [subpath] = parseSvgPathData('M 0 0 S 10 10 20 0')
    expect(subpath?.anchors[0]?.outX).toBe(0)
    expect(subpath?.anchors[0]?.outY).toBe(0)
  })

  it('elevates quadratics to the exactly equivalent cubic', () => {
    const [subpath] = parseSvgPathData('M 0 0 Q 6 12 12 0')
    const [start, end] = subpath?.anchors ?? []
    // cp1 = p0 + 2/3(q - p0), cp2 = p3 + 2/3(q - p3)
    expect(start?.outX).toBeCloseTo(4, 10)
    expect(start?.outY).toBeCloseTo(8, 10)
    expect(end?.inX).toBeCloseTo(-4, 10)
    expect(end?.inY).toBeCloseTo(8, 10)
  })

  it('reflects the quadratic control point for smooth quadratics', () => {
    const [subpath] = parseSvgPathData('M 0 0 Q 5 10 10 0 T 20 0')
    // Reflecting (5,10) about (10,0) puts the implied control at (15,-10).
    const end = subpath?.anchors[2]
    expect(end?.inY).toBeCloseTo((2 / 3) * -10, 10)
  })

  it('reads arc flags that run together with the coordinates after them', () => {
    // `011 1` is large-arc=0, sweep=1, x=1, y=1 — a number tokenizer reads "011".
    const packed = parseSvgPathData('M 0 0 a 1 1 0 011 1')
    const spaced = parseSvgPathData('M 0 0 a 1 1 0 0 1 1 1')
    expect(packed).toEqual(spaced)
    expect(packed[0]?.anchors.length).toBeGreaterThan(1)
  })

  it('approximates a full-circle arc pair within a pixel', () => {
    const subpaths = parseSvgPathData('M 10 0 A 10 10 0 1 0 -10 0 A 10 10 0 1 0 10 0 Z')
    const bounds = subpathBounds(subpaths)
    expect(bounds.minX).toBeCloseTo(-10, 2)
    expect(bounds.maxX).toBeCloseTo(10, 2)
    expect(bounds.minY).toBeCloseTo(-10, 2)
    expect(bounds.maxY).toBeCloseTo(10, 2)
  })

  it('degrades a zero-radius arc to a line', () => {
    const [subpath] = parseSvgPathData('M 0 0 A 0 0 0 0 1 10 10')
    expect(subpath?.anchors.map((anchor) => [anchor.x, anchor.y])).toEqual([
      [0, 0],
      [10, 10],
    ])
  })

  it('folds a closing anchor that lands back on the start', () => {
    const [subpath] = parseSvgPathData('M 0 0 L 10 0 L 10 10 L 0 0 Z')
    expect(subpath?.closed).toBe(true)
    // The explicit return to the origin must not survive as a fourth anchor.
    expect(subpath?.anchors).toHaveLength(3)
  })

  it('keeps a closing anchor that does not coincide with the start', () => {
    const [subpath] = parseSvgPathData('M 0 0 L 10 0 L 10 10 Z')
    expect(subpath?.closed).toBe(true)
    expect(subpath?.anchors).toHaveLength(3)
  })

  it('resumes from the subpath start after a close', () => {
    // Per the spec `Z` restores the current point to the subpath start, so the
    // relative segments that follow are measured from (0, 0), not from (10, 0).
    const subpaths = parseSvgPathData('M 0 0 L 10 0 Z l 0 10 l 10 0')
    expect(subpaths).toHaveLength(2)
    expect(subpaths[1]?.anchors.map((anchor) => [anchor.x, anchor.y])).toEqual([
      [0, 0],
      [0, 10],
      [10, 10],
    ])
  })

  it('drops subpaths that never draw anything', () => {
    expect(parseSvgPathData('M 5 5')).toEqual([])
    expect(parseSvgPathData('')).toEqual([])
  })

  it('keeps the geometry parsed before a malformed tail', () => {
    const [subpath] = parseSvgPathData('M 0 0 L 10 0 L 10')
    expect(subpath?.anchors.map((anchor) => [anchor.x, anchor.y])).toEqual([
      [0, 0],
      [10, 0],
    ])
  })

  it('parses exponent and leading-dot number forms', () => {
    const [subpath] = parseSvgPathData('M0 0L1e1 .5')
    expect(subpath?.anchors[1]).toMatchObject({ x: 10, y: 0.5 })
  })
})

describe('subpathBounds', () => {
  it('measures the drawn curve rather than the control polygon', () => {
    // Handles reach y=30 but the curve itself only reaches y=22.5.
    const bounds = subpathBounds(parseSvgPathData('M 0 0 C 0 30 20 30 20 0'))
    expect(bounds.maxY).toBeCloseTo(22.5, 6)
    expect(bounds.minY).toBeCloseTo(0, 6)
    expect(bounds.width).toBeCloseTo(20, 6)
  })

  it('returns an empty box for geometry that draws nothing', () => {
    expect(subpathBounds([])).toEqual({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
    })
  })
})

describe('subpathToMaskVertices', () => {
  it('normalizes positions and handles into the same 0-1 item space', () => {
    const subpaths = parseSvgPathData('M 10 10 C 10 30 30 30 30 10')
    const vertices = subpathToMaskVertices(subpaths[0]!, subpathBounds(subpaths))
    expect(vertices[0]?.position[0]).toBeCloseTo(0, 6)
    expect(vertices[1]?.position[0]).toBeCloseTo(1, 6)
    // A 20-unit outgoing handle across a 20-wide, 15-tall box.
    expect(vertices[0]?.outHandle[1]).toBeCloseTo(20 / 15, 6)
  })

  it('collapses a degenerate axis instead of producing NaN', () => {
    const subpaths = parseSvgPathData('M 0 5 L 100 5')
    const vertices = subpathToMaskVertices(subpaths[0]!, subpathBounds(subpaths))
    expect(vertices.every((vertex) => Number.isFinite(vertex.position[1]))).toBe(true)
    expect(vertices.map((vertex) => vertex.position[1])).toEqual([0, 0])
  })

  it('marks handle-free anchors as corners and curved anchors as broken', () => {
    const subpaths = parseSvgPathData('M 0 0 L 10 0 C 10 10 20 10 20 0')
    const vertices = subpathToMaskVertices(subpaths[0]!, subpathBounds(subpaths))
    expect(vertices[0]?.tangentMode).toBe('corner')
    expect(vertices[1]?.tangentMode).toBe('broken')
  })
})

describe('parseSvgPathToVertices', () => {
  it('round-trips an open line outline back to the same path data', () => {
    expect(roundTrip('M 0 0 L 20 0 L 20 10')).toEqual(['M 0 0 L 20 0 L 20 10'])
  })

  it('re-emits a closed outline with its implied closing segment made explicit', () => {
    // `Z` already draws back to the start, so the extra `L 0 0` is the same
    // outline written out in full rather than a second edge.
    expect(roundTrip('M 0 0 L 20 0 L 20 10 Z')).toEqual(['M 0 0 L 20 0 L 20 10 L 0 0 Z'])
  })

  it('round-trips a cubic outline back to the same path data', () => {
    expect(roundTrip('M 0 0 C 0 20 20 20 20 0')).toEqual(['M 0 0 C 0 20 20 20 20 0'])
  })

  it('normalizes every subpath against one shared box so holes stay registered', () => {
    // An outer ring with an inner counter: the counter must stay centered, not
    // stretch to fill the full 0-1 box on its own.
    const paths = parseSvgPathToVertices(
      'M 0 0 L 40 0 L 40 40 L 0 40 Z M 10 10 L 30 10 L 30 30 L 10 30 Z',
    )
    expect(paths).toHaveLength(2)
    expect(paths[0]?.bounds).toEqual(paths[1]?.bounds)
    expect(paths[1]?.vertices.map((vertex) => vertex.position)).toEqual([
      [0.25, 0.25],
      [0.75, 0.25],
      [0.75, 0.75],
      [0.25, 0.75],
    ])
  })

  it('returns nothing for path data with no drawable geometry', () => {
    expect(parseSvgPathToVertices('M 1 1')).toEqual([])
  })
})
