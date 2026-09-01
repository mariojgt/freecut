import type { BlockDefinition, GestureDefinition, PoseDefinition } from './types'
import { bar, capsule, circle, polygon } from './block-geometry'
import { fadeGesture, staggerGesture } from './block-gestures'

/**
 * Interface blocks, for explaining software with software.
 *
 * The subject of a technical explainer is usually a screen, and asking a model to
 * draw one produces a different browser every shot. These are the committed
 * version: a window, a form and a cursor, rigged so the states a UI actually has
 * — focused, filled, submitting, failed — are named poses rather than invented
 * coordinates.
 *
 * Every state that is not the default is authored at `opacity: 0`. Contributions
 * are relative and opacity is clamped, so a whole-block fade cannot reveal a
 * focus ring, and a pose reveals exactly what it names.
 */

// ---------------------------------------------------------------------------
// Browser window
// ---------------------------------------------------------------------------

const WINDOW_WIDTH = 1600
const WINDOW_HEIGHT = 1000

const BROWSER_WINDOW_BLOCK: BlockDefinition = {
  id: 'ui-browser-window',
  name: 'Browser window',
  category: 'prop',
  width: WINDOW_WIDTH,
  height: WINDOW_HEIGHT,
  slots: [
    // The page area, which is where a form or a diagram is attached.
    { id: 'viewport', label: 'Page viewport', at: [800, 540], partId: 'viewport' },
    { id: 'urlBar', label: 'Address bar', at: [790, 50], partId: 'url-bar' },
    { id: 'titleBar', label: 'Title bar', at: [800, 50], partId: 'chrome' },
  ],
  gestures: ['window-appear', 'window-dismiss', 'window-nudge'],
  parts: [
    // The frame is the rig root: scaling it carries the whole window, because
    // geometry IS inherited down the transform-parent chain even though opacity
    // is not.
    { id: 'frame', label: 'Frame', d: capsule(0, 0, 1600, 1000, 26), fill: 'ink', z: 0 },
    {
      id: 'chrome',
      label: 'Window chrome',
      parent: 'frame',
      d: capsule(8, 8, 1584, 984, 20),
      fill: 'highlight',
      z: 1,
    },
    {
      id: 'viewport',
      label: 'Page',
      parent: 'chrome',
      d: capsule(16, 92, 1568, 892, 12),
      fill: 'glow',
      z: 2,
    },
    {
      id: 'dot-close',
      label: 'Close',
      parent: 'chrome',
      d: circle(52, 50, 13),
      fill: 'accent',
      z: 3,
    },
    {
      id: 'dot-minimise',
      label: 'Minimise',
      parent: 'chrome',
      d: circle(92, 50, 13),
      fill: 'primary',
      z: 3,
    },
    {
      id: 'dot-maximise',
      label: 'Maximise',
      parent: 'chrome',
      d: circle(132, 50, 13),
      fill: 'secondary',
      z: 3,
    },
    {
      id: 'url-bar',
      label: 'Address bar',
      parent: 'chrome',
      d: bar(200, 30, 1180, 40),
      fill: 'glow',
      z: 3,
    },
    {
      id: 'url-padlock',
      label: 'TLS padlock',
      parent: 'url-bar',
      d: circle(224, 50, 9),
      fill: 'secondary',
      z: 4,
    },
    {
      id: 'url-text',
      label: 'Address text',
      parent: 'url-bar',
      d: bar(248, 43, 320, 14),
      fill: 'inkMuted',
      z: 4,
    },
  ],
}

/**
 * Compose a generated fade with hand-authored motion tracks.
 *
 * The fade has to be generated (one opacity track per part, since opacity is not
 * inherited) but the movement is authored, so the two are built separately and
 * joined here rather than restating either.
 */
function withFade(
  block: BlockDefinition,
  options: { id: string; name: string; direction?: 'in' | 'out' },
  motion: GestureDefinition['tracks'],
): GestureDefinition {
  const faded = fadeGesture(block, options)
  return { ...faded, tracks: [...faded.tracks, ...motion] }
}

/**
 * A window arriving.
 *
 * Scale is driven on the frame alone — the hierarchy carries the rest — while
 * opacity is driven per part. The slight overshoot past rest size is what stops
 * it reading as a dissolve.
 */
const WINDOW_APPEAR_GESTURE: GestureDefinition = withFade(
  BROWSER_WINDOW_BLOCK,
  { id: 'window-appear', name: 'Window appear' },
  [
    {
      partId: 'frame',
      channel: 'scale',
      keyframes: [
        { at: 0, value: -0.09, easing: 'ease-out' },
        { at: 0.72, value: 0.014, easing: 'ease-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
    {
      partId: 'frame',
      channel: 'y',
      keyframes: [
        { at: 0, value: 26, easing: 'ease-out' },
        { at: 1, value: 0, easing: 'ease-out' },
      ],
    },
  ],
)

const WINDOW_DISMISS_GESTURE: GestureDefinition = withFade(
  BROWSER_WINDOW_BLOCK,
  { id: 'window-dismiss', name: 'Window dismiss', direction: 'out' },
  [
    {
      partId: 'frame',
      channel: 'scale',
      keyframes: [
        { at: 0, value: 0, easing: 'ease-in' },
        { at: 1, value: -0.06, easing: 'ease-in' },
      ],
    },
  ],
)

/** Ambient life. A held shot of a static window reads as a screenshot. */
const WINDOW_NUDGE_GESTURE: GestureDefinition = {
  id: 'window-nudge',
  name: 'Window float',
  loop: true,
  tracks: [
    {
      partId: 'frame',
      channel: 'y',
      keyframes: [
        { at: 0, value: 0, easing: 'ease-in-out' },
        { at: 0.5, value: -7, easing: 'ease-in-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Login form
// ---------------------------------------------------------------------------

const LOGIN_FORM_BLOCK: BlockDefinition = {
  id: 'ui-login-form',
  name: 'Login form',
  category: 'prop',
  width: 700,
  height: 900,
  slots: [
    { id: 'emailField', label: 'Email field', at: [350, 294], partId: 'email-well' },
    { id: 'passwordField', label: 'Password field', at: [350, 448], partId: 'password-well' },
    { id: 'submitButton', label: 'Submit button', at: [350, 600], partId: 'submit-button' },
    { id: 'heading', label: 'Heading', at: [214, 100], partId: 'card' },
  ],
  gestures: ['form-appear', 'form-reveal', 'submit-press', 'form-reject'],
  poses: [
    'form-empty',
    'email-focused',
    'email-entered',
    'password-focused',
    'credentials-entered',
    'form-submitting',
    'form-rejected',
  ],
  parts: [
    { id: 'card', label: 'Card', d: capsule(0, 0, 700, 900, 34), fill: 'glow', z: 0 },
    { id: 'heading', label: 'Heading', parent: 'card', d: bar(64, 84, 300, 32), fill: 'ink', z: 1 },
    {
      id: 'subhead',
      label: 'Subheading',
      parent: 'card',
      d: bar(64, 140, 440, 16),
      fill: 'inkMuted',
      z: 1,
    },

    // --- Email ---
    {
      id: 'email-label',
      label: 'Email label',
      parent: 'card',
      d: bar(64, 228, 150, 14),
      fill: 'inkMuted',
      z: 2,
    },
    {
      id: 'email-well',
      label: 'Email input',
      parent: 'card',
      d: capsule(64, 258, 572, 72, 16),
      fill: 'highlight',
      z: 2,
    },
    {
      id: 'email-focus',
      label: 'Email focus ring',
      parent: 'email-well',
      d: capsule(58, 252, 584, 84, 20),
      stroke: 'accent',
      strokeWidth: 5,
      z: 3,
      opacity: 0,
    },
    {
      id: 'email-text',
      label: 'Email text',
      parent: 'email-well',
      d: bar(92, 285, 300, 18),
      fill: 'ink',
      z: 4,
      opacity: 0,
    },
    {
      id: 'email-caret',
      label: 'Email caret',
      parent: 'email-well',
      d: capsule(404, 278, 5, 32, 2),
      fill: 'accent',
      z: 4,
      opacity: 0,
    },

    // --- Password ---
    {
      id: 'password-label',
      label: 'Password label',
      parent: 'card',
      d: bar(64, 382, 190, 14),
      fill: 'inkMuted',
      z: 2,
    },
    {
      id: 'password-well',
      label: 'Password input',
      parent: 'card',
      d: capsule(64, 412, 572, 72, 16),
      fill: 'highlight',
      z: 2,
    },
    {
      id: 'password-focus',
      label: 'Password focus ring',
      parent: 'password-well',
      d: capsule(58, 406, 584, 84, 20),
      stroke: 'accent',
      strokeWidth: 5,
      z: 3,
      opacity: 0,
    },
    {
      id: 'password-dots',
      label: 'Password mask',
      parent: 'password-well',
      d: bar(92, 440, 216, 16),
      fill: 'ink',
      z: 4,
      opacity: 0,
    },

    // --- Action ---
    {
      id: 'submit-button',
      label: 'Submit button',
      parent: 'card',
      d: capsule(64, 560, 572, 80, 18),
      fill: 'primary',
      z: 2,
    },
    {
      id: 'submit-label',
      label: 'Submit label',
      parent: 'submit-button',
      d: bar(290, 590, 120, 20),
      fill: 'glow',
      z: 3,
    },
    {
      id: 'submit-spinner',
      label: 'Submit spinner',
      parent: 'submit-button',
      d: capsule(330, 586, 40, 28, 6),
      fill: 'glow',
      // Pivots at its own centre so a spin gesture turns rather than orbits.
      pivot: [350, 600],
      z: 4,
      opacity: 0,
    },

    // --- Failure ---
    {
      id: 'error-banner',
      label: 'Error banner',
      parent: 'card',
      d: capsule(64, 676, 572, 60, 14),
      fill: 'accent',
      z: 5,
      opacity: 0,
    },
    {
      id: 'error-text',
      label: 'Error text',
      parent: 'error-banner',
      d: bar(96, 698, 320, 16),
      fill: 'glow',
      z: 6,
      opacity: 0,
    },
  ],
}

/** Whole card in as one. */
const FORM_APPEAR_GESTURE: GestureDefinition = fadeGesture(LOGIN_FORM_BLOCK, {
  id: 'form-appear',
  name: 'Form appear',
})

/**
 * The card assembling itself, field by field.
 *
 * Only the parts that belong to the resting state are listed: a stagger over
 * every part would still leave the hidden ones hidden, but naming them would
 * imply they take a turn in the cascade.
 */
const FORM_REVEAL_GESTURE: GestureDefinition = staggerGesture(LOGIN_FORM_BLOCK, {
  id: 'form-reveal',
  name: 'Form reveal',
  partIds: [
    'card',
    'heading',
    'subhead',
    'email-label',
    'email-well',
    'password-label',
    'password-well',
    'submit-button',
    'submit-label',
  ],
  order: [
    'card',
    'heading',
    'subhead',
    'email-label',
    'email-well',
    'password-label',
    'password-well',
    'submit-button',
    'submit-label',
  ],
  step: 0.4,
  rise: 22,
})

/** A button taking a real press: down fast, back slower. */
const SUBMIT_PRESS_GESTURE: GestureDefinition = {
  id: 'submit-press',
  name: 'Submit press',
  loop: false,
  tracks: [
    {
      partId: 'submit-button',
      channel: 'scale',
      keyframes: [
        { at: 0, value: 0, easing: 'ease-out' },
        { at: 0.25, value: -0.035, easing: 'ease-out' },
        { at: 0.6, value: 0.008, easing: 'ease-in-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
    {
      partId: 'submit-label',
      channel: 'scale',
      keyframes: [
        { at: 0, value: 0, easing: 'ease-out' },
        { at: 0.25, value: -0.035, easing: 'ease-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
  ],
}

/** A rejected login. The shake is the whole message. */
const FORM_REJECT_GESTURE: GestureDefinition = {
  id: 'form-reject',
  name: 'Form reject',
  loop: false,
  tracks: [
    {
      partId: 'card',
      channel: 'x',
      keyframes: [
        { at: 0, value: 0, easing: 'ease-out' },
        { at: 0.12, value: -26, easing: 'ease-in-out' },
        { at: 0.28, value: 22, easing: 'ease-in-out' },
        { at: 0.44, value: -14, easing: 'ease-in-out' },
        { at: 0.6, value: 8, easing: 'ease-in-out' },
        { at: 0.78, value: -3, easing: 'ease-in-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
    {
      partId: 'error-banner',
      channel: 'opacity',
      keyframes: [
        { at: 0, value: -1, easing: 'ease-out' },
        { at: 0.35, value: 0, easing: 'ease-out' },
        { at: 1, value: 0, easing: 'ease-out' },
      ],
    },
    {
      partId: 'error-text',
      channel: 'opacity',
      keyframes: [
        { at: 0, value: -1, easing: 'ease-out' },
        { at: 0.45, value: 0, easing: 'ease-out' },
        { at: 1, value: 0, easing: 'ease-out' },
      ],
    },
  ],
}

/**
 * The states a login form is actually in.
 *
 * Sequencing these is how the walkthrough is authored: empty, focused, entered,
 * submitting, rejected. Each pose restates everything it wants visible, because
 * an unmentioned channel returns to rest — so `email-focused` deliberately keeps
 * nothing filled, and `password-focused` restates the email text.
 */
const LOGIN_FORM_POSES: PoseDefinition[] = [
  {
    id: 'form-empty',
    name: 'Empty form',
    blockId: 'ui-login-form',
    channels: [],
  },
  {
    id: 'email-focused',
    name: 'Email focused',
    blockId: 'ui-login-form',
    channels: [
      { partId: 'email-focus', channel: 'opacity', value: 1 },
      { partId: 'email-caret', channel: 'opacity', value: 1 },
      // The caret sits at the start of an empty field.
      { partId: 'email-caret', channel: 'x', value: -312 },
    ],
  },
  {
    id: 'email-entered',
    name: 'Email entered',
    blockId: 'ui-login-form',
    channels: [
      { partId: 'email-focus', channel: 'opacity', value: 1 },
      { partId: 'email-text', channel: 'opacity', value: 1 },
      { partId: 'email-caret', channel: 'opacity', value: 1 },
    ],
  },
  {
    id: 'password-focused',
    name: 'Password focused',
    blockId: 'ui-login-form',
    channels: [
      { partId: 'email-text', channel: 'opacity', value: 1 },
      { partId: 'password-focus', channel: 'opacity', value: 1 },
    ],
  },
  {
    id: 'credentials-entered',
    name: 'Credentials entered',
    blockId: 'ui-login-form',
    channels: [
      { partId: 'email-text', channel: 'opacity', value: 1 },
      { partId: 'password-focus', channel: 'opacity', value: 1 },
      { partId: 'password-dots', channel: 'opacity', value: 1 },
    ],
  },
  {
    id: 'form-submitting',
    name: 'Submitting',
    blockId: 'ui-login-form',
    channels: [
      { partId: 'email-text', channel: 'opacity', value: 1 },
      { partId: 'password-dots', channel: 'opacity', value: 1 },
      // The label gives way to the spinner rather than sitting behind it.
      { partId: 'submit-label', channel: 'opacity', value: -1 },
      { partId: 'submit-spinner', channel: 'opacity', value: 1 },
    ],
  },
  {
    id: 'form-rejected',
    name: 'Rejected',
    blockId: 'ui-login-form',
    channels: [
      { partId: 'email-text', channel: 'opacity', value: 1 },
      { partId: 'password-dots', channel: 'opacity', value: 1 },
      { partId: 'error-banner', channel: 'opacity', value: 1 },
      { partId: 'error-text', channel: 'opacity', value: 1 },
    ],
  },
]

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

/**
 * Pointer, drawn as the classic arrow.
 *
 * Its pivot is the tip rather than the centre, so a scale pulse on click keeps
 * the point exactly where it was aimed — a cursor that grows from its middle
 * slides off the thing it is clicking. The whole cursor hangs off `pointer` so
 * one transform moves it: with the ring as a second root, travelling across the
 * screen would leave the ring behind.
 */
const CURSOR_TIP: [number, number] = [30, 24]

const CURSOR_BLOCK: BlockDefinition = {
  id: 'ui-cursor',
  name: 'Cursor',
  category: 'prop',
  width: 220,
  height: 260,
  slots: [{ id: 'tip', label: 'Pointer tip', at: CURSOR_TIP, partId: 'pointer' }],
  gestures: ['cursor-click', 'cursor-appear'],
  parts: [
    {
      id: 'pointer',
      label: 'Pointer',
      d: polygon([
        [30, 24],
        [30, 186],
        [74, 146],
        [104, 208],
        [134, 192],
        [104, 132],
        [158, 122],
      ]),
      fill: 'ink',
      pivot: CURSOR_TIP,
      z: 1,
    },
    {
      id: 'click-ring',
      label: 'Click ring',
      parent: 'pointer',
      d: circle(30, 24, 58),
      stroke: 'accent',
      strokeWidth: 7,
      pivot: CURSOR_TIP,
      // Drawn behind the pointer; z is independent of the parent chain.
      z: 0,
      opacity: 0,
    },
    {
      id: 'pointer-fill',
      label: 'Pointer fill',
      parent: 'pointer',
      d: polygon([
        [42, 50],
        [42, 158],
        [70, 132],
        [102, 186],
        [116, 178],
        [86, 122],
        [130, 114],
      ]),
      fill: 'glow',
      pivot: CURSOR_TIP,
      z: 2,
    },
  ],
}

/**
 * A click.
 *
 * The pointer dips toward the surface and the ring expands away from the tip and
 * fades — the two halves of the same impact, which is why they share a pivot.
 */
const CURSOR_CLICK_GESTURE: GestureDefinition = {
  id: 'cursor-click',
  name: 'Cursor click',
  loop: false,
  tracks: [
    {
      partId: 'pointer',
      channel: 'scale',
      keyframes: [
        { at: 0, value: 0, easing: 'ease-out' },
        { at: 0.22, value: -0.16, easing: 'ease-out' },
        { at: 0.55, value: 0.03, easing: 'ease-in-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
    {
      partId: 'click-ring',
      channel: 'opacity',
      keyframes: [
        { at: 0, value: -1, easing: 'ease-out' },
        { at: 0.18, value: -0.1, easing: 'ease-out' },
        { at: 0.85, value: -1, easing: 'ease-out' },
        { at: 1, value: -1, easing: 'ease-out' },
      ],
    },
    {
      partId: 'click-ring',
      channel: 'scale',
      keyframes: [
        { at: 0, value: -0.7, easing: 'ease-out' },
        { at: 0.85, value: 0.5, easing: 'ease-out' },
        { at: 1, value: 0.5, easing: 'ease-out' },
      ],
    },
  ],
}

const CURSOR_APPEAR_GESTURE: GestureDefinition = fadeGesture(CURSOR_BLOCK, {
  id: 'cursor-appear',
  name: 'Cursor appear',
  partIds: ['pointer', 'pointer-fill'],
})

export const UI_BLOCKS: BlockDefinition[] = [BROWSER_WINDOW_BLOCK, LOGIN_FORM_BLOCK, CURSOR_BLOCK]

export const UI_GESTURES: GestureDefinition[] = [
  WINDOW_APPEAR_GESTURE,
  WINDOW_DISMISS_GESTURE,
  WINDOW_NUDGE_GESTURE,
  FORM_APPEAR_GESTURE,
  FORM_REVEAL_GESTURE,
  SUBMIT_PRESS_GESTURE,
  FORM_REJECT_GESTURE,
  CURSOR_CLICK_GESTURE,
  CURSOR_APPEAR_GESTURE,
]

export const UI_POSES: PoseDefinition[] = [...LOGIN_FORM_POSES]
