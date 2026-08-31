// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { buildBlockCatalog } from './catalog'
import { BLOCKS, GESTURES } from './registry'
import { SCENE_PALETTES } from './scene-palette'

const catalog = buildBlockCatalog()

describe('buildBlockCatalog', () => {
  it('describes every registered block, gesture and palette', () => {
    expect(catalog.blocks.map((block) => block.id).sort()).toEqual([...BLOCKS.keys()].sort())
    expect(catalog.gestures.map((gesture) => gesture.id).sort()).toEqual(
      [...GESTURES.keys()].sort(),
    )
    expect(catalog.palettes.sort()).toEqual(Object.keys(SCENE_PALETTES).sort())
  })

  it('exposes every part so a caller can target a subset', () => {
    const astronaut = catalog.blocks.find((block) => block.id === 'character-astronaut')!
    expect(astronaut.parts).toHaveLength(BLOCKS.get('character-astronaut')!.parts.length)
    expect(astronaut.parts.map((part) => part.id)).toContain('boot-near')
  })

  it('carries the rig shape, so a caller knows what a parent moves', () => {
    const astronaut = catalog.blocks.find((block) => block.id === 'character-astronaut')!
    const shin = astronaut.parts.find((part) => part.id === 'shin-near')!
    expect(shin.parent).toBe('thigh-near')
    const torso = astronaut.parts.find((part) => part.id === 'torso')!
    expect(torso.parent).toBeUndefined()
  })

  it('publishes slots for placement', () => {
    const moon = catalog.blocks.find((block) => block.id === 'world-moon-surface')!
    expect(moon.slots.map((slot) => slot.id)).toContain('walk-line')
  })

  it('says which parts each gesture drives', () => {
    const walk = catalog.gestures.find((gesture) => gesture.id === 'walk')!
    expect(walk.loop).toBe(true)
    expect(walk.drives).toContain('thigh-near')
    // Deduplicated: the walk drives the torso on more than one channel.
    expect(new Set(walk.drives).size).toBe(walk.drives.length)
  })

  it('distinguishes looping ambience from one-shot actions', () => {
    expect(catalog.gestures.find((gesture) => gesture.id === 'wave')!.loop).toBe(false)
    expect(catalog.gestures.find((gesture) => gesture.id === 'idle-breath')!.loop).toBe(true)
  })

  it('never leaks geometry, which the model must not author', () => {
    const serialized = JSON.stringify(catalog)
    expect(serialized).not.toContain('"d"')
    expect(serialized).not.toContain(' A ')
  })

  it('survives a JSON round trip, since it crosses a process boundary', () => {
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog)
  })

  it('only names gestures that are registered', () => {
    const known = new Set(catalog.gestures.map((gesture) => gesture.id))
    for (const block of catalog.blocks) {
      for (const gestureId of block.gestures) {
        expect({ block: block.id, gestureId, known: known.has(gestureId) }).toEqual({
          block: block.id,
          gestureId,
          known: true,
        })
      }
    }
  })
})
