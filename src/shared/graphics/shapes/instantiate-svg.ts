import type { ShapeItem, TimelineTrack } from '@/types/timeline'
import type { ImportedSvgDocument, SvgImportWarning } from './svg-document-import'

/**
 * Keep editable imports deliberately smaller than the parser's safety ceiling.
 * One SVG contour becomes one timeline item and one track, so an illustration
 * with thousands of contours would make the editor unusable even when parsing
 * it is technically safe.
 */
export const MAX_EDITABLE_SVG_PATHS = 120

export interface InstantiateSvgLayersOptions {
  name: string
  idPrefix: string
  from: number
  durationInFrames: number
  baseTrackOrder: number
  canvasWidth: number
  canvasHeight: number
  /** Fraction of the canvas the artwork may occupy. */
  fitRatio?: number
  /** Explicit document-unit to canvas-pixel scale (headless/API compatibility). */
  scale?: number
  /** Canvas-space offset from centre. */
  x?: number
  y?: number
}

export interface InstantiatedSvgLayers {
  tracks: TimelineTrack[]
  items: ShapeItem[]
  groupTrackId: string
  warnings: SvgImportWarning[]
}

function fitScale(
  document: ImportedSvgDocument,
  canvasWidth: number,
  canvasHeight: number,
  fitRatio: number,
): number {
  const { width, height } = document.viewBox
  if (width <= 0 || height <= 0) return 1
  const ratio = Math.max(0.05, Math.min(1, fitRatio))
  return Math.min((canvasWidth * ratio) / width, (canvasHeight * ratio) / height)
}

function compoundPathWarnings(document: ImportedSvgDocument): SvgImportWarning[] {
  if (!document.paths.some((path) => path.isHole)) return []
  return [
    {
      element: 'path',
      reason: 'Compound-path holes were imported as separate editable contours.',
    },
  ]
}

/**
 * Lower a parsed SVG document into ordinary FreeCut path items.
 *
 * This is intentionally pure: browser UI, headless editing and future AI tools
 * can all use the same geometry and painter-order conversion before deciding
 * how to commit it. Imported contours immediately inherit shape keyframes,
 * trim paths, effects, grouping, preview and export without a special renderer.
 */
export function instantiateSvgLayers(
  document: ImportedSvgDocument,
  options: InstantiateSvgLayersOptions,
): InstantiatedSvgLayers {
  if (document.paths.length === 0) {
    throw new Error('This SVG contains no supported editable vector paths.')
  }
  if (document.paths.length > MAX_EDITABLE_SVG_PATHS) {
    throw new Error(
      `This SVG contains ${document.paths.length} contours; editable imports support up to ${MAX_EDITABLE_SVG_PATHS}.`,
    )
  }

  const fit =
    options.scale !== undefined
      ? Math.max(0.0001, options.scale)
      : fitScale(document, options.canvasWidth, options.canvasHeight, options.fitRatio ?? 0.75)
  const offsetX = options.x ?? 0
  const offsetY = options.y ?? 0
  const groupTrackId = `${options.idPrefix}-group`

  const tracks: TimelineTrack[] = [
    {
      id: groupTrackId,
      name: options.name,
      kind: 'video',
      height: 40,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: options.baseTrackOrder,
      items: [],
      isGroup: true,
      isCollapsed: true,
    },
  ]
  const items: ShapeItem[] = []

  // Later SVG paths paint on top. FreeCut paints lower track orders in front,
  // so walk the source back-to-front when assigning the child stack.
  const frontToBack = [...document.paths].sort((left, right) => right.z - left.z)
  frontToBack.forEach((path, index) => {
    const trackId = `${path.id}-track`
    tracks.push({
      id: trackId,
      name: path.name,
      kind: 'video',
      height: 40,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: options.baseTrackOrder + index + 1,
      items: [],
      parentTrackId: groupTrackId,
    })
    items.push({
      id: path.id,
      trackId,
      type: 'shape',
      shapeType: 'path',
      from: options.from,
      durationInFrames: options.durationInFrames,
      label: path.name,
      pathVertices: path.vertices,
      pathClosed: path.closed,
      fillColor: path.fill ?? '#ffffff',
      fillEnabled: path.fillEnabled,
      ...(path.strokeEnabled && {
        strokeColor: path.stroke,
        strokeEnabled: true,
        strokeWidth: path.strokeWidth * fit,
      }),
      transform: {
        x:
          (path.bounds.minX +
            path.bounds.width / 2 -
            (document.viewBox.minX + document.viewBox.width / 2)) *
            fit +
          offsetX,
        y:
          (path.bounds.minY +
            path.bounds.height / 2 -
            (document.viewBox.minY + document.viewBox.height / 2)) *
            fit +
          offsetY,
        width: path.bounds.width * fit,
        height: path.bounds.height * fit,
        opacity: path.opacity,
        aspectRatioLocked: false,
      },
    })
  })

  return {
    tracks,
    items,
    groupTrackId,
    warnings: [...document.warnings, ...compoundPathWarnings(document)],
  }
}
