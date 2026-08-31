import type { MaskVertex } from '@/types/masks'
import type { PathBounds, SvgSubpath } from './svg-path-parse'
import { parseSvgPathData, subpathBounds, subpathToMaskVertices } from './svg-path-parse'

/**
 * SVG document -> FreeCut shape items.
 *
 * Every drawable element is flattened into one editable cubic contour so an
 * imported file becomes ordinary `shapeType: 'path'` items. Nothing here knows
 * about the renderer: it produces geometry and paint, and the caller decides
 * what to build from it.
 *
 * The importer is deliberately narrow about what it will read. Scripts, filters,
 * external references and embedded rasters are refused rather than partially
 * honoured, because a half-applied filter looks like a rendering bug rather than
 * an unsupported feature.
 */

/** Affine transform as [a, b, c, d, e, f]; x' = a*x + c*y + e. */
export type Matrix = readonly [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** Elements that are never drawn, whether or not they contain drawable children. */
const SKIPPED_TAGS = new Set([
  'script',
  'style',
  'foreignobject',
  'image',
  'use',
  'filter',
  'metadata',
  'clippath',
  'mask',
  'pattern',
  'marker',
  'symbol',
])

/** Refused with a warning, because dropping them silently loses content. */
const REPORTED_TAGS = new Set(['text', 'tspan', 'textpath', 'image', 'use'])

const MAX_SOURCE_BYTES = 4_000_000
const MAX_ELEMENTS = 4000

export interface SvgImportWarning {
  element: string
  reason: string
}

export interface ImportedSvgPath {
  /** Stable within one import, derived from document order. */
  id: string
  name: string
  vertices: MaskVertex[]
  closed: boolean
  /** Placement and size in viewBox user units, after transforms. */
  bounds: PathBounds
  fill?: string
  fillEnabled: boolean
  stroke?: string
  strokeWidth: number
  strokeEnabled: boolean
  opacity: number
  /**
   * A later subpath of a multi-contour element — usually a counter such as the
   * hole in an "o". A single shape item holds one contour, so the caller decides
   * whether to mask these or let them sit on top.
   */
  isHole: boolean
  /** Painter's order in the source document; lower draws first. */
  z: number
}

export interface ImportedSvgDocument {
  viewBox: { minX: number; minY: number; width: number; height: number }
  paths: ImportedSvgPath[]
  warnings: SvgImportWarning[]
}

function multiply(outer: Matrix, inner: Matrix): Matrix {
  return [
    outer[0] * inner[0] + outer[2] * inner[1],
    outer[1] * inner[0] + outer[3] * inner[1],
    outer[0] * inner[2] + outer[2] * inner[3],
    outer[1] * inner[2] + outer[3] * inner[3],
    outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
    outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
  ]
}

function toNumber(value: string | null | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Parse a `transform` attribute into a single matrix.
 *
 * Functions compose left to right, matching the spec: in
 * `translate(10) scale(2)` the scale applies to the geometry first.
 */
export function parseTransform(value: string | null | undefined): Matrix {
  if (!value) return IDENTITY
  let result: Matrix = IDENTITY
  for (const match of value.matchAll(
    /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g,
  )) {
    const args = (match[2] ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((part) => toNumber(part))
    const radians = (degrees: number) => (degrees * Math.PI) / 180
    let step: Matrix = IDENTITY
    switch (match[1]) {
      case 'matrix':
        if (args.length >= 6) {
          step = [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!]
        }
        break
      case 'translate':
        step = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0]
        break
      case 'scale': {
        const scaleX = args[0] ?? 1
        step = [scaleX, 0, 0, args[1] ?? scaleX, 0, 0]
        break
      }
      case 'rotate': {
        const angle = radians(args[0] ?? 0)
        const rotation: Matrix = [
          Math.cos(angle),
          Math.sin(angle),
          -Math.sin(angle),
          Math.cos(angle),
          0,
          0,
        ]
        // `rotate(a cx cy)` is a rotation about a point, not about the origin.
        step =
          args.length >= 3
            ? multiply(multiply([1, 0, 0, 1, args[1]!, args[2]!], rotation), [
                1,
                0,
                0,
                1,
                -args[1]!,
                -args[2]!,
              ])
            : rotation
        break
      }
      case 'skewX':
        step = [1, 0, Math.tan(radians(args[0] ?? 0)), 1, 0, 0]
        break
      case 'skewY':
        step = [1, Math.tan(radians(args[0] ?? 0)), 0, 1, 0, 0]
        break
      default:
        break
    }
    result = multiply(result, step)
  }
  return result
}

/**
 * Push a subpath through a matrix.
 *
 * Anchor positions take the full affine; handles are offsets, so they take only
 * the linear part — translating them too would drag every control point away
 * from its anchor and shear the curve.
 */
function transformSubpath(subpath: SvgSubpath, matrix: Matrix): SvgSubpath {
  const [a, b, c, d, e, f] = matrix
  return {
    closed: subpath.closed,
    anchors: subpath.anchors.map((anchor) => ({
      x: a * anchor.x + c * anchor.y + e,
      y: b * anchor.x + d * anchor.y + f,
      inX: a * anchor.inX + c * anchor.inY,
      inY: b * anchor.inX + d * anchor.inY,
      outX: a * anchor.outX + c * anchor.outY,
      outY: b * anchor.outX + d * anchor.outY,
    })),
  }
}

function styleDeclarations(element: Element): Map<string, string> {
  const raw = element.getAttribute('style') ?? ''
  const entries = new Map<string, string>()
  for (const declaration of raw.split(';')) {
    const separator = declaration.indexOf(':')
    if (separator < 0) continue
    const property = declaration.slice(0, separator).trim()
    const value = declaration.slice(separator + 1).trim()
    if (property && value) entries.set(property, value)
  }
  return entries
}

/** Presentation attributes lose to the `style` attribute, per CSS precedence. */
function presentation(element: Element, style: Map<string, string>, name: string): string | null {
  return style.get(name) ?? element.getAttribute(name)
}

interface Paint {
  fill?: string
  stroke?: string
  strokeWidth: number
  opacity: number
}

const INITIAL_PAINT: Paint = { fill: 'black', strokeWidth: 1, opacity: 1 }

function polylineToPathData(points: string, close: boolean): string {
  const values = points
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => toNumber(part))
  const parts: string[] = []
  for (let index = 0; index + 1 < values.length; index += 2) {
    parts.push(`${index === 0 ? 'M' : 'L'} ${values[index]} ${values[index + 1]}`)
  }
  if (parts.length === 0) return ''
  return close ? `${parts.join(' ')} Z` : parts.join(' ')
}

/** Rounded rect per the spec's rx/ry defaulting and clamping rules. */
function rectToPathData(element: Element): string {
  const x = toNumber(element.getAttribute('x'))
  const y = toNumber(element.getAttribute('y'))
  const width = toNumber(element.getAttribute('width'))
  const height = toNumber(element.getAttribute('height'))
  if (width <= 0 || height <= 0) return ''

  const rawRx = element.getAttribute('rx')
  const rawRy = element.getAttribute('ry')
  // An omitted radius mirrors the other; both omitted means square corners.
  let rx = rawRx === null ? toNumber(rawRy, 0) : toNumber(rawRx, 0)
  let ry = rawRy === null ? toNumber(rawRx, 0) : toNumber(rawRy, 0)
  rx = Math.min(Math.max(rx, 0), width / 2)
  ry = Math.min(Math.max(ry, 0), height / 2)

  if (rx === 0 || ry === 0) {
    return `M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`
  }
  return [
    `M ${x + rx} ${y}`,
    `L ${x + width - rx} ${y}`,
    `A ${rx} ${ry} 0 0 1 ${x + width} ${y + ry}`,
    `L ${x + width} ${y + height - ry}`,
    `A ${rx} ${ry} 0 0 1 ${x + width - rx} ${y + height}`,
    `L ${x + rx} ${y + height}`,
    `A ${rx} ${ry} 0 0 1 ${x} ${y + height - ry}`,
    `L ${x} ${y + ry}`,
    `A ${rx} ${ry} 0 0 1 ${x + rx} ${y}`,
    'Z',
  ].join(' ')
}

function elementToPathData(element: Element, tag: string): string {
  switch (tag) {
    case 'path':
      return element.getAttribute('d') ?? ''
    case 'rect':
      return rectToPathData(element)
    case 'circle': {
      const cx = toNumber(element.getAttribute('cx'))
      const cy = toNumber(element.getAttribute('cy'))
      const r = toNumber(element.getAttribute('r'))
      if (r <= 0) return ''
      return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`
    }
    case 'ellipse': {
      const cx = toNumber(element.getAttribute('cx'))
      const cy = toNumber(element.getAttribute('cy'))
      const rx = toNumber(element.getAttribute('rx'))
      const ry = toNumber(element.getAttribute('ry'))
      if (rx <= 0 || ry <= 0) return ''
      return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy} Z`
    }
    case 'line':
      return `M ${toNumber(element.getAttribute('x1'))} ${toNumber(element.getAttribute('y1'))} L ${toNumber(element.getAttribute('x2'))} ${toNumber(element.getAttribute('y2'))}`
    case 'polyline':
      return polylineToPathData(element.getAttribute('points') ?? '', false)
    case 'polygon':
      return polylineToPathData(element.getAttribute('points') ?? '', true)
    default:
      return ''
  }
}

/**
 * Collect gradient definitions so a `url(#id)` paint can fall back to a colour.
 *
 * FreeCut shapes carry a two-stop linear fill at most, so a multi-stop or radial
 * gradient cannot round-trip. Resolving to the first stop keeps the artwork
 * visible and legible while the warning tells the caller what was lost.
 */
function collectGradientStops(root: Element): Map<string, string> {
  const stops = new Map<string, string>()
  for (const gradient of root.querySelectorAll('linearGradient, radialGradient')) {
    const id = gradient.getAttribute('id')
    if (!id) continue
    const firstStop = gradient.querySelector('stop')
    if (!firstStop) continue
    const style = styleDeclarations(firstStop)
    const color = presentation(firstStop, style, 'stop-color')
    if (color) stops.set(id, color)
  }
  return stops
}

interface PaintResolution {
  color?: string
  warning?: string
}

function resolvePaint(value: string | null, gradients: Map<string, string>): PaintResolution {
  if (value === null) return {}
  const normalized = value.trim()
  if (normalized === '' || normalized.toLowerCase() === 'none') return { color: undefined }
  const reference = /^url\(\s*#([^)\s]+)\s*\)/.exec(normalized)
  if (reference) {
    const stop = gradients.get(reference[1]!)
    return stop
      ? { color: stop, warning: 'Gradient flattened to its first stop.' }
      : { color: undefined, warning: 'Unresolved paint reference; element left unpainted.' }
  }
  if (normalized.toLowerCase() === 'currentcolor') return { color: undefined }
  return { color: normalized }
}

export interface ImportSvgOptions {
  /** Prefix for generated path ids, so two imports never collide. */
  idPrefix?: string
}

/**
 * Walk an already-parsed SVG root.
 *
 * Kept separate from string parsing so a caller that already holds a document —
 * or one supplying a non-browser DOM — can be served by exporting this later.
 * Module-private until something actually needs it.
 */
function importSvgElement(root: Element, options: ImportSvgOptions = {}): ImportedSvgDocument {
  const { idPrefix = 'svg' } = options
  const paths: ImportedSvgPath[] = []
  const warnings: SvgImportWarning[] = []
  const gradients = collectGradientStops(root)
  const reported = new Set<string>()
  let visited = 0
  let order = 0

  const warn = (element: string, reason: string): void => {
    const key = `${element}:${reason}`
    if (reported.has(key)) return
    reported.add(key)
    warnings.push({ element, reason })
  }

  const walk = (element: Element, inherited: Paint, parentMatrix: Matrix): void => {
    const tag = element.localName.toLowerCase()
    if (tag === 'defs') return
    if (REPORTED_TAGS.has(tag)) {
      warn(tag, `<${tag}> is not vector geometry and was skipped.`)
      return
    }
    if (SKIPPED_TAGS.has(tag)) return
    if (++visited > MAX_ELEMENTS) {
      warn('svg', `Stopped after ${MAX_ELEMENTS} elements.`)
      return
    }

    const style = styleDeclarations(element)
    const matrix = multiply(parentMatrix, parseTransform(element.getAttribute('transform')))

    const fillResolution = resolvePaint(presentation(element, style, 'fill'), gradients)
    const strokeResolution = resolvePaint(presentation(element, style, 'stroke'), gradients)
    if (fillResolution.warning) warn(tag, fillResolution.warning)
    if (strokeResolution.warning) warn(tag, strokeResolution.warning)

    const paint: Paint = {
      fill: presentation(element, style, 'fill') === null ? inherited.fill : fillResolution.color,
      stroke:
        presentation(element, style, 'stroke') === null ? inherited.stroke : strokeResolution.color,
      strokeWidth: toNumber(presentation(element, style, 'stroke-width'), inherited.strokeWidth),
      // Group opacity compounds down the tree.
      opacity:
        inherited.opacity *
        Math.max(0, Math.min(1, toNumber(presentation(element, style, 'opacity'), 1))),
    }

    const pathData = elementToPathData(element, tag)
    if (pathData) {
      const subpaths = parseSvgPathData(pathData).map((subpath) =>
        transformSubpath(subpath, matrix),
      )
      const name = element.getAttribute('id') || element.getAttribute('aria-label') || tag
      subpaths.forEach((subpath, index) => {
        const bounds = subpathBounds([subpath])
        if (bounds.width <= 0 && bounds.height <= 0) return
        paths.push({
          id: `${idPrefix}-${order}-${index}`,
          name: subpaths.length > 1 ? `${name} ${index + 1}` : name,
          vertices: subpathToMaskVertices(subpath, bounds),
          closed: subpath.closed,
          bounds,
          fill: paint.fill,
          fillEnabled: Boolean(paint.fill),
          stroke: paint.stroke,
          strokeWidth: paint.strokeWidth,
          strokeEnabled: Boolean(paint.stroke) && paint.strokeWidth > 0,
          opacity: paint.opacity,
          isHole: index > 0,
          z: order,
        })
      })
      order++
    }

    for (const child of [...element.children]) walk(child, paint, matrix)
  }

  const rootStyle = styleDeclarations(root)
  const rootFill = resolvePaint(presentation(root, rootStyle, 'fill'), gradients)
  walk(
    root,
    {
      ...INITIAL_PAINT,
      fill: presentation(root, rootStyle, 'fill') === null ? INITIAL_PAINT.fill : rootFill.color,
    },
    IDENTITY,
  )

  return { viewBox: resolveViewBox(root, paths), paths, warnings }
}

/**
 * Determine the document's user-unit box.
 *
 * Falls back through viewBox, then width/height, then the union of the imported
 * geometry — an SVG with none of the three still has to land somewhere sane on
 * the canvas.
 */
function resolveViewBox(root: Element, paths: ImportedSvgPath[]): ImportedSvgDocument['viewBox'] {
  const raw = root.getAttribute('viewBox')
  if (raw) {
    const parts = raw
      .trim()
      .split(/[\s,]+/)
      .map((part) => toNumber(part))
    if (parts.length >= 4 && parts[2]! > 0 && parts[3]! > 0) {
      return { minX: parts[0]!, minY: parts[1]!, width: parts[2]!, height: parts[3]! }
    }
  }

  const width = toNumber(root.getAttribute('width'))
  const height = toNumber(root.getAttribute('height'))
  if (width > 0 && height > 0) return { minX: 0, minY: 0, width, height }

  if (paths.length === 0) return { minX: 0, minY: 0, width: 0, height: 0 }
  const minX = Math.min(...paths.map((path) => path.bounds.minX))
  const minY = Math.min(...paths.map((path) => path.bounds.minY))
  const maxX = Math.max(...paths.map((path) => path.bounds.maxX))
  const maxY = Math.max(...paths.map((path) => path.bounds.maxY))
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Parse and import SVG source text.
 *
 * Requires a `DOMParser`, which both the browser and the headless Chrome
 * harness provide.
 */
export function importSvgSource(
  source: string,
  options: ImportSvgOptions = {},
): ImportedSvgDocument {
  if (source.length > MAX_SOURCE_BYTES) {
    throw new Error('SVG is too large to import.')
  }
  if (typeof DOMParser === 'undefined') {
    throw new Error('No DOMParser available; use importSvgElement with a parsed document.')
  }
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = parsed.documentElement
  if (!root || parsed.querySelector('parsererror') || root.localName.toLowerCase() !== 'svg') {
    throw new Error('This file is not a valid SVG.')
  }
  return importSvgElement(root, options)
}
