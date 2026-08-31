import type { BlockDefinition, GestureDefinition } from './types'
import { sampleGestureTrack } from './gesture-bake'
import { capsule, circle, ellipse } from './block-geometry'

/**
 * Lunar surface with Earth in the sky, built as six depth planes.
 *
 * Authored at 1920x1080 with the horizon at y = 720, so a character standing on
 * `walk-line` reads as standing on the ground. Every part declares a `depth`
 * from 0 (foreground) to 5 (far haze); the parallax gesture below scales its
 * travel by that plane, which is what separates a dolly from a flat slide.
 *
 * The surface is drawn wider than the artboard so a camera push or pan never
 * exposes an edge.
 */

const HORIZON = 720

/** A shallow rolling ridge: a wide arc capped into a filled silhouette. */
function ridge(y: number, height: number, from: number, to: number): string {
  const rx = (to - from) / 2
  return [
    `M ${from} ${y + height}`,
    `L ${from} ${y}`,
    `A ${rx} ${height} 0 0 1 ${to} ${y}`,
    `L ${to} ${y + height}`,
    'Z',
  ].join(' ')
}

export const MOON_SURFACE_BLOCK: BlockDefinition = {
  id: 'world-moon-surface',
  name: 'Lunar surface',
  category: 'world',
  width: 1920,
  height: 1080,
  slots: [
    { id: 'walk-line', label: 'Walking ground', at: [960, HORIZON + 40] },
    { id: 'sky', label: 'Sky', at: [960, 240] },
    { id: 'earth', label: 'Earth', at: [1480, 250] },
    { id: 'horizon', label: 'Horizon', at: [960, HORIZON] },
  ],
  gestures: ['parallax-pan', 'star-drift'],
  parts: [
    // --- depth 5: the void ---
    {
      id: 'sky',
      label: 'Sky',
      d: capsule(-200, -200, 2320, 1200, 0),
      fill: 'surfaceDeep',
      depth: 5,
      z: 0,
    },
    { id: 'star-a', label: 'Star A', d: circle(260, 150, 4), fill: 'glow', depth: 5, z: 1 },
    { id: 'star-b', label: 'Star B', d: circle(520, 300, 3), fill: 'glow', depth: 5, z: 1 },
    { id: 'star-c', label: 'Star C', d: circle(880, 120, 5), fill: 'glow', depth: 5, z: 1 },
    { id: 'star-d', label: 'Star D', d: circle(1180, 380, 3), fill: 'glow', depth: 5, z: 1 },
    { id: 'star-e', label: 'Star E', d: circle(1700, 200, 4), fill: 'glow', depth: 5, z: 1 },
    { id: 'star-f', label: 'Star F', d: circle(140, 470, 3), fill: 'glow', depth: 5, z: 1 },
    { id: 'star-g', label: 'Star G', d: circle(1400, 90, 3), fill: 'glow', depth: 5, z: 1 },

    // --- depth 4: Earth ---
    {
      id: 'earth',
      label: 'Earth',
      d: circle(1480, 250, 132),
      fill: 'primary',
      depth: 4,
      z: 2,
    },
    {
      id: 'earth-land',
      label: 'Earth landmass',
      parent: 'earth',
      d: ellipse(1440, 214, 52, 36),
      fill: 'secondary',
      depth: 4,
      z: 3,
    },
    {
      id: 'earth-land-south',
      label: 'Earth landmass south',
      parent: 'earth',
      d: ellipse(1524, 300, 40, 28),
      fill: 'secondary',
      depth: 4,
      z: 3,
    },
    {
      // A crescent of shadow, so the planet reads as a lit sphere rather than a disc.
      id: 'earth-terminator',
      label: 'Earth terminator',
      parent: 'earth',
      d: ellipse(1544, 250, 74, 132),
      fill: 'shadow',
      depth: 4,
      z: 4,
    },

    // --- depth 3-2: receding ridges ---
    {
      id: 'ridge-far',
      label: 'Far ridge',
      d: ridge(HORIZON - 78, 120, -260, 1180),
      fill: 'inkMuted',
      depth: 3,
      z: 5,
    },
    {
      id: 'ridge-mid',
      label: 'Mid ridge',
      d: ridge(HORIZON - 46, 110, 760, 2260),
      fill: 'inkMuted',
      depth: 2,
      z: 6,
    },

    // --- depth 1: the ground the character stands on ---
    {
      id: 'ground',
      label: 'Ground',
      d: capsule(-320, HORIZON, 2560, 480, 0),
      fill: 'surface',
      depth: 1,
      z: 7,
    },
    {
      id: 'crater-a',
      label: 'Crater A',
      parent: 'ground',
      d: ellipse(430, HORIZON + 130, 190, 34),
      fill: 'ink',
      depth: 1,
      z: 8,
    },
    {
      id: 'crater-b',
      label: 'Crater B',
      parent: 'ground',
      d: ellipse(1370, HORIZON + 96, 140, 26),
      fill: 'ink',
      depth: 1,
      z: 8,
    },
    {
      id: 'crater-c',
      label: 'Crater C',
      parent: 'ground',
      d: ellipse(900, HORIZON + 250, 250, 44),
      fill: 'ink',
      depth: 1,
      z: 8,
    },

    // --- depth 0: foreground, moving fastest ---
    {
      id: 'rock-near',
      label: 'Foreground rock',
      d: ridge(940, 160, -140, 300),
      fill: 'ink',
      depth: 0,
      z: 9,
    },
    {
      id: 'rock-near-right',
      label: 'Foreground rock right',
      d: ridge(990, 130, 1680, 2080),
      fill: 'ink',
      depth: 0,
      z: 9,
    },
  ],
}

/** Travel of the nearest plane across one pass, in block units. */
const PARALLAX_TRAVEL = 480
/** Depth 0 keeps full travel, depth 5 keeps this fraction. */
const FAR_PLANE_FACTOR = 0.06

/** Per-plane travel factor. Linear in depth, which reads correctly at these scales. */
export function parallaxFactorForDepth(depth: number): number {
  const clamped = Math.max(0, Math.min(5, depth))
  return 1 - (clamped / 5) * (1 - FAR_PLANE_FACTOR)
}

/**
 * Ground slides left under a character walking right.
 *
 * Not a loop: it is a one-pass camera move, so it holds its end pose rather than
 * snapping back. Each plane gets its own track scaled by depth.
 */
export const PARALLAX_PAN_GESTURE: GestureDefinition = {
  id: 'parallax-pan',
  name: 'Parallax pan',
  loop: false,
  tracks: MOON_SURFACE_BLOCK.parts
    // Parented parts inherit their parent's travel; animating them too would
    // double the motion and tear a crater off its ground plane.
    .filter((part) => !part.parent)
    .map((part) =>
      sampleGestureTrack(
        part.id,
        'x',
        4,
        (t) => -PARALLAX_TRAVEL * parallaxFactorForDepth(part.depth ?? 0) * t,
      ),
    ),
}

/** Slow twinkle. Ambient life that keeps a held frame from reading as a still. */
export const STAR_DRIFT_GESTURE: GestureDefinition = {
  id: 'star-drift',
  name: 'Star drift',
  loop: true,
  tracks: ['star-a', 'star-c', 'star-e', 'star-g'].map((partId, index) =>
    sampleGestureTrack(
      partId,
      'opacity',
      8,
      (t) =>
        // Staggered phase per star, so they do not pulse in lockstep.
        -0.35 * (0.5 - 0.5 * Math.cos(Math.PI * 2 * t + index * 1.3)),
    ),
  ),
}
