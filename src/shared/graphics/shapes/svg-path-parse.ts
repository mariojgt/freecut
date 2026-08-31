import type { MaskVertex } from '@/types/masks'

/**
 * SVG path data -> editable cubic geometry.
 *
 * The inverse of `buildBezierPathData`: it turns an authored `d` string into the
 * anchor/handle model FreeCut already animates (`pathVertex:N:*` keyframes resolve
 * these in `animated-shape-item.ts`), so an imported SVG becomes an ordinary
 * `shapeType: 'path'` item with no new render path.
 *
 * Every command is normalized to cubics — lines keep zero handles so
 * `buildBezierPathData` re-emits them as `L`, and arcs are approximated by
 * <=90 degree cubic segments. Parsing is deterministic and DOM-free.
 */

/** One anchor with handles stored as offsets from the anchor, in user units. */
export interface SvgPathAnchor {
  x: number
  y: number
  inX: number
  inY: number
  outX: number
  outY: number
}

export interface SvgSubpath {
  anchors: SvgPathAnchor[]
  closed: boolean
}

export interface PathBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

const MAX_ARC_SEGMENT_ANGLE = Math.PI / 2
/** Anchors nearer than this collapse onto each other when a subpath closes. */
const COINCIDENT_EPSILON = 1e-9

function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 44
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57
}

function isCommand(char: string): boolean {
  return 'MmZzLlHhVvCcSsQqTtAa'.includes(char)
}

/**
 * Cursor over a `d` string.
 *
 * Hand-rolled rather than regex-tokenized because arc flags are single
 * characters that legally run together with the coordinate after them
 * (`a1 1 0 011 1`), which a number-shaped token pattern splits wrongly.
 */
class PathReader {
  private index = 0

  constructor(private readonly source: string) {}

  skipSeparators(): void {
    while (this.index < this.source.length && isWhitespace(this.source.charCodeAt(this.index))) {
      this.index++
    }
  }

  atEnd(): boolean {
    this.skipSeparators()
    return this.index >= this.source.length
  }

  /** Consume and return the next command letter, or null when a number is next. */
  readCommand(): string | null {
    this.skipSeparators()
    const char = this.source[this.index]
    if (char === undefined || !isCommand(char)) return null
    this.index++
    return char
  }

  readNumber(): number | null {
    this.skipSeparators()
    const start = this.index
    const { source } = this

    if (source[this.index] === '+' || source[this.index] === '-') this.index++
    let sawDigit = false
    while (this.index < source.length && isDigit(source.charCodeAt(this.index))) {
      this.index++
      sawDigit = true
    }
    if (source[this.index] === '.') {
      this.index++
      while (this.index < source.length && isDigit(source.charCodeAt(this.index))) {
        this.index++
        sawDigit = true
      }
    }
    if (!sawDigit) {
      this.index = start
      return null
    }
    if (source[this.index] === 'e' || source[this.index] === 'E') {
      const exponentStart = this.index
      this.index++
      if (source[this.index] === '+' || source[this.index] === '-') this.index++
      let sawExponentDigit = false
      while (this.index < source.length && isDigit(source.charCodeAt(this.index))) {
        this.index++
        sawExponentDigit = true
      }
      if (!sawExponentDigit) this.index = exponentStart
    }

    const parsed = Number.parseFloat(source.slice(start, this.index))
    return Number.isFinite(parsed) ? parsed : null
  }

  /** Arc flags are exactly one character, with no separator required after them. */
  readFlag(): 0 | 1 | null {
    this.skipSeparators()
    const char = this.source[this.index]
    if (char !== '0' && char !== '1') return null
    this.index++
    return char === '1' ? 1 : 0
  }
}

interface ParseState {
  x: number
  y: number
  startX: number
  startY: number
  /** Absolute second control point of the previous cubic, for `S`/`s` reflection. */
  lastCubicControlX: number | null
  lastCubicControlY: number | null
  /** Absolute control point of the previous quadratic, for `T`/`t` reflection. */
  lastQuadraticControlX: number | null
  lastQuadraticControlY: number | null
}

function anchor(x: number, y: number): SvgPathAnchor {
  return { x, y, inX: 0, inY: 0, outX: 0, outY: 0 }
}

/**
 * Approximate one elliptical arc with cubic segments.
 *
 * Endpoint-to-center parameterization per the SVG implementation notes, then a
 * standard `4/3 * tan(delta/4)` handle length per <=90 degree sweep.
 */
function arcToCubics(
  x1: number,
  y1: number,
  radiusX: number,
  radiusY: number,
  rotationDegrees: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
): Array<[number, number, number, number, number, number]> {
  if (radiusX === 0 || radiusY === 0) return [[x1, y1, x2, y2, x2, y2]]

  let rx = Math.abs(radiusX)
  let ry = Math.abs(radiusY)
  const phi = (rotationDegrees * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) {
    const scale = Math.sqrt(lambda)
    rx *= scale
    ry *= scale
  }

  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const factor =
    (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator) / (denominator || 1))
  const cxp = (factor * rx * y1p) / ry
  const cyp = (-factor * ry * x1p) / rx
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2

  const startAngle = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx)
  const endAngle = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx)
  let sweepAngle = endAngle - startAngle
  if (!sweep && sweepAngle > 0) sweepAngle -= Math.PI * 2
  if (sweep && sweepAngle < 0) sweepAngle += Math.PI * 2

  const segmentCount = Math.max(1, Math.ceil(Math.abs(sweepAngle) / MAX_ARC_SEGMENT_ANGLE))
  const delta = sweepAngle / segmentCount
  const handle = (4 / 3) * Math.tan(delta / 4)

  const pointAt = (angle: number): [number, number] => [
    cx + rx * Math.cos(angle) * cosPhi - ry * Math.sin(angle) * sinPhi,
    cy + rx * Math.cos(angle) * sinPhi + ry * Math.sin(angle) * cosPhi,
  ]
  const derivativeAt = (angle: number): [number, number] => [
    -rx * Math.sin(angle) * cosPhi - ry * Math.cos(angle) * sinPhi,
    -rx * Math.sin(angle) * sinPhi + ry * Math.cos(angle) * cosPhi,
  ]

  const cubics: Array<[number, number, number, number, number, number]> = []
  for (let segment = 0; segment < segmentCount; segment++) {
    const from = startAngle + segment * delta
    const to = from + delta
    const [fromX, fromY] = pointAt(from)
    const [toX, toY] = pointAt(to)
    const [fromDx, fromDy] = derivativeAt(from)
    const [toDx, toDy] = derivativeAt(to)
    cubics.push([
      fromX + handle * fromDx,
      fromY + handle * fromDy,
      toX - handle * toDx,
      toY - handle * toDy,
      toX,
      toY,
    ])
  }
  return cubics
}

/**
 * Parse `d` into absolute cubic subpaths.
 *
 * Malformed tails stop the walk and keep whatever parsed cleanly, so a partly
 * broken import still yields editable geometry instead of nothing.
 */
export function parseSvgPathData(d: string): SvgSubpath[] {
  const reader = new PathReader(d)
  const subpaths: SvgSubpath[] = []
  let current: SvgSubpath | null = null
  const state: ParseState = {
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    lastCubicControlX: null,
    lastCubicControlY: null,
    lastQuadraticControlX: null,
    lastQuadraticControlY: null,
  }
  let command: string | null = null

  const lastAnchor = (): SvgPathAnchor | null =>
    current && current.anchors.length > 0 ? current.anchors[current.anchors.length - 1]! : null

  const beginSubpath = (x: number, y: number): void => {
    current = { anchors: [anchor(x, y)], closed: false }
    subpaths.push(current)
    state.startX = x
    state.startY = y
  }

  /** Append one absolute cubic, storing its control points as anchor offsets. */
  const addCubic = (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => {
    if (!current) beginSubpath(state.x, state.y)
    const from = lastAnchor()
    if (!from) return
    from.outX = c1x - from.x
    from.outY = c1y - from.y
    const next = anchor(x, y)
    next.inX = c2x - x
    next.inY = c2y - y
    current!.anchors.push(next)
    state.x = x
    state.y = y
  }

  const addLine = (x: number, y: number): void => {
    if (!current) beginSubpath(state.x, state.y)
    current!.anchors.push(anchor(x, y))
    state.x = x
    state.y = y
  }

  while (!reader.atEnd()) {
    const next = reader.readCommand()
    if (next) {
      command = next
    } else if (!command) {
      break
    } else if (command === 'M') {
      command = 'L'
    } else if (command === 'm') {
      command = 'l'
    }

    const relative = command === command.toLowerCase()
    const code = command.toUpperCase()
    const originX = relative ? state.x : 0
    const originY = relative ? state.y : 0

    if (code === 'Z') {
      if (current) {
        closeSubpath(current, state.startX, state.startY)
        state.x = state.startX
        state.y = state.startY
        current = null
      }
      state.lastCubicControlX = null
      state.lastCubicControlY = null
      state.lastQuadraticControlX = null
      state.lastQuadraticControlY = null
      continue
    }

    if (code === 'M') {
      const x = reader.readNumber()
      const y = reader.readNumber()
      if (x === null || y === null) break
      beginSubpath(originX + x, originY + y)
      state.x = originX + x
      state.y = originY + y
      state.lastCubicControlX = null
      state.lastCubicControlY = null
      state.lastQuadraticControlX = null
      state.lastQuadraticControlY = null
      continue
    }

    if (code === 'L' || code === 'H' || code === 'V') {
      let x: number
      let y: number
      if (code === 'H') {
        const value = reader.readNumber()
        if (value === null) break
        x = originX + value
        y = state.y
      } else if (code === 'V') {
        const value = reader.readNumber()
        if (value === null) break
        x = state.x
        y = originY + value
      } else {
        const readX = reader.readNumber()
        const readY = reader.readNumber()
        if (readX === null || readY === null) break
        x = originX + readX
        y = originY + readY
      }
      addLine(x, y)
      state.lastCubicControlX = null
      state.lastCubicControlY = null
      state.lastQuadraticControlX = null
      state.lastQuadraticControlY = null
      continue
    }

    if (code === 'C' || code === 'S') {
      let c1x: number
      let c1y: number
      if (code === 'S') {
        // Reflect the previous cubic's trailing control point about the current point.
        c1x = state.lastCubicControlX === null ? state.x : 2 * state.x - state.lastCubicControlX
        c1y = state.lastCubicControlY === null ? state.y : 2 * state.y - state.lastCubicControlY
      } else {
        const readX = reader.readNumber()
        const readY = reader.readNumber()
        if (readX === null || readY === null) break
        c1x = originX + readX
        c1y = originY + readY
      }
      const c2xRead = reader.readNumber()
      const c2yRead = reader.readNumber()
      const xRead = reader.readNumber()
      const yRead = reader.readNumber()
      if (c2xRead === null || c2yRead === null || xRead === null || yRead === null) break
      const c2x = originX + c2xRead
      const c2y = originY + c2yRead
      addCubic(c1x, c1y, c2x, c2y, originX + xRead, originY + yRead)
      state.lastCubicControlX = c2x
      state.lastCubicControlY = c2y
      state.lastQuadraticControlX = null
      state.lastQuadraticControlY = null
      continue
    }

    if (code === 'Q' || code === 'T') {
      const fromX = state.x
      const fromY = state.y
      let qx: number
      let qy: number
      if (code === 'T') {
        // Reflect the previous quadratic control point about the current point.
        qx = state.lastQuadraticControlX === null ? fromX : 2 * fromX - state.lastQuadraticControlX
        qy = state.lastQuadraticControlY === null ? fromY : 2 * fromY - state.lastQuadraticControlY
      } else {
        const readX = reader.readNumber()
        const readY = reader.readNumber()
        if (readX === null || readY === null) break
        qx = originX + readX
        qy = originY + readY
      }
      const xRead = reader.readNumber()
      const yRead = reader.readNumber()
      if (xRead === null || yRead === null) break
      const x = originX + xRead
      const y = originY + yRead
      // Exact quadratic -> cubic elevation.
      addCubic(
        fromX + (2 / 3) * (qx - fromX),
        fromY + (2 / 3) * (qy - fromY),
        x + (2 / 3) * (qx - x),
        y + (2 / 3) * (qy - y),
        x,
        y,
      )
      state.lastQuadraticControlX = qx
      state.lastQuadraticControlY = qy
      state.lastCubicControlX = null
      state.lastCubicControlY = null
      continue
    }

    if (code === 'A') {
      const rx = reader.readNumber()
      const ry = reader.readNumber()
      const rotation = reader.readNumber()
      const largeArc = reader.readFlag()
      const sweep = reader.readFlag()
      const xRead = reader.readNumber()
      const yRead = reader.readNumber()
      if (
        rx === null ||
        ry === null ||
        rotation === null ||
        largeArc === null ||
        sweep === null ||
        xRead === null ||
        yRead === null
      ) {
        break
      }
      const x = originX + xRead
      const y = originY + yRead
      for (const [c1x, c1y, c2x, c2y, endX, endY] of arcToCubics(
        state.x,
        state.y,
        rx,
        ry,
        rotation,
        largeArc,
        sweep,
        x,
        y,
      )) {
        addCubic(c1x, c1y, c2x, c2y, endX, endY)
      }
      state.lastCubicControlX = null
      state.lastCubicControlY = null
      state.lastQuadraticControlX = null
      state.lastQuadraticControlY = null
      continue
    }

    break
  }

  return subpaths.filter((subpath) => subpath.anchors.length > 1)
}

/**
 * Fold a closing anchor that lands back on the start into the first anchor.
 *
 * `buildBezierPathData` draws the wrap-around segment from the last anchor's
 * `outHandle` to the first anchor's `inHandle`, so a duplicated terminal anchor
 * would otherwise leave a zero-length segment that morphs and trims oddly.
 */
function closeSubpath(subpath: SvgSubpath, startX: number, startY: number): void {
  subpath.closed = true
  const anchors = subpath.anchors
  if (anchors.length < 2) return
  const last = anchors[anchors.length - 1]!
  const first = anchors[0]!
  if (
    Math.abs(last.x - startX) <= COINCIDENT_EPSILON &&
    Math.abs(last.y - startY) <= COINCIDENT_EPSILON
  ) {
    first.inX = last.inX
    first.inY = last.inY
    anchors.pop()
  }
}

/** Evaluate one cubic component at `t`. */
function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const inverse = 1 - t
  return (
    inverse * inverse * inverse * p0 +
    3 * inverse * inverse * t * p1 +
    3 * inverse * t * t * p2 +
    t * t * t * p3
  )
}

/** Extend `range` to cover one cubic component exactly, via its derivative roots. */
function extendByCubic(
  range: { min: number; max: number },
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): void {
  range.min = Math.min(range.min, p0, p3)
  range.max = Math.max(range.max, p0, p3)

  const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3)
  const b = 6 * (p0 - 2 * p1 + p2)
  const c = 3 * (p1 - p0)

  const consider = (t: number): void => {
    if (!(t > 0 && t < 1)) return
    const value = cubicAt(p0, p1, p2, p3, t)
    range.min = Math.min(range.min, value)
    range.max = Math.max(range.max, value)
  }

  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) consider(-c / b)
    return
  }
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return
  const root = Math.sqrt(discriminant)
  consider((-b + root) / (2 * a))
  consider((-b - root) / (2 * a))
}

/**
 * Tight bounding box of the drawn curve.
 *
 * Uses cubic extrema rather than the control polygon, so a curve whose handles
 * swing far outside the ink is not padded with empty space when it is placed
 * on the canvas.
 */
export function subpathBounds(subpaths: SvgSubpath[]): PathBounds {
  const xRange = { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
  const yRange = { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }

  for (const subpath of subpaths) {
    const { anchors, closed } = subpath
    if (anchors.length === 0) continue
    const segmentCount = closed ? anchors.length : anchors.length - 1
    if (segmentCount <= 0) {
      const only = anchors[0]!
      extendByCubic(xRange, only.x, only.x, only.x, only.x)
      extendByCubic(yRange, only.y, only.y, only.y, only.y)
      continue
    }
    for (let index = 0; index < segmentCount; index++) {
      const from = anchors[index]!
      const to = anchors[(index + 1) % anchors.length]!
      extendByCubic(xRange, from.x, from.x + from.outX, to.x + to.inX, to.x)
      extendByCubic(yRange, from.y, from.y + from.outY, to.y + to.inY, to.y)
    }
  }

  if (!Number.isFinite(xRange.min) || !Number.isFinite(yRange.min)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
  }
  return {
    minX: xRange.min,
    minY: yRange.min,
    maxX: xRange.max,
    maxY: yRange.max,
    width: xRange.max - xRange.min,
    height: yRange.max - yRange.min,
  }
}

/**
 * Normalize absolute anchors into the 0-1 item space `pathVertices` uses.
 *
 * A degenerate axis (a perfectly horizontal rule, a single-column glyph) divides
 * by 1 instead of 0 so the path collapses onto that edge rather than becoming
 * `NaN` and vanishing from the render.
 */
export function subpathToMaskVertices(subpath: SvgSubpath, bounds: PathBounds): MaskVertex[] {
  const width = bounds.width || 1
  const height = bounds.height || 1
  return subpath.anchors.map((item) => ({
    position: [(item.x - bounds.minX) / width, (item.y - bounds.minY) / height],
    inHandle: [item.inX / width, item.inY / height],
    outHandle: [item.outX / width, item.outY / height],
    tangentMode:
      item.inX === 0 && item.inY === 0 && item.outX === 0 && item.outY === 0
        ? ('corner' as const)
        : ('broken' as const),
  }))
}

export interface ParsedSvgPath {
  vertices: MaskVertex[]
  closed: boolean
  /** Bounds of the whole `d`, so sibling subpaths keep their relative placement. */
  bounds: PathBounds
}

/**
 * Parse `d` into one entry per subpath, all normalized against the shared bounds.
 *
 * Sharing one box matters: a glyph's counter (the hole in an "o") has to stay
 * registered with its outer contour, which per-subpath normalization would
 * destroy by stretching each to fill 0-1 independently.
 */
export function parseSvgPathToVertices(d: string): ParsedSvgPath[] {
  const subpaths = parseSvgPathData(d)
  if (subpaths.length === 0) return []
  const bounds = subpathBounds(subpaths)
  return subpaths.map((subpath) => ({
    vertices: subpathToMaskVertices(subpath, bounds),
    closed: subpath.closed,
    bounds,
  }))
}
