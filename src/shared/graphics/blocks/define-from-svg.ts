import { buildBezierPathData } from '../shapes/bezier-path'
import type { ImportedSvgDocument, ImportedSvgPath } from '../shapes/svg-document-import'
import { validateBlock } from './registry'
import type { BlockDefinition, BlockPart, BlockSlot, PaletteRole, SecondaryLink } from './types'

/**
 * Turn drawn artwork into a rig.
 *
 * `importSvg` already puts an SVG on the timeline, but as a flat pile of paths:
 * nothing is parented, nothing has a joint, and the only thing that can be
 * animated is each shape on its own. That is enough for a logo and useless for a
 * character — rotating an arm has to carry the forearm, and a scene that wants a
 * puppet cannot get one.
 *
 * This is the other half. The caller supplies the same SVG plus a rig: which
 * element is which part, what hangs off what, where the joints are, and which
 * palette role each part paints with. The result is an ordinary
 * `BlockDefinition`, so generated artwork reaches the timeline through exactly
 * the path committed artwork does and inherits the hierarchy, the palette,
 * secondary motion and the dopesheet.
 *
 * Parts are matched to elements by the SVG's own `id` attribute, because that is
 * the one identifier an author already controls and can read back.
 */

export interface SvgPartSpec {
  /** Part id inside the block. Gestures and poses target this. */
  id: string
  /** SVG element id to take geometry from. Defaults to the part id. */
  from?: string
  label?: string
  parent?: string
  /** Joint, in viewBox units. Absent means the part's bounding-box centre. */
  pivot?: [number, number]
  fill?: PaletteRole
  stroke?: PaletteRole
  strokeWidth?: number
  /** Painter's order. Defaults to the element's order in the document. */
  z?: number
  depth?: number
  opacity?: number
}

export interface DefineBlockFromSvgSpec {
  id: string
  name: string
  category: BlockDefinition['category']
  parts: SvgPartSpec[]
  slots?: BlockSlot[]
  secondary?: SecondaryLink[]
  gestures?: string[]
  poses?: string[]
}

export interface DefinedBlock {
  block: BlockDefinition
  /** Elements in the document that no part claimed. */
  unusedElements: string[]
}

/**
 * Rebuild a path in viewBox coordinates.
 *
 * The importer normalizes each path's vertices into its own bounding box, which
 * is what a shape item wants; a block part needs the shared coordinate space so
 * the parts sit in the right places relative to each other.
 */
function pathDataFor(path: ImportedSvgPath): string {
  return buildBezierPathData(path.vertices, path.bounds.width, path.bounds.height, path.closed, [
    path.bounds.minX,
    path.bounds.minY,
  ])
}

/**
 * The palette roles a part paints with.
 *
 * Falls back to the drawing's own paint when the spec names no role, because a
 * part with neither fill nor stroke draws nothing and `validateBlock` refuses it
 * — a spec that simply forgot to assign colours should still produce a rig.
 */
function resolvePartPaint(
  part: SvgPartSpec,
  path: ImportedSvgPath,
): { fill?: PaletteRole; stroke?: PaletteRole } {
  if (part.fill || part.stroke) {
    return {
      ...(part.fill && { fill: part.fill }),
      ...(part.stroke && { stroke: part.stroke }),
    }
  }
  if (path.fillEnabled) return { fill: 'primary' }
  if (path.strokeEnabled) return { stroke: 'ink' }
  // Nothing in the drawing either; `primary` keeps it visible rather than
  // letting the block fail validation for a shape the author clearly wanted.
  return { fill: 'primary' }
}

/**
 * One rig part, from its spec and the element it draws.
 *
 * A flat field mapping whose whole complexity score is the optional-field
 * spreads: every rig field is optional, and an absent one must stay absent
 * rather than becoming an explicit undefined.
 */
// fallow-ignore-next-line complexity
function toBlockPart(part: SvgPartSpec, path: ImportedSvgPath): BlockPart {
  return {
    id: part.id,
    label: part.label ?? path.name,
    d: pathDataFor(path),
    ...(part.parent && { parent: part.parent }),
    ...resolvePartPaint(part, path),
    ...(part.strokeWidth !== undefined && { strokeWidth: part.strokeWidth }),
    ...(part.pivot && { pivot: part.pivot }),
    ...(part.depth !== undefined && { depth: part.depth }),
    ...(part.opacity !== undefined && { opacity: part.opacity }),
    z: part.z ?? path.z,
  }
}

/** Index the document by element id, keeping the first of any duplicates. */
function indexByName(document: ImportedSvgDocument): Map<string, ImportedSvgPath> {
  const byName = new Map<string, ImportedSvgPath>()
  for (const path of document.paths) {
    if (!byName.has(path.name)) byName.set(path.name, path)
  }
  return byName
}

/**
 * Compile a rig spec against an imported document.
 *
 * Refuses rather than guesses. A part naming an element that is not in the
 * document is the single most likely authoring mistake, and silently dropping it
 * would produce a rig missing a limb — so the error names what was asked for and
 * lists what the document actually contains.
 */
export function buildBlockFromSvg(
  document: ImportedSvgDocument,
  spec: DefineBlockFromSvgSpec,
): DefinedBlock {
  if (spec.parts.length === 0) throw new Error('A block needs at least one part.')

  const byName = indexByName(document)
  const claimed = new Set<string>()
  const missing: string[] = []

  const parts: BlockPart[] = spec.parts.map((part, index) => {
    const elementId = part.from ?? part.id
    const path = byName.get(elementId)
    if (!path) {
      missing.push(elementId)
      // Placeholder geometry; the throw below happens before it can be used.
      return { id: part.id, label: part.label ?? part.id, d: '', z: index }
    }
    claimed.add(elementId)

    return toBlockPart(part, path)
  })

  if (missing.length > 0) {
    const available = [...byName.keys()].sort().join(', ')
    throw new Error(
      `The SVG has no element with id ${missing.map((id) => `"${id}"`).join(', ')}. ` +
        `Give each shape an id attribute and name it here. Available: ${available || '(none)'}.`,
    )
  }

  const { width, height } = document.viewBox
  const block: BlockDefinition = {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    // Parts carry viewBox coordinates, so the block's viewport is the viewBox.
    width,
    height,
    parts,
    ...(spec.slots?.length && { slots: spec.slots }),
    ...(spec.secondary?.length && { secondary: spec.secondary }),
    ...(spec.gestures?.length && { gestures: spec.gestures }),
    ...(spec.poses?.length && { poses: spec.poses }),
  }

  return {
    block,
    unusedElements: [...byName.keys()].filter((name) => !claimed.has(name)).sort(),
  }
}

/**
 * Structural check for a generated block.
 *
 * Runs the same validator committed artwork is held to, which is the point: a
 * rig invented at request time has no reviewer, so the rules are the only thing
 * standing between a mistyped parent and a limb that silently never moves.
 */
export function assertDefinedBlockIsSound(
  block: BlockDefinition,
  gestures: Parameters<typeof validateBlock>[1] = [],
  poses: Parameters<typeof validateBlock>[2] = [],
): void {
  const issues = validateBlock(block, gestures, poses)
  if (issues.length === 0) return
  throw new Error(
    `The rig for "${block.id}" is not sound:\n` +
      issues
        .map((issue) => `  - ${issue.partId ? `${issue.partId}: ` : ''}${issue.message}`)
        .join('\n'),
  )
}
