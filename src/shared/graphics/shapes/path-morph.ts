import type { MaskVertex } from '@/types/masks'
import { reversePathVertices, rotateClosedPathStart } from './bezier-path'

/**
 * Topology matching for path morphs.
 *
 * FreeCut already animates `pathVertex:N:*` per frame, so morphing one outline
 * into another needs no renderer work — only two vertex lists that agree on
 * count, winding and start point. Mismatch on any of those is what produces the
 * classic morph failures: vertices bunching into a corner, the shape spinning
 * inside out, or an edge whipping across the canvas.
 *
 * Everything here is pure and deterministic: the same two paths always align
 * the same way, so a morph re-baked later matches the one on screen.
 */

/** Above this, the O(n^2) start-point search is skipped for a linear alignment. */
const MAX_ALIGNMENT_SEARCH_VERTICES = 512

type Point = [number, number]

function lerpPoint(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

function cloneVertex(vertex: MaskVertex): MaskVertex {
  return {
    ...vertex,
    position: [...vertex.position] as Point,
    inHandle: [...vertex.inHandle] as Point,
    outHandle: [...vertex.outHandle] as Point,
  }
}

export function clonePath(vertices: readonly MaskVertex[]): MaskVertex[] {
  return vertices.map(cloneVertex)
}

function segmentCount(vertices: readonly MaskVertex[], closed: boolean): number {
  if (vertices.length < 2) return 0
  return closed ? vertices.length : vertices.length - 1
}

/**
 * Control-polygon length of one segment.
 *
 * An upper bound on true arc length, but monotonic in it and free of any
 * flattening — enough to pick which segment most deserves a new point.
 */
function segmentWeight(from: MaskVertex, to: MaskVertex): number {
  const p0 = from.position
  const p1: Point = [from.position[0] + from.outHandle[0], from.position[1] + from.outHandle[1]]
  const p2: Point = [to.position[0] + to.inHandle[0], to.position[1] + to.inHandle[1]]
  const p3 = to.position
  return (
    Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) +
    Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) +
    Math.hypot(p3[0] - p2[0], p3[1] - p2[1])
  )
}

/**
 * Insert a vertex at the midpoint of one segment, in place.
 *
 * De Casteljau subdivision, so the drawn outline is bit-for-bit the curve it
 * already was — this adds animation detail without editing the artwork.
 */
function splitSegment(vertices: MaskVertex[], index: number): void {
  const from = vertices[index]
  const to = vertices[(index + 1) % vertices.length]
  if (!from || !to) return

  const p0 = from.position
  const p1: Point = [from.position[0] + from.outHandle[0], from.position[1] + from.outHandle[1]]
  const p2: Point = [to.position[0] + to.inHandle[0], to.position[1] + to.inHandle[1]]
  const p3 = to.position

  const p01 = lerpPoint(p0, p1, 0.5)
  const p12 = lerpPoint(p1, p2, 0.5)
  const p23 = lerpPoint(p2, p3, 0.5)
  const p012 = lerpPoint(p01, p12, 0.5)
  const p123 = lerpPoint(p12, p23, 0.5)
  const midpoint = lerpPoint(p012, p123, 0.5)

  from.outHandle = [p01[0] - p0[0], p01[1] - p0[1]]
  to.inHandle = [p23[0] - p3[0], p23[1] - p3[1]]

  vertices.splice(index + 1, 0, {
    position: midpoint,
    inHandle: [p012[0] - midpoint[0], p012[1] - midpoint[1]],
    outHandle: [p123[0] - midpoint[0], p123[1] - midpoint[1]],
    tangentMode: 'continuous',
  })
}

/**
 * Grow a path to `targetCount` vertices without changing its shape.
 *
 * Each pass splits the currently longest segment, which spreads the added
 * vertices over the outline instead of stacking them on one edge.
 */
export function resamplePathVertices(
  vertices: readonly MaskVertex[],
  closed: boolean,
  targetCount: number,
): MaskVertex[] {
  const result = clonePath(vertices)
  if (result.length < 2 || targetCount <= result.length) return result

  while (result.length < targetCount) {
    const count = segmentCount(result, closed)
    if (count <= 0) break
    let longestIndex = 0
    let longestWeight = -1
    for (let index = 0; index < count; index++) {
      const weight = segmentWeight(result[index]!, result[(index + 1) % result.length]!)
      if (weight > longestWeight) {
        longestWeight = weight
        longestIndex = index
      }
    }
    splitSegment(result, longestIndex)
  }
  return result
}

/** Sum of squared vertex distances — the cost the alignment search minimizes. */
function pairCost(from: readonly MaskVertex[], to: readonly MaskVertex[]): number {
  let total = 0
  for (let index = 0; index < from.length; index++) {
    const a = from[index]!.position
    const b = to[index]!.position
    const dx = a[0] - b[0]
    const dy = a[1] - b[1]
    total += dx * dx + dy * dy
  }
  return total
}

export interface PathMorphAlignment {
  /** Source path, resampled to the shared vertex count. */
  from: MaskVertex[]
  /** Target path, resampled and rotated/reversed to line up with `from`. */
  to: MaskVertex[]
  /** True only when both inputs were closed; a morph cannot open a contour. */
  closed: boolean
  /** Vertices the target was rotated by. Always 0 for open paths. */
  startOffset: number
  /** Whether the target's winding was flipped to match the source. */
  reversed: boolean
}

/**
 * Pair two outlines up for morphing.
 *
 * Both are grown to a shared vertex count, then the target is rotated (closed
 * paths) and optionally reversed to whichever arrangement travels least. That
 * search is what stops a square-to-circle morph from rotating 90 degrees on its
 * way across.
 */
export function preparePathMorph(
  from: readonly MaskVertex[],
  fromClosed: boolean,
  to: readonly MaskVertex[],
  toClosed: boolean,
): PathMorphAlignment {
  // An open contour cannot become a closed one mid-morph without a visible
  // pop on the wrap-around segment, so the pair degrades to open.
  const closed = fromClosed && toClosed
  const targetCount = Math.max(from.length, to.length)
  const resampledFrom = resamplePathVertices(from, fromClosed, targetCount)
  const resampledTo = resamplePathVertices(to, toClosed, targetCount)

  if (resampledFrom.length < 2 || resampledTo.length < 2) {
    return {
      from: resampledFrom,
      to: resampledTo,
      closed,
      startOffset: 0,
      reversed: false,
    }
  }

  const candidates: Array<{ path: MaskVertex[]; startOffset: number; reversed: boolean }> = [
    { path: resampledTo, startOffset: 0, reversed: false },
  ]
  const reversedTo = reversePathVertices(resampledTo)
  candidates.push({ path: reversedTo, startOffset: 0, reversed: true })

  if (closed && resampledTo.length <= MAX_ALIGNMENT_SEARCH_VERTICES) {
    for (let offset = 1; offset < resampledTo.length; offset++) {
      candidates.push({
        path: rotateClosedPathStart(resampledTo, offset),
        startOffset: offset,
        reversed: false,
      })
      candidates.push({
        path: rotateClosedPathStart(reversedTo, offset),
        startOffset: offset,
        reversed: true,
      })
    }
  }

  let best = candidates[0]!
  let bestCost = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const cost = pairCost(resampledFrom, candidate.path)
    if (cost < bestCost) {
      bestCost = cost
      best = candidate
    }
  }

  return {
    from: resampledFrom,
    to: clonePath(best.path),
    closed,
    startOffset: best.startOffset,
    reversed: best.reversed,
  }
}

/** The six animatable components of one vertex, in `pathVertex:N:*` order. */
export interface PathVertexComponents {
  positionX: number
  positionY: number
  inX: number
  inY: number
  outX: number
  outY: number
}

/**
 * Flatten a path into the per-vertex component values the keyframe layer writes.
 *
 * Keeping this pure means the morph endpoints written into `pathVertex:*`
 * keyframes are computed the same way whether the caller is the editor, the
 * headless API, or a test.
 */
export function pathVertexComponents(vertices: readonly MaskVertex[]): PathVertexComponents[] {
  return vertices.map((vertex) => ({
    positionX: vertex.position[0],
    positionY: vertex.position[1],
    inX: vertex.inHandle[0],
    inY: vertex.inHandle[1],
    outX: vertex.outHandle[0],
    outY: vertex.outHandle[1],
  }))
}
