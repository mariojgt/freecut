import { BLOCKS, GESTURES } from './registry'
import { SCENE_PALETTES } from './scene-palette'

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
      })),
      gestures: [...(block.gestures ?? [])],
    })),
    gestures: [...GESTURES.values()].map((gesture) => ({
      id: gesture.id,
      name: gesture.name,
      loop: gesture.loop,
      drives: [...new Set(gesture.tracks.map((track) => track.partId))],
    })),
    palettes: Object.keys(SCENE_PALETTES),
  }
}
