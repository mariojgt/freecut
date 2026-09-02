import type { BlockDefinition, GestureDefinition, PoseDefinition } from './types'
import { circle, roundedSegment } from './block-geometry'
import { sampleGestureTrack } from './gesture-bake'

/**
 * Neutral line-art actor for explainers and story-led shorts.
 *
 * The figure is deliberately anonymous: hollow head, no face, no clothing and
 * one stable silhouette. Semantic palette roles let the same geometry become
 * black-on-white or white-on-black without duplicating the rig.
 */

const HIP: [number, number] = [120, 244]
const NECK: [number, number] = [120, 112]
const SHOULDER_FAR: [number, number] = [115, 130]
const ELBOW_FAR: [number, number] = [83, 196]
const WRIST_FAR: [number, number] = [69, 265]
const SHOULDER_NEAR: [number, number] = [125, 130]
const ELBOW_NEAR: [number, number] = [157, 196]
const WRIST_NEAR: [number, number] = [171, 265]
const KNEE_FAR: [number, number] = [88, 320]
const ANKLE_FAR: [number, number] = [78, 389]
const KNEE_NEAR: [number, number] = [152, 320]
const ANKLE_NEAR: [number, number] = [162, 389]

function overlappingSegment(
  joint: [number, number],
  end: [number, number],
  width: number,
  overlap = width,
): string {
  const dx = end[0] - joint[0]
  const dy = end[1] - joint[1]
  const length = Math.hypot(dx, dy)
  const start: [number, number] = [
    joint[0] - (dx / length) * overlap,
    joint[1] - (dy / length) * overlap,
  ]
  return roundedSegment(start, end, width)
}

export const STICK_FIGURE_BLOCK: BlockDefinition = {
  id: 'character-stick-figure',
  name: 'Stick figure',
  category: 'character',
  width: 240,
  height: 420,
  slots: [
    { id: 'head', label: 'Head', at: [120, 67], partId: 'head' },
    { id: 'hand-back', label: 'Back hand', at: WRIST_FAR, partId: 'forearm-back' },
    { id: 'hand-front', label: 'Front hand', at: WRIST_NEAR, partId: 'forearm-front' },
    { id: 'chest', label: 'Chest', at: [120, 174], partId: 'torso' },
    { id: 'feet', label: 'Feet', at: [120, 401], partId: 'foot-front' },
  ],
  gestures: ['stick-idle', 'stick-walk', 'stick-wave', 'stick-jump', 'stick-celebrate'],
  poses: [
    'stick-stand',
    'stick-point-forward',
    'stick-point-up',
    'stick-explain',
    'stick-think',
    'stick-celebrate',
    'stick-crouch',
  ],
  parts: [
    // Back limbs use muted ink and sit behind the body, keeping crossed poses
    // readable without introducing a second character colour.
    {
      id: 'thigh-back',
      label: 'Back thigh',
      parent: 'pelvis',
      d: roundedSegment([114, 244], KNEE_FAR, 15),
      pivot: HIP,
      fill: 'inkMuted',
      z: 1,
    },
    {
      id: 'shin-back',
      label: 'Back shin',
      parent: 'thigh-back',
      d: overlappingSegment(KNEE_FAR, ANKLE_FAR, 14),
      pivot: KNEE_FAR,
      fill: 'inkMuted',
      z: 2,
    },
    {
      id: 'foot-back',
      label: 'Back foot',
      parent: 'shin-back',
      d: overlappingSegment(ANKLE_FAR, [55, 401], 16),
      pivot: ANKLE_FAR,
      fill: 'inkMuted',
      z: 3,
    },
    {
      id: 'arm-back',
      label: 'Back upper arm',
      parent: 'torso',
      d: roundedSegment(SHOULDER_FAR, ELBOW_FAR, 14),
      pivot: SHOULDER_FAR,
      fill: 'inkMuted',
      z: 2,
    },
    {
      id: 'forearm-back',
      label: 'Back forearm',
      parent: 'arm-back',
      d: overlappingSegment(ELBOW_FAR, WRIST_FAR, 13, 18),
      pivot: ELBOW_FAR,
      fill: 'inkMuted',
      z: 3,
    },
    // A visible pelvis is also the rig root. Moving it carries every limb,
    // which gives jumps and squash poses one coherent centre of mass.
    {
      id: 'pelvis',
      label: 'Pelvis',
      d: circle(HIP[0], HIP[1], 11),
      pivot: HIP,
      fill: 'ink',
      z: 5,
    },
    {
      id: 'torso',
      label: 'Torso',
      parent: 'pelvis',
      d: roundedSegment([120, 238], [120, 116], 16),
      pivot: HIP,
      fill: 'ink',
      z: 6,
    },
    {
      id: 'head',
      label: 'Hollow head',
      parent: 'torso',
      d: circle(120, 67, 38),
      pivot: NECK,
      stroke: 'ink',
      strokeWidth: 11,
      z: 7,
    },

    // Front limbs use primary ink and sit above the torso at crossings.
    {
      id: 'thigh-front',
      label: 'Front thigh',
      parent: 'pelvis',
      d: roundedSegment([126, 244], KNEE_NEAR, 16),
      pivot: HIP,
      fill: 'ink',
      z: 8,
    },
    {
      id: 'shin-front',
      label: 'Front shin',
      parent: 'thigh-front',
      d: overlappingSegment(KNEE_NEAR, ANKLE_NEAR, 15),
      pivot: KNEE_NEAR,
      fill: 'ink',
      z: 9,
    },
    {
      id: 'foot-front',
      label: 'Front foot',
      parent: 'shin-front',
      d: overlappingSegment(ANKLE_NEAR, [190, 401], 17),
      pivot: ANKLE_NEAR,
      fill: 'ink',
      z: 10,
    },
    {
      id: 'arm-front',
      label: 'Front upper arm',
      parent: 'torso',
      d: roundedSegment(SHOULDER_NEAR, ELBOW_NEAR, 15),
      pivot: SHOULDER_NEAR,
      fill: 'ink',
      z: 11,
    },
    {
      id: 'forearm-front',
      label: 'Front forearm',
      parent: 'arm-front',
      d: overlappingSegment(ELBOW_NEAR, WRIST_NEAR, 14, 18),
      pivot: ELBOW_NEAR,
      fill: 'ink',
      z: 12,
    },
  ],
}

const TAU = Math.PI * 2
const WALK_SAMPLES = 16

/** Subtle ambient motion so a held speaking pose never looks frozen. */
const STICK_IDLE_GESTURE: GestureDefinition = {
  id: 'stick-idle',
  name: 'Stick figure idle',
  loop: true,
  tracks: [
    sampleGestureTrack('pelvis', 'y', 8, (t) => -3 * (0.5 - 0.5 * Math.cos(TAU * t))),
    sampleGestureTrack('torso', 'scaleY', 8, (t) => 0.015 * Math.sin(TAU * t)),
    sampleGestureTrack('head', 'rotation', 8, (t) => 1.8 * Math.sin(TAU * t)),
    sampleGestureTrack('arm-front', 'rotation', 8, (t) => 2.5 * Math.sin(TAU * t)),
    sampleGestureTrack('arm-back', 'rotation', 8, (t) => -2.5 * Math.sin(TAU * t)),
  ],
}

/** Symmetric two-step walk with opposed arms and a twice-per-cycle body rise. */
export const STICK_WALK_GESTURE: GestureDefinition = {
  id: 'stick-walk',
  name: 'Stick figure walk',
  loop: true,
  tracks: [
    sampleGestureTrack('thigh-front', 'rotation', WALK_SAMPLES, (t) => -25 * Math.cos(TAU * t)),
    sampleGestureTrack('thigh-back', 'rotation', WALK_SAMPLES, (t) => 25 * Math.cos(TAU * t)),
    sampleGestureTrack(
      'shin-front',
      'rotation',
      WALK_SAMPLES,
      (t) => 40 * Math.max(0, -Math.sin(TAU * t)),
    ),
    sampleGestureTrack(
      'shin-back',
      'rotation',
      WALK_SAMPLES,
      (t) => -40 * Math.max(0, Math.sin(TAU * t)),
    ),
    sampleGestureTrack('foot-front', 'rotation', WALK_SAMPLES, (t) => 9 * Math.cos(TAU * t)),
    sampleGestureTrack('foot-back', 'rotation', WALK_SAMPLES, (t) => -9 * Math.cos(TAU * t)),
    sampleGestureTrack('arm-front', 'rotation', WALK_SAMPLES, (t) => 22 * Math.cos(TAU * t)),
    sampleGestureTrack('arm-back', 'rotation', WALK_SAMPLES, (t) => -22 * Math.cos(TAU * t)),
    sampleGestureTrack('forearm-front', 'rotation', WALK_SAMPLES, (t) => 8 * Math.cos(TAU * t)),
    sampleGestureTrack('forearm-back', 'rotation', WALK_SAMPLES, (t) => -8 * Math.cos(TAU * t)),
    sampleGestureTrack(
      'pelvis',
      'y',
      WALK_SAMPLES,
      (t) => -5 * (0.5 - 0.5 * Math.cos(2 * TAU * t)),
    ),
    sampleGestureTrack('torso', 'rotation', WALK_SAMPLES, (t) => 1.8 * Math.sin(2 * TAU * t)),
    sampleGestureTrack('head', 'rotation', WALK_SAMPLES, (t) => -2 * Math.sin(2 * TAU * t)),
  ],
}

/** Friendly one-shot that returns exactly to the neutral silhouette. */
const STICK_WAVE_GESTURE: GestureDefinition = {
  id: 'stick-wave',
  name: 'Stick figure wave',
  loop: false,
  tracks: [
    sampleGestureTrack('arm-front', 'rotation', 12, (t) => -105 * Math.sin(Math.PI * t)),
    sampleGestureTrack(
      'forearm-front',
      'rotation',
      12,
      (t) => -38 * Math.sin(Math.PI * t) + 20 * Math.sin(Math.PI * t) * Math.sin(6 * Math.PI * t),
    ),
    sampleGestureTrack('head', 'rotation', 12, (t) => -5 * Math.sin(Math.PI * t)),
  ],
}

/** Anticipation, airborne stretch, landing squash and a short settle. */
export const STICK_JUMP_GESTURE: GestureDefinition = {
  id: 'stick-jump',
  name: 'Stick figure jump',
  loop: false,
  tracks: [
    {
      partId: 'pelvis',
      channel: 'y',
      keyframes: [
        { at: 0, value: 0, easing: 'ease-in' },
        { at: 0.14, value: 15, easing: 'ease-in' },
        { at: 0.46, value: -105, easing: 'ease-out' },
        { at: 0.62, value: -105, easing: 'ease-in' },
        { at: 0.84, value: 0, easing: 'ease-out' },
        { at: 0.93, value: -8, easing: 'ease-in-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
    {
      partId: 'pelvis',
      channel: 'scaleY',
      keyframes: [
        { at: 0, value: 0, easing: 'ease-in' },
        { at: 0.14, value: -0.14, easing: 'ease-in' },
        { at: 0.46, value: 0.1, easing: 'ease-out' },
        { at: 0.84, value: -0.18, easing: 'ease-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
    {
      partId: 'pelvis',
      channel: 'scaleX',
      keyframes: [
        { at: 0, value: 0, easing: 'ease-in' },
        { at: 0.14, value: 0.12, easing: 'ease-in' },
        { at: 0.46, value: -0.07, easing: 'ease-out' },
        { at: 0.84, value: 0.15, easing: 'ease-out' },
        { at: 1, value: 0, easing: 'ease-in-out' },
      ],
    },
    sampleGestureTrack('arm-front', 'rotation', 10, (t) => -70 * Math.sin(Math.PI * t)),
    sampleGestureTrack('arm-back', 'rotation', 10, (t) => 70 * Math.sin(Math.PI * t)),
    sampleGestureTrack('thigh-front', 'rotation', 10, (t) => 32 * Math.sin(Math.PI * t)),
    sampleGestureTrack('thigh-back', 'rotation', 10, (t) => -32 * Math.sin(Math.PI * t)),
    sampleGestureTrack('shin-front', 'rotation', 10, (t) => -48 * Math.sin(Math.PI * t)),
    sampleGestureTrack('shin-back', 'rotation', 10, (t) => 48 * Math.sin(Math.PI * t)),
  ],
}

/** Two buoyant victory beats, suitable for a payoff or final callback. */
const STICK_CELEBRATE_GESTURE: GestureDefinition = {
  id: 'stick-celebrate',
  name: 'Stick figure celebrate',
  loop: false,
  tracks: [
    sampleGestureTrack('arm-front', 'rotation', 16, (t) => -105 * Math.sin(Math.PI * t)),
    sampleGestureTrack('arm-back', 'rotation', 16, (t) => 105 * Math.sin(Math.PI * t)),
    sampleGestureTrack('forearm-front', 'rotation', 16, (t) => -18 * Math.sin(Math.PI * t)),
    sampleGestureTrack('forearm-back', 'rotation', 16, (t) => 18 * Math.sin(Math.PI * t)),
    sampleGestureTrack(
      'pelvis',
      'y',
      16,
      (t) => -18 * Math.sin(Math.PI * t) * Math.abs(Math.sin(2 * TAU * t)),
    ),
    sampleGestureTrack(
      'head',
      'rotation',
      16,
      (t) => 5 * Math.sin(2 * TAU * t) * Math.sin(Math.PI * t),
    ),
  ],
}

/** Reviewed acting silhouettes; generators choose names, never joint angles. */
export const STICK_FIGURE_POSES: PoseDefinition[] = [
  {
    id: 'stick-stand',
    name: 'Stick figure stand',
    blockId: STICK_FIGURE_BLOCK.id,
    channels: [],
  },
  {
    id: 'stick-point-forward',
    name: 'Stick figure point forward',
    blockId: STICK_FIGURE_BLOCK.id,
    channels: [
      { partId: 'arm-front', channel: 'rotation', value: -78 },
      { partId: 'forearm-front', channel: 'rotation', value: -18 },
      { partId: 'torso', channel: 'rotation', value: -4 },
      { partId: 'head', channel: 'rotation', value: 6 },
    ],
  },
  {
    id: 'stick-point-up',
    name: 'Stick figure point up',
    blockId: STICK_FIGURE_BLOCK.id,
    channels: [
      { partId: 'arm-front', channel: 'rotation', value: -105 },
      { partId: 'forearm-front', channel: 'rotation', value: -50 },
      { partId: 'torso', channel: 'rotation', value: -3 },
      { partId: 'head', channel: 'rotation', value: -9 },
    ],
  },
  {
    id: 'stick-explain',
    name: 'Stick figure explain',
    blockId: STICK_FIGURE_BLOCK.id,
    channels: [
      { partId: 'arm-front', channel: 'rotation', value: -62 },
      { partId: 'forearm-front', channel: 'rotation', value: -50 },
      { partId: 'arm-back', channel: 'rotation', value: 62 },
      { partId: 'forearm-back', channel: 'rotation', value: 50 },
      { partId: 'head', channel: 'rotation', value: -3 },
    ],
  },
  {
    id: 'stick-think',
    name: 'Stick figure think',
    blockId: STICK_FIGURE_BLOCK.id,
    channels: [
      { partId: 'arm-front', channel: 'rotation', value: -15 },
      { partId: 'forearm-front', channel: 'rotation', value: -165 },
      { partId: 'head', channel: 'rotation', value: 10 },
      { partId: 'torso', channel: 'rotation', value: 4 },
    ],
  },
  {
    id: 'stick-celebrate',
    name: 'Stick figure celebrate',
    blockId: STICK_FIGURE_BLOCK.id,
    channels: [
      { partId: 'arm-front', channel: 'rotation', value: -105 },
      { partId: 'forearm-front', channel: 'rotation', value: -15 },
      { partId: 'arm-back', channel: 'rotation', value: 105 },
      { partId: 'forearm-back', channel: 'rotation', value: 15 },
      { partId: 'pelvis', channel: 'y', value: -12 },
    ],
  },
  {
    id: 'stick-crouch',
    name: 'Stick figure crouch',
    blockId: STICK_FIGURE_BLOCK.id,
    channels: [
      { partId: 'thigh-front', channel: 'rotation', value: -35 },
      { partId: 'shin-front', channel: 'rotation', value: 75 },
      { partId: 'foot-front', channel: 'rotation', value: -40 },
      { partId: 'thigh-back', channel: 'rotation', value: 35 },
      { partId: 'shin-back', channel: 'rotation', value: -75 },
      { partId: 'foot-back', channel: 'rotation', value: 40 },
      { partId: 'pelvis', channel: 'y', value: 34 },
      { partId: 'torso', channel: 'rotation', value: 8 },
      { partId: 'arm-front', channel: 'rotation', value: -18 },
      { partId: 'arm-back', channel: 'rotation', value: 18 },
    ],
  },
]

export const STICK_FIGURE_GESTURES: GestureDefinition[] = [
  STICK_IDLE_GESTURE,
  STICK_WALK_GESTURE,
  STICK_WAVE_GESTURE,
  STICK_JUMP_GESTURE,
  STICK_CELEBRATE_GESTURE,
]
