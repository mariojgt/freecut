// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
// The wire contract duplicates the catalog ids because it is plain Node and
// cannot import TypeScript. This test is the gate that keeps the copy honest —
// without it, adding a block would silently leave the API unable to place it.
// The contract is untyped Node ESM. Resolving it through a non-literal
// specifier keeps TypeScript out of it; a declaration file covering sixteen
// exports would be far more surface than this one test earns.
const CONTRACT_MODULE = '../../../../headless/lib/contract.mjs'
const { EDIT_OPERATION_NAMES, editOpSchema } = (await import(
  /* @vite-ignore */ CONTRACT_MODULE
)) as {
  EDIT_OPERATION_NAMES: string[]
  editOpSchema: { safeParse: (value: unknown) => { success: boolean } }
}
import { BLOCKS, GESTURES, POSES } from './registry'
import { SCENE_PALETTES } from './scene-palette'

const sample = (overrides: Record<string, unknown>) =>
  editOpSchema.safeParse({ op: 'addBlock', blockId: 'character-astronaut', ...overrides })

describe('catalog / wire contract', () => {
  it('accepts every registered block id', () => {
    for (const blockId of BLOCKS.keys()) {
      expect({ blockId, accepted: sample({ blockId }).success }).toEqual({
        blockId,
        accepted: true,
      })
    }
  })

  it('accepts every registered gesture id', () => {
    for (const gestureId of GESTURES.keys()) {
      expect({
        gestureId,
        accepted: sample({ gestures: [{ id: gestureId }] }).success,
      }).toEqual({ gestureId, accepted: true })
    }
  })

  it('accepts every registered pose id', () => {
    for (const poseId of POSES.keys()) {
      expect({
        poseId,
        accepted: editOpSchema.safeParse({
          op: 'applyPose',
          idPrefix: 'character-astronaut-abc',
          poses: [{ id: poseId }],
        }).success,
      }).toEqual({ poseId, accepted: true })
    }
  })

  it('accepts every registered palette id', () => {
    for (const palette of Object.keys(SCENE_PALETTES)) {
      expect({ palette, accepted: sample({ palette }).success }).toEqual({
        palette,
        accepted: true,
      })
    }
  })

  it('refuses ids the catalog does not contain', () => {
    expect(sample({ blockId: 'character-unicorn' }).success).toBe(false)
    expect(sample({ gestures: [{ id: 'moonwalk' }] }).success).toBe(false)
    expect(sample({ palette: 'neon' }).success).toBe(false)
    expect(
      editOpSchema.safeParse({
        op: 'applyPose',
        idPrefix: 'character-astronaut-abc',
        poses: [{ id: 'breakdance' }],
      }).success,
    ).toBe(false)
  })

  it('publishes the vector operations so capabilities advertises them', () => {
    for (const name of ['addBlock', 'applyGesture', 'importSvg', 'morphPath']) {
      expect({ name, published: EDIT_OPERATION_NAMES.includes(name) }).toEqual({
        name,
        published: true,
      })
    }
  })
})

describe('morphPath wire rules', () => {
  const morph = (overrides: Record<string, unknown>) =>
    editOpSchema.safeParse({
      op: 'morphPath',
      itemId: 'i',
      fromFrame: 0,
      toFrame: 30,
      ...overrides,
    })

  it('requires exactly one target', () => {
    expect(morph({ targetPathData: 'M 0 0 L 1 1' }).success).toBe(true)
    expect(morph({ targetItemId: 'j' }).success).toBe(true)
    // Both would be ambiguous; neither has nothing to morph toward.
    expect(morph({ targetItemId: 'j', targetPathData: 'M 0 0 L 1 1' }).success).toBe(false)
    expect(morph({}).success).toBe(false)
  })

  it('refuses a zero-length morph, which would write two keyframes on one frame', () => {
    expect(morph({ targetItemId: 'j', toFrame: 0 }).success).toBe(false)
  })
})
