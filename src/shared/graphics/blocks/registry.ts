import type { BlockDefinition, GestureDefinition, PoseDefinition } from './types'
import {
  ASTRONAUT_BLOCK,
  ASTRONAUT_POSES,
  IDLE_BREATH_GESTURE,
  LAND_SQUASH_GESTURE,
  WALK_GESTURE,
  WAVE_GESTURE,
} from './character-astronaut'
import {
  STICK_FIGURE_BLOCK,
  STICK_FIGURE_GESTURES,
  STICK_FIGURE_POSES,
} from './character-stick-figure'
import { MOON_SURFACE_BLOCK, PARALLAX_PAN_GESTURE, STAR_DRIFT_GESTURE } from './world-moon'
import { UI_BLOCKS, UI_GESTURES, UI_POSES } from './explainer-ui'
import { BACKEND_BLOCKS, BACKEND_GESTURES, BACKEND_POSES } from './explainer-backend'

/**
 * The catalog a generated scene may draw from.
 *
 * This registry is the boundary that keeps generated animation on-style: a
 * request resolves to committed blocks and gestures by id, and anything not
 * listed here simply cannot appear in a frame.
 */

const BLOCK_LIST: BlockDefinition[] = [
  ASTRONAUT_BLOCK,
  STICK_FIGURE_BLOCK,
  MOON_SURFACE_BLOCK,
  ...UI_BLOCKS,
  ...BACKEND_BLOCKS,
]
const GESTURE_LIST: GestureDefinition[] = [
  WALK_GESTURE,
  IDLE_BREATH_GESTURE,
  WAVE_GESTURE,
  LAND_SQUASH_GESTURE,
  ...STICK_FIGURE_GESTURES,
  PARALLAX_PAN_GESTURE,
  STAR_DRIFT_GESTURE,
  ...UI_GESTURES,
  ...BACKEND_GESTURES,
]
const POSE_LIST: PoseDefinition[] = [
  ...ASTRONAUT_POSES,
  ...STICK_FIGURE_POSES,
  ...UI_POSES,
  ...BACKEND_POSES,
]

export const BLOCKS: ReadonlyMap<string, BlockDefinition> = new Map(
  BLOCK_LIST.map((block) => [block.id, block]),
)

export const GESTURES: ReadonlyMap<string, GestureDefinition> = new Map(
  GESTURE_LIST.map((gesture) => [gesture.id, gesture]),
)

export const POSES: ReadonlyMap<string, PoseDefinition> = new Map(
  POSE_LIST.map((pose) => [pose.id, pose]),
)

export function getBlock(id: string): BlockDefinition | undefined {
  return BLOCKS.get(id)
}

export function getGesture(id: string): GestureDefinition | undefined {
  return GESTURES.get(id)
}

export function getPose(id: string): PoseDefinition | undefined {
  return POSES.get(id)
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

function validateUniqueIds(block: BlockDefinition): BlockValidationIssue[] {
  const issues: BlockValidationIssue[] = []
  const seen = new Set<string>()
  for (const part of block.parts) {
    if (seen.has(part.id)) {
      issues.push({ blockId: block.id, partId: part.id, message: 'Duplicate part id.' })
    }
    seen.add(part.id)
  }
  return issues
}

/**
 * Whether each part would actually paint something.
 *
 * A part with neither fill nor stroke resolves to a correctly-sized, visible,
 * completely unpainted item — it passes every geometry check and draws nothing,
 * which is the hardest kind of missing artwork to notice.
 */
function validatePartPaint(block: BlockDefinition): BlockValidationIssue[] {
  const issues: BlockValidationIssue[] = []
  for (const part of block.parts) {
    if (!part.fill && !part.stroke) {
      issues.push({
        blockId: block.id,
        partId: part.id,
        message: 'Part declares neither a fill nor a stroke, so it would draw nothing.',
      })
    }
    if (part.opacity !== undefined && (part.opacity < 0 || part.opacity > 1)) {
      issues.push({
        blockId: block.id,
        partId: part.id,
        message: 'Rest opacity must be between 0 and 1.',
      })
    }
  }
  return issues
}

function validatePartPlacement(block: BlockDefinition, ids: Set<string>): BlockValidationIssue[] {
  const issues: BlockValidationIssue[] = []
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
  return issues
}

/** A parenting cycle would make the transform hierarchy unresolvable. */
function validateHierarchy(block: BlockDefinition): BlockValidationIssue[] {
  const issues: BlockValidationIssue[] = []
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
  return issues
}

function validateGestures(
  block: BlockDefinition,
  ids: Set<string>,
  gestures: readonly GestureDefinition[],
): BlockValidationIssue[] {
  const issues: BlockValidationIssue[] = []
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

function validatePoses(
  block: BlockDefinition,
  ids: Set<string>,
  poses: readonly PoseDefinition[],
): BlockValidationIssue[] {
  const issues: BlockValidationIssue[] = []
  for (const poseId of block.poses ?? []) {
    const pose = poses.find((candidate) => candidate.id === poseId)
    if (!pose) {
      issues.push({ blockId: block.id, message: `Pose "${poseId}" is not registered.` })
      continue
    }
    if (pose.blockId !== block.id) {
      issues.push({
        blockId: block.id,
        message: `Pose "${poseId}" was authored for block "${pose.blockId}".`,
      })
    }
    for (const channel of pose.channels) {
      if (!ids.has(channel.partId)) {
        issues.push({
          blockId: block.id,
          message: `Pose "${poseId}" targets unknown part "${channel.partId}".`,
        })
      }
    }
  }
  return issues
}

/**
 * Slots.
 *
 * A slot whose part was mistyped silently stops parenting, so an attached prop
 * sits at a fixed canvas position while the rig moves away from it — visible only
 * in motion, which is exactly the kind of fault worth catching at load.
 */
function validateSlots(block: BlockDefinition, ids: Set<string>): BlockValidationIssue[] {
  const issues: BlockValidationIssue[] = []
  for (const slot of block.slots ?? []) {
    if (slot.partId && !ids.has(slot.partId)) {
      issues.push({
        blockId: block.id,
        message: `Slot "${slot.id}" names unknown part "${slot.partId}".`,
      })
    }
  }
  return issues
}

/** Derived followers. */
function validateSecondary(block: BlockDefinition, ids: Set<string>): BlockValidationIssue[] {
  const issues: BlockValidationIssue[] = []
  const links = block.secondary ?? []
  const drivers = new Set(links.map((link) => link.driverPartId))

  for (const link of links) {
    for (const [role, partId] of [
      ['driver', link.driverPartId],
      ['follower', link.followerPartId],
    ] as const) {
      if (!ids.has(partId)) {
        issues.push({
          blockId: block.id,
          message: `Secondary link "${link.id}" names unknown ${role} part "${partId}".`,
        })
      }
    }
    // A follower that is also a driver makes the compiled result depend on link
    // order, which would make the same project resolve differently across runs.
    if (drivers.has(link.followerPartId)) {
      issues.push({
        blockId: block.id,
        message: `Secondary link "${link.id}" drives "${link.followerPartId}", which is itself a driver; chains are not supported.`,
      })
    }
    if (link.lagSeconds < 0) {
      issues.push({
        blockId: block.id,
        message: `Secondary link "${link.id}" has a negative lag.`,
      })
    }
  }
  return issues
}

/**
 * Structural check for a block and everything that claims to drive it.
 *
 * Run in tests and before any generated scene is committed, so a mistyped part
 * id fails loudly instead of producing a limb that silently never moves.
 */
export function validateBlock(
  block: BlockDefinition,
  gestures: readonly GestureDefinition[] = [],
  poses: readonly PoseDefinition[] = [],
): BlockValidationIssue[] {
  const ids = new Set(block.parts.map((part) => part.id))
  return [
    ...validateUniqueIds(block),
    ...validatePartPaint(block),
    ...validatePartPlacement(block, ids),
    ...validateHierarchy(block),
    ...validateGestures(block, ids, gestures),
    ...validatePoses(block, ids, poses),
    ...validateSlots(block, ids),
    ...validateSecondary(block, ids),
  ]
}
