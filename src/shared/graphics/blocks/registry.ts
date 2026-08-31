import type { BlockDefinition, GestureDefinition } from './types'
import {
  ASTRONAUT_BLOCK,
  IDLE_BREATH_GESTURE,
  WALK_GESTURE,
  WAVE_GESTURE,
} from './character-astronaut'
import { MOON_SURFACE_BLOCK, PARALLAX_PAN_GESTURE, STAR_DRIFT_GESTURE } from './world-moon'

/**
 * The catalog a generated scene may draw from.
 *
 * This registry is the boundary that keeps generated animation on-style: a
 * request resolves to committed blocks and gestures by id, and anything not
 * listed here simply cannot appear in a frame.
 */

const BLOCK_LIST: BlockDefinition[] = [ASTRONAUT_BLOCK, MOON_SURFACE_BLOCK]
const GESTURE_LIST: GestureDefinition[] = [
  WALK_GESTURE,
  IDLE_BREATH_GESTURE,
  WAVE_GESTURE,
  PARALLAX_PAN_GESTURE,
  STAR_DRIFT_GESTURE,
]

export const BLOCKS: ReadonlyMap<string, BlockDefinition> = new Map(
  BLOCK_LIST.map((block) => [block.id, block]),
)

export const GESTURES: ReadonlyMap<string, GestureDefinition> = new Map(
  GESTURE_LIST.map((gesture) => [gesture.id, gesture]),
)

export function getBlock(id: string): BlockDefinition | undefined {
  return BLOCKS.get(id)
}

export function getGesture(id: string): GestureDefinition | undefined {
  return GESTURES.get(id)
}

export function listBlocks(category?: BlockDefinition['category']): BlockDefinition[] {
  const all = [...BLOCKS.values()]
  return category ? all.filter((block) => block.category === category) : all
}

/**
 * Ordered parts, parents before children.
 *
 * Instantiation depends on this: a `transformParent` binding cannot be created
 * until the parent item exists, so the caller needs a safe creation order rather
 * than the authoring order.
 */
export function partsInHierarchyOrder(block: BlockDefinition): BlockDefinition['parts'] {
  const byId = new Map(block.parts.map((part) => [part.id, part]))
  const ordered: BlockDefinition['parts'] = []
  const placed = new Set<string>()

  const place = (partId: string, seen: Set<string>): void => {
    if (placed.has(partId) || seen.has(partId)) return
    const part = byId.get(partId)
    if (!part) return
    seen.add(partId)
    if (part.parent) place(part.parent, seen)
    if (placed.has(partId)) return
    placed.add(partId)
    ordered.push(part)
  }

  for (const part of block.parts) place(part.id, new Set())
  return ordered
}

export interface BlockValidationIssue {
  blockId: string
  partId?: string
  message: string
}

/**
 * Structural check for a block and the gestures that claim to drive it.
 *
 * Run in tests and before any generated scene is committed, so a mistyped part
 * id fails loudly instead of producing a limb that silently never moves.
 */
export function validateBlock(
  block: BlockDefinition,
  gestures: readonly GestureDefinition[] = [],
): BlockValidationIssue[] {
  const issues: BlockValidationIssue[] = []
  const ids = new Set<string>()

  for (const part of block.parts) {
    if (ids.has(part.id)) {
      issues.push({ blockId: block.id, partId: part.id, message: 'Duplicate part id.' })
    }
    ids.add(part.id)
  }

  for (const part of block.parts) {
    if (part.parent && !ids.has(part.parent)) {
      issues.push({
        blockId: block.id,
        partId: part.id,
        message: `Parent "${part.parent}" is not a part of this block.`,
      })
    }
    if (part.depth !== undefined && (part.depth < 0 || part.depth > 5)) {
      issues.push({
        blockId: block.id,
        partId: part.id,
        message: 'Depth must be between 0 and 5.',
      })
    }
  }

  // A parenting cycle would make the transform hierarchy unresolvable.
  const byId = new Map(block.parts.map((part) => [part.id, part]))
  for (const part of block.parts) {
    const seen = new Set<string>([part.id])
    let cursor = part.parent
    while (cursor) {
      if (seen.has(cursor)) {
        issues.push({
          blockId: block.id,
          partId: part.id,
          message: 'Parent chain forms a cycle.',
        })
        break
      }
      seen.add(cursor)
      cursor = byId.get(cursor)?.parent
    }
  }

  for (const gestureId of block.gestures ?? []) {
    const gesture = gestures.find((candidate) => candidate.id === gestureId)
    if (!gesture) {
      issues.push({ blockId: block.id, message: `Gesture "${gestureId}" is not registered.` })
      continue
    }
    for (const track of gesture.tracks) {
      if (!ids.has(track.partId)) {
        issues.push({
          blockId: block.id,
          message: `Gesture "${gestureId}" targets unknown part "${track.partId}".`,
        })
      }
    }
  }

  return issues
}
