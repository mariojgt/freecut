// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { parseSvgPathData, subpathBounds } from '../shapes/svg-path-parse'
import type { BlockDefinition } from './types'
import {
  BLOCKS,
  GESTURES,
  POSES,
  getBlock,
  getGesture,
  listBlocks,
  partsInHierarchyOrder,
  validateBlock,
} from './registry'

const allGestures = [...GESTURES.values()]
const allBlocks = [...BLOCKS.values()]
const allPoses = [...POSES.values()]

function blockWith(parts: BlockDefinition['parts']): BlockDefinition {
  return { id: 'test', name: 'Test', category: 'prop', width: 100, height: 100, parts }
}

const part = (id: string, parent?: string): BlockDefinition['parts'][number] => ({
  id,
  label: id,
  d: 'M 0 0 L 10 0 L 10 10 Z',
  // Painted, because an unpainted part is its own validation issue and these
  // fixtures are here to exercise the other rules in isolation.
  fill: 'ink',
  z: 0,
  ...(parent ? { parent } : {}),
})

describe('block registry', () => {
  it('resolves every registered block and gesture by id', () => {
    expect(getBlock('character-astronaut')?.category).toBe('character')
    expect(getBlock('world-moon-surface')?.category).toBe('world')
    expect(getGesture('walk')?.loop).toBe(true)
    expect(getBlock('does-not-exist')).toBeUndefined()
  })

  it('filters the catalog by category', () => {
    expect(listBlocks('character').map((block) => block.id)).toEqual(['character-astronaut'])
    expect(listBlocks()).toHaveLength(allBlocks.length)
  })

  it('reports no structural issues for any shipped block', () => {
    for (const block of allBlocks) {
      expect({ id: block.id, issues: validateBlock(block, allGestures, allPoses) }).toEqual({
        id: block.id,
        issues: [],
      })
    }
  })
})

describe('validateBlock', () => {
  it('rejects a parent that is not part of the block', () => {
    const issues = validateBlock(blockWith([part('arm', 'ghost')]))
    expect(issues.map((issue) => issue.message)).toEqual([
      'Parent "ghost" is not a part of this block.',
    ])
  })

  it('rejects duplicate part ids', () => {
    const issues = validateBlock(blockWith([part('arm'), part('arm')]))
    expect(issues.some((issue) => issue.message === 'Duplicate part id.')).toBe(true)
  })

  it('rejects a parent chain that loops back on itself', () => {
    const issues = validateBlock(blockWith([part('a', 'b'), part('b', 'a')]))
    expect(issues.some((issue) => issue.message === 'Parent chain forms a cycle.')).toBe(true)
  })

  it('rejects a depth outside the parallax planes', () => {
    const block = blockWith([{ ...part('rock'), depth: 9 }])
    expect(validateBlock(block).some((issue) => issue.message.includes('between 0 and 5'))).toBe(
      true,
    )
  })

  it('rejects a gesture that drives a part the block does not have', () => {
    const block: BlockDefinition = { ...blockWith([part('arm')]), gestures: ['walk'] }
    const issues = validateBlock(block, allGestures)
    expect(issues.some((issue) => issue.message.includes('unknown part'))).toBe(true)
  })

  it('rejects a part that would draw nothing', () => {
    // Correctly sized, correctly placed, visible — and completely unpainted.
    const bare = { id: 'ghostly', label: 'Ghostly', d: 'M 0 0 L 10 0 L 10 10 Z', z: 0 }
    expect(
      validateBlock(blockWith([bare])).some((issue) => issue.message.includes('draw nothing')),
    ).toBe(true)
  })

  it('accepts a part painted by stroke alone', () => {
    const outlined = {
      id: 'ring',
      label: 'Ring',
      d: 'M 0 0 L 10 0 L 10 10 Z',
      stroke: 'accent' as const,
      strokeWidth: 3,
      z: 0,
    }
    expect(validateBlock(blockWith([outlined]))).toEqual([])
  })

  it('rejects a rest opacity outside 0..1', () => {
    const block = blockWith([{ ...part('faded'), opacity: 4 }])
    expect(validateBlock(block).some((issue) => issue.message.includes('between 0 and 1'))).toBe(
      true,
    )
  })

  it('rejects a gesture id that is not registered', () => {
    const block: BlockDefinition = { ...blockWith([part('arm')]), gestures: ['moonwalk'] }
    expect(
      validateBlock(block, allGestures).some((issue) => issue.message.includes('not registered')),
    ).toBe(true)
  })
})

describe('partsInHierarchyOrder', () => {
  it('emits every parent before the parts that hang off it', () => {
    for (const block of allBlocks) {
      const ordered = partsInHierarchyOrder(block)
      expect(ordered).toHaveLength(block.parts.length)
      const seen = new Set<string>()
      for (const item of ordered) {
        if (item.parent) expect(seen.has(item.parent)).toBe(true)
        seen.add(item.id)
      }
    }
  })

  it('orders a child authored before its parent', () => {
    const ordered = partsInHierarchyOrder(blockWith([part('hand', 'arm'), part('arm')]))
    expect(ordered.map((item) => item.id)).toEqual(['arm', 'hand'])
  })

  it('does not hang on a cyclic chain', () => {
    const ordered = partsInHierarchyOrder(blockWith([part('a', 'b'), part('b', 'a')]))
    expect(ordered.map((item) => item.id).sort()).toEqual(['a', 'b'])
  })
})

describe('block artwork', () => {
  it('draws every part with parseable path data', () => {
    for (const block of allBlocks) {
      for (const item of block.parts) {
        const subpaths = parseSvgPathData(item.d)
        expect({ block: block.id, part: item.id, drawn: subpaths.length > 0 }).toEqual({
          block: block.id,
          part: item.id,
          drawn: true,
        })
      }
    }
  })

  it('gives every part finite, non-degenerate bounds', () => {
    for (const block of allBlocks) {
      for (const item of block.parts) {
        const bounds = subpathBounds(parseSvgPathData(item.d))
        expect({
          part: item.id,
          ok: Number.isFinite(bounds.width) && bounds.width > 0 && bounds.height > 0,
        }).toEqual({ part: item.id, ok: true })
      }
    }
  })

  it('gives every articulated character part an explicit joint', () => {
    // A limb pivoting on its bounding-box centre bends in the middle of the bone
    // instead of at the joint, so every part of an armature must state its pivot.
    // Props are held to the narrower rule below: for a card or a button the
    // bounding-box centre IS the right pivot, and restating it by hand on fifty
    // parts would be noise that hides the cases that matter.
    for (const block of allBlocks.filter((candidate) => candidate.category === 'character')) {
      const parents = new Set(block.parts.map((item) => item.parent).filter(Boolean))
      for (const item of block.parts) {
        if (!item.parent && !parents.has(item.id)) continue
        expect({
          part: `${block.id}/${item.id}`,
          hasPivot: item.pivot !== undefined || item.depth !== undefined,
        }).toEqual({ part: `${block.id}/${item.id}`, hasPivot: true })
      }
    }
  })

  it('gives every rotated part in a chain an explicit joint', () => {
    // The defect the rule above exists to catch, stated directly and applied to
    // every category: a part that turns while parented to something else swings
    // visibly wrong if its pivot was never chosen.
    for (const block of allBlocks) {
      // Scoped to the block's OWN gestures and poses: part ids are only unique
      // within a block, so a global set would let one block's rotated `card`
      // demand a pivot on an unrelated block's `card`.
      const rotated = new Set<string>()
      for (const gestureId of block.gestures ?? []) {
        for (const track of allGestures.find((entry) => entry.id === gestureId)?.tracks ?? []) {
          if (track.channel === 'rotation') rotated.add(track.partId)
        }
      }
      for (const poseId of block.poses ?? []) {
        for (const channel of allPoses.find((entry) => entry.id === poseId)?.channels ?? []) {
          if (channel.channel === 'rotation') rotated.add(channel.partId)
        }
      }

      const parents = new Set(block.parts.map((item) => item.parent).filter(Boolean))
      for (const item of block.parts) {
        // Only a part that both turns and sits in a hierarchy can swing wrong.
        if (!rotated.has(item.id)) continue
        if (!item.parent && !parents.has(item.id)) continue
        expect({
          part: `${block.id}/${item.id}`,
          hasPivot: item.pivot !== undefined,
        }).toEqual({ part: `${block.id}/${item.id}`, hasPivot: true })
      }
    }
  })

  it('keeps every named slot inside the block viewport', () => {
    for (const block of allBlocks) {
      for (const slot of block.slots ?? []) {
        expect({
          slot: slot.id,
          inside:
            slot.at[0] >= 0 &&
            slot.at[0] <= block.width &&
            slot.at[1] >= 0 &&
            slot.at[1] <= block.height,
        }).toEqual({ slot: slot.id, inside: true })
      }
    }
  })
})
