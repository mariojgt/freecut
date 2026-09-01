import { BLOCKS, GESTURES, POSES } from './registry'
import { SCENE_PALETTES } from './scene-palette'
import type { RigChannel } from './types'

/**
 * Serializable description of everything a generated scene may draw from.
 *
 * This is the model's view of the library. It carries ids, labels and the rig's
 * shape — never geometry — because an agent's job is to choose committed parts
 * and gestures, not to author paths. Derived from the registry at call time, so
 * it cannot describe a block that does not exist.
 */

export interface CatalogPart {
  id: string
  label: string
  /** Present when the part hangs off another; rotating a parent carries it. */
  parent?: string
  /** Painter's order within the block; higher draws in front. */
  z: number
  /** Parallax plane, 0 (foreground) to 5 (far haze). */
  depth?: number
}

export interface CatalogSlot {
  id: string
  label: string
  at: [number, number]
  /** Part attached content is parented to, so it travels with the rig. */
  partId?: string
}

/** A derived follower, so a caller can tell which parts move on their own. */
export interface CatalogSecondaryLink {
  id: string
  driverPartId: string
  followerPartId: string
  driverChannel: RigChannel
  followerChannel: RigChannel
}

export interface CatalogBlock {
  id: string
  name: string
  category: 'character' | 'world' | 'prop'
  width: number
  height: number
  parts: CatalogPart[]
  slots: CatalogSlot[]
  /** Gestures this block's rig can perform. */
  gestures: string[]
  /** Poses this block can be held in, selectable by id. */
  poses: string[]
  /**
   * Parts driven by other parts. Listed so a caller knows not to animate them
   * directly — a hand-authored curve would fight the derived one.
   */
  secondary: CatalogSecondaryLink[]
}

export interface CatalogPose {
  id: string
  name: string
  blockId: string
  /** Part ids this pose changes, so a caller can tell what it will move. */
  drives: string[]
}

export interface CatalogGesture {
  id: string
  name: string
  /** Loops repeat seamlessly and suit ambient life; one-shots play once. */
  loop: boolean
  /** Part ids this gesture drives, so a caller can tell what it will move. */
  drives: string[]
}

export interface BlockCatalog {
  blocks: CatalogBlock[]
  gestures: CatalogGesture[]
  poses: CatalogPose[]
  palettes: string[]
}

export function buildBlockCatalog(): BlockCatalog {
  return {
    blocks: [...BLOCKS.values()].map((block) => ({
      id: block.id,
      name: block.name,
      category: block.category,
      width: block.width,
      height: block.height,
      parts: block.parts.map((part) => ({
        id: part.id,
        label: part.label,
        ...(part.parent && { parent: part.parent }),
        z: part.z,
        ...(part.depth !== undefined && { depth: part.depth }),
      })),
      slots: (block.slots ?? []).map((slot) => ({
        id: slot.id,
        label: slot.label,
        at: [slot.at[0], slot.at[1]] as [number, number],
        ...(slot.partId && { partId: slot.partId }),
      })),
      gestures: [...(block.gestures ?? [])],
      poses: [...(block.poses ?? [])],
      secondary: (block.secondary ?? []).map((link) => ({
        id: link.id,
        driverPartId: link.driverPartId,
        followerPartId: link.followerPartId,
        driverChannel: link.driverChannel,
        followerChannel: link.followerChannel,
      })),
    })),
    gestures: [...GESTURES.values()].map((gesture) => ({
      id: gesture.id,
      name: gesture.name,
      loop: gesture.loop,
      drives: [...new Set(gesture.tracks.map((track) => track.partId))],
    })),
    poses: [...POSES.values()].map((pose) => ({
      id: pose.id,
      name: pose.name,
      blockId: pose.blockId,
      drives: [...new Set(pose.channels.map((channel) => channel.partId))],
    })),
    palettes: Object.keys(SCENE_PALETTES),
  }
}
