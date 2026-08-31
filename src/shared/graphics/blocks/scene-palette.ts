import type { PaletteRole } from './types'

/**
 * Scene palettes for illustration blocks.
 *
 * Deliberately separate from the DESIGN.md chrome tokens: those describe a dark
 * instrument that recedes behind footage, while a scene palette is the artwork
 * itself and needs saturation and a light range the UI ramp does not carry.
 * Both are expressed in oklch so a hue rotation stays perceptually even.
 *
 * Blocks reference roles, never colours, so swapping the palette restyles a
 * whole cast without touching geometry.
 */

export type ScenePalette = Record<PaletteRole, string>

export interface ScenePaletteOptions {
  /** Base hue in degrees. FreeCut's brand primary sits at 45 (warm orange). */
  hue: number
  /** Chroma ceiling, 0..0.3. Flat illustration reads best held high. */
  chroma?: number
  /** `dark` keeps ink on a deep ground; `light` inverts the ground only. */
  key?: 'dark' | 'light'
}

const DEFAULT_CHROMA = 0.16
/** Complement and analogue offsets, in degrees, for the supporting roles. */
const SECONDARY_HUE_OFFSET = 165
const ACCENT_HUE_OFFSET = -55

function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360
}

function oklch(lightness: number, chroma: number, hue: number, alpha?: number): string {
  const l = Math.round(Math.max(0, Math.min(1, lightness)) * 1000) / 1000
  const c = Math.round(Math.max(0, chroma) * 1000) / 1000
  const h = Math.round(wrapHue(hue) * 10) / 10
  return alpha === undefined
    ? `oklch(${l} ${c} ${h})`
    : `oklch(${l} ${c} ${h} / ${Math.max(0, Math.min(1, alpha))})`
}

/**
 * Derive a full scene palette from one hue.
 *
 * Grounds stay near the base hue at low chroma so they read as atmosphere, while
 * the three figure roles fan out to distinct hue families — an illustration goes
 * muddy when every element shares one hue at one lightness.
 */
export function createScenePalette(options: ScenePaletteOptions): ScenePalette {
  const { hue, chroma = DEFAULT_CHROMA, key = 'dark' } = options
  const dark = key === 'dark'
  return {
    ink: oklch(dark ? 0.18 : 0.22, chroma * 0.25, hue),
    inkMuted: oklch(dark ? 0.34 : 0.4, chroma * 0.3, hue),
    surface: oklch(dark ? 0.26 : 0.86, chroma * 0.35, hue),
    surfaceDeep: oklch(dark ? 0.15 : 0.72, chroma * 0.3, hue),
    primary: oklch(0.68, chroma * 1.15, hue),
    secondary: oklch(0.6, chroma, hue + SECONDARY_HUE_OFFSET),
    accent: oklch(0.72, chroma * 1.05, hue + ACCENT_HUE_OFFSET),
    highlight: oklch(0.88, chroma * 0.5, hue),
    glow: oklch(0.96, chroma * 0.3, hue),
    // Shadow is a translucent multiply-ish wash rather than a solid, so it
    // reads over any ground the block is placed on.
    shadow: oklch(0.12, chroma * 0.2, hue, 0.45),
  }
}

/** FreeCut's brand hue, so generated artwork matches the product by default. */
export const BRAND_HUE = 45

/** Warm brand-aligned default. */
export const DEFAULT_SCENE_PALETTE: ScenePalette = createScenePalette({ hue: BRAND_HUE })

/** Cold, high-contrast ground for space and night exteriors. */
export const DEEP_SPACE_PALETTE: ScenePalette = createScenePalette({ hue: 265, chroma: 0.14 })

export const SCENE_PALETTES: Record<string, ScenePalette> = {
  brand: DEFAULT_SCENE_PALETTE,
  'deep-space': DEEP_SPACE_PALETTE,
}

/**
 * Resolve a part's paint role.
 *
 * Falls back to `ink` rather than throwing so a block authored against a newer
 * role still renders — a missing colour is a visible bug, a crashed frame is a
 * broken render.
 */
export function resolvePaletteRole(palette: ScenePalette, role: PaletteRole | undefined): string {
  if (!role) return palette.ink
  return palette[role] ?? palette.ink
}
