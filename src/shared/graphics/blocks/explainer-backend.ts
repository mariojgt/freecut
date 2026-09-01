import type { BlockDefinition, BlockPart, GestureDefinition, PoseDefinition } from './types'
import { bar, capsule, circle, ellipse, polygon } from './block-geometry'
import { fadeGesture } from './block-gestures'
import { sampleGestureTrack } from './gesture-bake'

/**
 * Server-side blocks, for the half of a system the user never sees.
 *
 * A login, a request, a token check — every technical explainer eventually has to
 * draw the back end, and it is always the same cast: a machine, a store, a thing
 * travelling between them, and a verdict. These are that cast, rigged so the
 * traffic is animated rather than implied by a static diagram.
 */

const TAU = Math.PI * 2

// ---------------------------------------------------------------------------
// Server rack
// ---------------------------------------------------------------------------

/** Blade y positions, so the LEDs and vents stay aligned to their blade. */
const BLADE_Y = [96, 336, 576] as const

const SERVER_RACK_BLOCK: BlockDefinition = {
  id: 'infra-server-rack',
  name: 'Server rack',
  category: 'prop',
  width: 620,
  height: 900,
  slots: [
    { id: 'front', label: 'Rack front', at: [310, 450], partId: 'chassis' },
    { id: 'topBlade', label: 'Top blade', at: [310, 166], partId: 'blade-1' },
    { id: 'inlet', label: 'Request inlet', at: [10, 450], partId: 'chassis' },
  ],
  gestures: ['rack-appear', 'rack-work', 'rack-hum'],
  parts: [
    { id: 'chassis', label: 'Chassis', d: capsule(0, 0, 620, 900, 22), fill: 'ink', z: 0 },
    ...BLADE_Y.flatMap((y, index): BlockPart[] => {
      const n = index + 1
      return [
        {
          id: `blade-${n}`,
          label: `Blade ${n}`,
          parent: 'chassis',
          d: capsule(40, y, 540, 200, 14),
          fill: 'inkMuted',
          z: 1 + index * 3,
        },
        {
          id: `vent-${n}`,
          label: `Vent ${n}`,
          parent: `blade-${n}`,
          d: bar(80, y + 150, 300, 14),
          fill: 'ink',
          z: 2 + index * 3,
        },
        {
          id: `led-${n}`,
          label: `LED ${n}`,
          parent: `blade-${n}`,
          d: circle(520, y + 44, 16),
          fill: 'secondary',
          z: 3 + index * 3,
        },
      ]
    }),
  ],
}

const RACK_APPEAR_GESTURE: GestureDefinition = fadeGesture(SERVER_RACK_BLOCK, {
  id: 'rack-appear',
  name: 'Rack appear',
})

/**
 * A machine under load.
 *
 * The three LEDs run out of phase deliberately: in phase they read as one light
 * blinking, out of phase they read as independent work happening.
 */
const RACK_WORK_GESTURE: GestureDefinition = {
  id: 'rack-work',
  name: 'Rack working',
  loop: true,
  tracks: BLADE_Y.map((_unused, index) =>
    sampleGestureTrack(
      `led-${index + 1}`,
      'opacity',
      12,
      (t) => -0.55 + 0.55 * Math.abs(Math.sin(TAU * t + index * 1.9)),
    ),
  ),
}

/** Idle life, so a held shot of the rack is not a still image. */
const RACK_HUM_GESTURE: GestureDefinition = {
  id: 'rack-hum',
  name: 'Rack hum',
  loop: true,
  tracks: [sampleGestureTrack('chassis', 'y', 8, (t) => -1.6 * Math.sin(TAU * t))],
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/**
 * The stacked-disc cylinder everyone reads as a database.
 *
 * Drawn back to front — body, then each disc over it — because a cylinder's
 * silhouette only works if the near rims occlude the body.
 */
const DATABASE_BLOCK: BlockDefinition = {
  id: 'infra-database',
  name: 'Database',
  category: 'prop',
  width: 620,
  height: 700,
  slots: [
    { id: 'body', label: 'Store body', at: [310, 380], partId: 'body' },
    { id: 'top', label: 'Top disc', at: [310, 150], partId: 'disc-top' },
  ],
  gestures: ['database-appear', 'database-read', 'database-write'],
  parts: [
    { id: 'body', label: 'Body', d: capsule(50, 150, 520, 400, 0), fill: 'inkMuted', z: 0 },
    {
      id: 'disc-bottom',
      label: 'Bottom rim',
      parent: 'body',
      d: ellipse(310, 550, 260, 84),
      // Matches the body so the bottom reads as one silhouette, not a saucer.
      fill: 'inkMuted',
      z: 1,
    },
    {
      id: 'disc-middle',
      label: 'Middle rim',
      parent: 'body',
      d: ellipse(310, 400, 260, 84),
      fill: 'ink',
      z: 2,
    },
    {
      id: 'disc-upper',
      label: 'Upper rim',
      parent: 'body',
      d: ellipse(310, 260, 260, 84),
      fill: 'ink',
      z: 3,
    },
    {
      id: 'disc-top',
      label: 'Top disc',
      parent: 'body',
      d: ellipse(310, 150, 260, 90),
      fill: 'primary',
      z: 4,
    },
    {
      id: 'query-glow',
      label: 'Query glow',
      parent: 'disc-top',
      d: ellipse(310, 150, 260, 90),
      fill: 'glow',
      z: 5,
      opacity: 0,
    },
  ],
}

const DATABASE_APPEAR_GESTURE: GestureDefinition = fadeGesture(DATABASE_BLOCK, {
  id: 'database-appear',
  name: 'Database appear',
})

/** A lookup: one pulse of the top plate, no deformation. */
const DATABASE_READ_GESTURE: GestureDefinition = {
  id: 'database-read',
  name: 'Database read',
  loop: false,
  tracks: [
    {
      partId: 'query-glow',
      channel: 'opacity',
      keyframes: [
        { at: 0, value: -1, easing: 'ease-out' },
        { at: 0.3, value: -0.45, easing: 'ease-out' },
        { at: 1, value: -1, easing: 'ease-in-out' },
      ],
    },
    {
      partId: 'disc-top',
      channel: 'scale',
      keyframes: [
        { at: 0, value: 0, easing: 'ease-out' },
        { at: 0.3, value: 0.035, easing: 'ease-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
  ],
}

/**
 * A write, which lands rather than pulses.
 *
 * The whole stack compresses and recovers, so a write reads as heavier than a
 * read even though both are one beat long.
 */
const DATABASE_WRITE_GESTURE: GestureDefinition = {
  id: 'database-write',
  name: 'Database write',
  loop: false,
  tracks: [
    {
      partId: 'body',
      channel: 'scaleY',
      keyframes: [
        { at: 0, value: 0, easing: 'ease-out' },
        { at: 0.28, value: -0.05, easing: 'ease-out' },
        { at: 0.62, value: 0.018, easing: 'ease-in-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
    {
      partId: 'body',
      channel: 'scaleX',
      keyframes: [
        { at: 0, value: 0, easing: 'ease-out' },
        { at: 0.28, value: 0.038, easing: 'ease-out' },
        { at: 0.62, value: -0.014, easing: 'ease-in-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
    {
      partId: 'query-glow',
      channel: 'opacity',
      keyframes: [
        { at: 0, value: -1, easing: 'ease-out' },
        { at: 0.28, value: -0.25, easing: 'ease-out' },
        { at: 1, value: -1, easing: 'ease-in-out' },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Session token
// ---------------------------------------------------------------------------

const TOKEN_CARD_BLOCK: BlockDefinition = {
  id: 'infra-token-card',
  name: 'Session token',
  category: 'prop',
  width: 540,
  height: 340,
  slots: [{ id: 'centre', label: 'Card centre', at: [270, 170], partId: 'card' }],
  gestures: ['token-issue', 'token-travel', 'token-appear'],
  parts: [
    {
      id: 'card',
      label: 'Card',
      d: capsule(0, 0, 540, 340, 26),
      fill: 'accent',
      // Stated rather than left to the bounding box: the card turns, and a
      // derived centre would drift if a payload line were ever resized.
      pivot: [270, 170],
      z: 0,
    },
    {
      id: 'stripe',
      label: 'Signature stripe',
      parent: 'card',
      d: capsule(0, 74, 540, 46, 0),
      fill: 'ink',
      z: 1,
    },
    {
      id: 'payload-1',
      label: 'Payload line 1',
      parent: 'card',
      d: bar(48, 168, 380, 18),
      fill: 'ink',
      z: 2,
    },
    {
      id: 'payload-2',
      label: 'Payload line 2',
      parent: 'card',
      d: bar(48, 210, 300, 18),
      fill: 'ink',
      z: 2,
    },
    {
      id: 'payload-3',
      label: 'Payload line 3',
      parent: 'card',
      d: bar(48, 252, 220, 18),
      fill: 'ink',
      z: 2,
    },
  ],
}

const TOKEN_APPEAR_GESTURE: GestureDefinition = fadeGesture(TOKEN_CARD_BLOCK, {
  id: 'token-appear',
  name: 'Token appear',
})

/** Minted: a pop with a small settle rotation, so it reads as handed over. */
const TOKEN_ISSUE_GESTURE: GestureDefinition = {
  id: 'token-issue',
  name: 'Token issued',
  loop: false,
  tracks: [
    {
      partId: 'card',
      channel: 'scale',
      keyframes: [
        { at: 0, value: -0.85, easing: 'ease-out' },
        { at: 0.55, value: 0.06, easing: 'ease-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
    {
      partId: 'card',
      channel: 'rotation',
      keyframes: [
        { at: 0, value: -14, easing: 'ease-out' },
        { at: 0.6, value: 3, easing: 'ease-in-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
  ],
}

/**
 * A token in transit.
 *
 * Authored as a loop so it can be retimed to any leg of a journey, with the tilt
 * leading the travel — an object that turns into its direction reads as thrown
 * rather than slid.
 */
const TOKEN_TRAVEL_GESTURE: GestureDefinition = {
  id: 'token-travel',
  name: 'Token in transit',
  loop: true,
  tracks: [
    sampleGestureTrack('card', 'y', 12, (t) => -18 * Math.sin(TAU * t)),
    sampleGestureTrack('card', 'rotation', 12, (t) => 5 * Math.cos(TAU * t)),
  ],
}

// ---------------------------------------------------------------------------
// Flow arrow
// ---------------------------------------------------------------------------

/**
 * A request, drawn as an arrow.
 *
 * The shaft and head are separate parts so the shaft can stretch while the head
 * keeps its shape — scaling one arrow-shaped path would fatten the point.
 */
const FLOW_ARROW_BLOCK: BlockDefinition = {
  id: 'infra-flow-arrow',
  name: 'Flow arrow',
  category: 'prop',
  width: 800,
  height: 200,
  slots: [
    { id: 'tail', label: 'Tail', at: [0, 100], partId: 'shaft' },
    { id: 'head', label: 'Head', at: [800, 100], partId: 'head' },
  ],
  gestures: ['arrow-draw', 'arrow-pulse', 'arrow-appear'],
  parts: [
    {
      id: 'shaft',
      label: 'Shaft',
      d: bar(0, 76, 620, 48),
      fill: 'primary',
      // Pivots at the tail so a stretch grows forward, the direction of travel.
      pivot: [0, 100],
      z: 0,
    },
    {
      id: 'head',
      label: 'Head',
      d: polygon([
        [600, 24],
        [800, 100],
        [600, 176],
      ]),
      fill: 'primary',
      pivot: [800, 100],
      z: 1,
    },
  ],
}

const ARROW_APPEAR_GESTURE: GestureDefinition = fadeGesture(FLOW_ARROW_BLOCK, {
  id: 'arrow-appear',
  name: 'Arrow appear',
})

/**
 * An arrow drawing itself from tail to head.
 *
 * The shaft stretches from nothing and the head arrives only once the shaft has
 * reached it — a head that fades in early looks detached from its own line.
 */
const ARROW_DRAW_GESTURE: GestureDefinition = {
  id: 'arrow-draw',
  name: 'Arrow draw',
  loop: false,
  tracks: [
    {
      partId: 'shaft',
      channel: 'scaleX',
      keyframes: [
        // Not -1: a factor of exactly -1 resolves the width to zero, which is a
        // degenerate shape rather than a short one. A sliver is visually
        // identical and stays a real box.
        { at: 0, value: -0.985, easing: 'ease-out' },
        { at: 0.7, value: 0, easing: 'ease-out' },
        { at: 1, value: 0, easing: 'ease-out' },
      ],
    },
    {
      partId: 'shaft',
      channel: 'opacity',
      keyframes: [
        { at: 0, value: -1, easing: 'ease-out' },
        { at: 0.12, value: 0, easing: 'ease-out' },
        { at: 1, value: 0, easing: 'ease-out' },
      ],
    },
    {
      partId: 'head',
      channel: 'opacity',
      keyframes: [
        { at: 0, value: -1, easing: 'ease-out' },
        { at: 0.62, value: -1, easing: 'ease-out' },
        { at: 0.78, value: 0, easing: 'ease-out' },
        { at: 1, value: 0, easing: 'ease-out' },
      ],
    },
    {
      partId: 'head',
      channel: 'scale',
      keyframes: [
        { at: 0, value: -0.4, easing: 'ease-out' },
        { at: 0.62, value: -0.4, easing: 'ease-out' },
        { at: 0.86, value: 0.08, easing: 'ease-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
  ],
}

/** Sustained traffic along an established route. */
const ARROW_PULSE_GESTURE: GestureDefinition = {
  id: 'arrow-pulse',
  name: 'Arrow pulse',
  loop: true,
  tracks: [
    sampleGestureTrack('shaft', 'opacity', 10, (t) => -0.4 + 0.4 * Math.abs(Math.sin(TAU * t))),
    sampleGestureTrack('head', 'scale', 10, (t) => 0.06 * Math.abs(Math.sin(TAU * t))),
  ],
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/**
 * The shield that carries a yes or a no.
 *
 * One block with two verdict marks rather than two blocks, so a scene can flip
 * the answer with a pose instead of swapping artwork mid-shot.
 */
const SHIELD_BADGE_BLOCK: BlockDefinition = {
  id: 'infra-shield-badge',
  name: 'Shield badge',
  category: 'prop',
  width: 500,
  height: 600,
  slots: [{ id: 'face', label: 'Shield face', at: [250, 280], partId: 'shield' }],
  gestures: ['shield-seal', 'shield-appear'],
  poses: ['verdict-pending', 'verdict-granted', 'verdict-denied'],
  parts: [
    {
      id: 'shield',
      label: 'Shield',
      // Straight shoulders into a point, which reads as a shield at any size.
      d: polygon([
        [250, 20],
        [470, 110],
        [470, 330],
        [250, 580],
        [30, 330],
        [30, 110],
      ]),
      fill: 'ink',
      // The badge tilts as it seals, so its turning point is explicit.
      pivot: [250, 300],
      z: 0,
    },
    {
      id: 'inner',
      label: 'Inner field',
      parent: 'shield',
      // A 10% inset about the shield's visual centre, which leaves a rim rather
      // than an outline — an inner field close to the edge reads as a hole and
      // loses the badge silhouette entirely.
      d: polygon([
        [250, 47],
        [448, 128],
        [448, 326],
        [250, 551],
        [52, 326],
        [52, 128],
      ]),
      fill: 'secondary',
      z: 1,
    },
    {
      id: 'check',
      label: 'Check mark',
      parent: 'inner',
      d: polygon([
        [150, 290],
        [216, 356],
        [352, 220],
        [386, 254],
        [216, 424],
        [116, 324],
      ]),
      fill: 'glow',
      z: 2,
      opacity: 0,
    },
    {
      id: 'cross-a',
      label: 'Cross stroke A',
      parent: 'inner',
      d: capsule(150, 268, 200, 36, 18),
      fill: 'glow',
      // Both strokes turn about the same centre, so they stay a crossing X.
      pivot: [250, 286],
      z: 3,
      opacity: 0,
    },
    {
      id: 'cross-b',
      label: 'Cross stroke B',
      parent: 'inner',
      d: capsule(150, 268, 200, 36, 18),
      fill: 'glow',
      pivot: [250, 286],
      z: 3,
      opacity: 0,
    },
  ],
}

const SHIELD_APPEAR_GESTURE: GestureDefinition = fadeGesture(SHIELD_BADGE_BLOCK, {
  id: 'shield-appear',
  name: 'Shield appear',
})

/** The verdict landing. */
const SHIELD_SEAL_GESTURE: GestureDefinition = {
  id: 'shield-seal',
  name: 'Shield seal',
  loop: false,
  tracks: [
    {
      partId: 'shield',
      channel: 'scale',
      keyframes: [
        { at: 0, value: -0.35, easing: 'ease-out' },
        { at: 0.5, value: 0.07, easing: 'ease-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
    {
      partId: 'shield',
      channel: 'rotation',
      keyframes: [
        { at: 0, value: -8, easing: 'ease-out' },
        { at: 0.55, value: 2, easing: 'ease-in-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
  ],
}

/**
 * The three answers.
 *
 * The cross strokes are rotated into an X by the pose rather than authored that
 * way, so both strokes share one path and one pivot.
 */
const SHIELD_POSES: PoseDefinition[] = [
  {
    id: 'verdict-pending',
    name: 'Pending',
    blockId: 'infra-shield-badge',
    channels: [],
  },
  {
    id: 'verdict-granted',
    name: 'Granted',
    blockId: 'infra-shield-badge',
    channels: [{ partId: 'check', channel: 'opacity', value: 1 }],
  },
  {
    id: 'verdict-denied',
    name: 'Denied',
    blockId: 'infra-shield-badge',
    channels: [
      { partId: 'cross-a', channel: 'opacity', value: 1 },
      { partId: 'cross-a', channel: 'rotation', value: 45 },
      { partId: 'cross-b', channel: 'opacity', value: 1 },
      { partId: 'cross-b', channel: 'rotation', value: -45 },
    ],
  },
]

export const BACKEND_BLOCKS: BlockDefinition[] = [
  SERVER_RACK_BLOCK,
  DATABASE_BLOCK,
  TOKEN_CARD_BLOCK,
  FLOW_ARROW_BLOCK,
  SHIELD_BADGE_BLOCK,
]

export const BACKEND_GESTURES: GestureDefinition[] = [
  RACK_APPEAR_GESTURE,
  RACK_WORK_GESTURE,
  RACK_HUM_GESTURE,
  DATABASE_APPEAR_GESTURE,
  DATABASE_READ_GESTURE,
  DATABASE_WRITE_GESTURE,
  TOKEN_APPEAR_GESTURE,
  TOKEN_ISSUE_GESTURE,
  TOKEN_TRAVEL_GESTURE,
  ARROW_APPEAR_GESTURE,
  ARROW_DRAW_GESTURE,
  ARROW_PULSE_GESTURE,
  SHIELD_APPEAR_GESTURE,
  SHIELD_SEAL_GESTURE,
]

export const BACKEND_POSES: PoseDefinition[] = [...SHIELD_POSES]
