// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { PaletteRole } from './types'
import {
  BRAND_HUE,
  DEEP_SPACE_PALETTE,
  DEFAULT_SCENE_PALETTE,
  SCENE_PALETTES,
  createScenePalette,
  resolvePaletteRole,
} from './scene-palette'

const ROLES: PaletteRole[] = [
  'ink',
  'inkMuted',
  'surface',
  'surfaceDeep',
  'primary',
  'secondary',
  'accent',
  'highlight',
  'glow',
  'shadow',
]

const OKLCH = /^oklch\(\d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)?(?: \/ \d+(?:\.\d+)?)?\)$/

function lightnessOf(color: string): number {
  return Number.parseFloat(color.slice('oklch('.length))
}

describe('createScenePalette', () => {
  it('fills every role with a valid oklch colour', () => {
    for (const role of ROLES) {
      expect({ role, value: OKLCH.test(DEFAULT_SCENE_PALETTE[role]) }).toEqual({
        role,
        value: true,
      })
    }
  })

  it('defaults to the FreeCut brand hue so generated art matches the product', () => {
    expect(DEFAULT_SCENE_PALETTE).toEqual(createScenePalette({ hue: BRAND_HUE }))
    expect(DEFAULT_SCENE_PALETTE.primary).toContain(` ${BRAND_HUE})`)
  })

  it('separates the figure roles onto distinct hue families', () => {
    // One hue at one lightness across a whole illustration reads as mud.
    const hues = (['primary', 'secondary', 'accent'] as const).map((role) =>
      Number.parseFloat(DEFAULT_SCENE_PALETTE[role].split(' ')[2]!),
    )
    expect(new Set(hues).size).toBe(3)
  })

  it('keeps grounds darker than figures in a dark-key palette', () => {
    expect(lightnessOf(DEFAULT_SCENE_PALETTE.surfaceDeep)).toBeLessThan(
      lightnessOf(DEFAULT_SCENE_PALETTE.surface),
    )
    expect(lightnessOf(DEFAULT_SCENE_PALETTE.surface)).toBeLessThan(
      lightnessOf(DEFAULT_SCENE_PALETTE.primary),
    )
    expect(lightnessOf(DEFAULT_SCENE_PALETTE.glow)).toBeGreaterThan(
      lightnessOf(DEFAULT_SCENE_PALETTE.highlight),
    )
  })

  it('inverts only the ground when the key flips to light', () => {
    const light = createScenePalette({ hue: BRAND_HUE, key: 'light' })
    expect(lightnessOf(light.surface)).toBeGreaterThan(lightnessOf(DEFAULT_SCENE_PALETTE.surface))
    expect(light.primary).toBe(DEFAULT_SCENE_PALETTE.primary)
  })

  it('rotates the whole palette with the base hue', () => {
    const rotated = createScenePalette({ hue: BRAND_HUE + 100 })
    expect(rotated.primary).not.toBe(DEFAULT_SCENE_PALETTE.primary)
    expect(rotated.ink).not.toBe(DEFAULT_SCENE_PALETTE.ink)
  })

  it('wraps hues past a full turn instead of emitting an out-of-range angle', () => {
    expect(createScenePalette({ hue: 405 }).primary).toBe(createScenePalette({ hue: 45 }).primary)
    expect(createScenePalette({ hue: -315 }).primary).toBe(createScenePalette({ hue: 45 }).primary)
  })

  it('gives shadow an alpha so it reads over any ground', () => {
    expect(DEFAULT_SCENE_PALETTE.shadow).toContain(' / ')
  })

  it('holds chroma high enough for flat illustration', () => {
    const chroma = Number.parseFloat(DEFAULT_SCENE_PALETTE.primary.split(' ')[1]!)
    expect(chroma).toBeGreaterThan(0.1)
  })
})

describe('registered palettes', () => {
  it('exposes the brand and deep-space grounds', () => {
    expect(SCENE_PALETTES.brand).toBe(DEFAULT_SCENE_PALETTE)
    expect(SCENE_PALETTES['deep-space']).toBe(DEEP_SPACE_PALETTE)
  })

  it('keeps deep space cold against the warm brand', () => {
    const hueOf = (color: string) => Number.parseFloat(color.split(' ')[2]!)
    expect(hueOf(DEEP_SPACE_PALETTE.primary)).toBeGreaterThan(hueOf(DEFAULT_SCENE_PALETTE.primary))
  })
})

describe('resolvePaletteRole', () => {
  it('resolves a named role', () => {
    expect(resolvePaletteRole(DEFAULT_SCENE_PALETTE, 'primary')).toBe(DEFAULT_SCENE_PALETTE.primary)
  })

  it('falls back to ink rather than rendering nothing', () => {
    // A missing colour is a visible bug; a thrown error is a broken render.
    expect(resolvePaletteRole(DEFAULT_SCENE_PALETTE, undefined)).toBe(DEFAULT_SCENE_PALETTE.ink)
    expect(resolvePaletteRole(DEFAULT_SCENE_PALETTE, 'nope' as PaletteRole)).toBe(
      DEFAULT_SCENE_PALETTE.ink,
    )
  })
})
