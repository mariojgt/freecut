import type { BlockDefinition, GestureDefinition } from './types'
import { sampleGestureTrack } from './gesture-bake'
import { capsule, circle } from './block-geometry'

/**
 * Side-view astronaut, rigged for locomotion.
 *
 * Authored in a 200x400 block viewport with the ground plane at y = 400 and the
 * figure facing +x. Limbs hang downward from their joints, so with screen-space
 * y pointing down a POSITIVE rotation swings a limb BACKWARD. Every angle below
 * follows that convention; flipping it inverts the walk.
 *
 * The hierarchy is a real armature — rotating a thigh carries its shin and boot
 * because the parts are lowered into a `transformParent` chain, which is what
 * makes this behave like an Animate symbol rather than layered cut-outs.
 */

const HIP: [number, number] = [104, 246]
const SHOULDER: [number, number] = [106, 174]
const NECK: [number, number] = [104, 152]

export const ASTRONAUT_BLOCK: BlockDefinition = {
  id: 'character-astronaut',
  name: 'Astronaut',
  category: 'character',
  width: 200,
  height: 400,
  slots: [
    { id: 'head', label: 'Head', at: [105, 108] },
    { id: 'hand', label: 'Lead hand', at: [110, 282] },
    { id: 'feet', label: 'Feet', at: [104, 388] },
    { id: 'chest', label: 'Chest', at: [103, 200] },
  ],
  gestures: ['walk', 'idle-breath', 'wave'],
  parts: [
    // --- Far side: drawn behind the torso so the figure reads as solid. ---
    {
      id: 'arm-far',
      label: 'Far arm',
      d: capsule(94, 168, 22, 62, 11),
      pivot: SHOULDER,
      fill: 'inkMuted',
      z: 1,
    },
    {
      id: 'forearm-far',
      label: 'Far forearm',
      parent: 'arm-far',
      d: capsule(96, 226, 20, 58, 10),
      pivot: [106, 230],
      fill: 'inkMuted',
      z: 2,
    },
    {
      id: 'thigh-far',
      label: 'Far thigh',
      d: capsule(90, 240, 28, 80, 13),
      pivot: HIP,
      fill: 'inkMuted',
      z: 1,
    },
    {
      id: 'shin-far',
      label: 'Far shin',
      parent: 'thigh-far',
      d: capsule(92, 314, 24, 60, 11),
      pivot: [104, 318],
      fill: 'inkMuted',
      z: 2,
    },
    {
      id: 'boot-far',
      label: 'Far boot',
      parent: 'shin-far',
      d: capsule(88, 366, 46, 24, 10),
      pivot: [100, 374],
      fill: 'ink',
      z: 3,
    },

    // --- Core ---
    {
      id: 'backpack',
      label: 'Life support',
      d: capsule(56, 154, 30, 78, 12),
      pivot: HIP,
      fill: 'inkMuted',
      z: 4,
    },
    {
      id: 'torso',
      label: 'Torso',
      d: capsule(76, 148, 54, 104, 22),
      pivot: HIP,
      fill: 'highlight',
      z: 5,
    },
    {
      id: 'chest-panel',
      label: 'Chest panel',
      parent: 'torso',
      d: capsule(88, 178, 28, 22, 6),
      pivot: [102, 189],
      fill: 'primary',
      z: 6,
    },
    {
      id: 'helmet',
      label: 'Helmet',
      parent: 'torso',
      d: circle(105, 108, 46),
      pivot: NECK,
      fill: 'highlight',
      z: 7,
    },
    {
      id: 'visor',
      label: 'Visor',
      parent: 'helmet',
      d: circle(114, 106, 30),
      pivot: NECK,
      fill: 'surfaceDeep',
      z: 8,
    },
    {
      id: 'visor-glint',
      label: 'Visor glint',
      parent: 'helmet',
      d: capsule(104, 88, 12, 22, 6),
      pivot: NECK,
      fill: 'glow',
      z: 9,
    },

    // --- Near side: in front of the torso. ---
    {
      id: 'thigh-near',
      label: 'Near thigh',
      d: capsule(90, 240, 28, 80, 13),
      pivot: HIP,
      fill: 'highlight',
      z: 10,
    },
    {
      id: 'shin-near',
      label: 'Near shin',
      parent: 'thigh-near',
      d: capsule(92, 314, 24, 60, 11),
      pivot: [104, 318],
      fill: 'highlight',
      z: 11,
    },
    {
      id: 'boot-near',
      label: 'Near boot',
      parent: 'shin-near',
      d: capsule(88, 366, 46, 24, 10),
      pivot: [100, 374],
      fill: 'ink',
      z: 12,
    },
    {
      id: 'arm-near',
      label: 'Near arm',
      d: capsule(94, 168, 22, 62, 11),
      pivot: SHOULDER,
      fill: 'highlight',
      z: 13,
    },
    {
      id: 'forearm-near',
      label: 'Near forearm',
      parent: 'arm-near',
      d: capsule(96, 226, 20, 58, 10),
      pivot: [106, 230],
      fill: 'highlight',
      z: 14,
    },
    {
      id: 'glove-near',
      label: 'Near glove',
      parent: 'forearm-near',
      d: circle(106, 288, 13),
      pivot: [106, 282],
      fill: 'primary',
      z: 15,
    },
  ],
}

/** Samples per cycle. Dense enough that linear interpolation hides the sampling. */
const WALK_SAMPLES = 16
const TAU = Math.PI * 2

/** Peak thigh swing, degrees. */
const THIGH_SWING = 24
/** Peak knee bend. A knee only folds one way, hence the half-wave below. */
const KNEE_BEND = 40
const ARM_SWING = 20

/**
 * A two-step walk cycle.
 *
 * Built from continuous functions rather than four hand-posed keys so the cycle
 * loops seamlessly at any duration: every track's value at t=1 equals its value
 * at t=0 by construction.
 *
 * Phase relationships are the part that makes it read as walking — the legs run
 * a half cycle apart, and each arm opposes the leg on its own side.
 */
export const WALK_GESTURE: GestureDefinition = {
  id: 'walk',
  name: 'Walk cycle',
  loop: true,
  tracks: [
    // Legs: near leg forward at t=0 (a contact pose), far leg mirrored.
    sampleGestureTrack(
      'thigh-near',
      'rotation',
      WALK_SAMPLES,
      (t) => -THIGH_SWING * Math.cos(TAU * t),
    ),
    sampleGestureTrack(
      'thigh-far',
      'rotation',
      WALK_SAMPLES,
      (t) => THIGH_SWING * Math.cos(TAU * t),
    ),
    // Knees fold backward only, and only through the swing half of the cycle.
    sampleGestureTrack(
      'shin-near',
      'rotation',
      WALK_SAMPLES,
      (t) => KNEE_BEND * Math.max(0, -Math.sin(TAU * t)),
    ),
    sampleGestureTrack(
      'shin-far',
      'rotation',
      WALK_SAMPLES,
      (t) => KNEE_BEND * Math.max(0, Math.sin(TAU * t)),
    ),
    // Boots counter-rotate so the sole stays roughly level with the ground.
    sampleGestureTrack(
      'boot-near',
      'rotation',
      WALK_SAMPLES,
      (t) =>
        -0.35 * (-THIGH_SWING * Math.cos(TAU * t) + KNEE_BEND * Math.max(0, -Math.sin(TAU * t))),
    ),
    sampleGestureTrack(
      'boot-far',
      'rotation',
      WALK_SAMPLES,
      (t) => -0.35 * (THIGH_SWING * Math.cos(TAU * t) + KNEE_BEND * Math.max(0, Math.sin(TAU * t))),
    ),
    // Arms oppose the leg on the same side.
    sampleGestureTrack('arm-near', 'rotation', WALK_SAMPLES, (t) => ARM_SWING * Math.cos(TAU * t)),
    sampleGestureTrack('arm-far', 'rotation', WALK_SAMPLES, (t) => -ARM_SWING * Math.cos(TAU * t)),
    sampleGestureTrack('forearm-near', 'rotation', WALK_SAMPLES, (t) => 10 + 8 * Math.cos(TAU * t)),
    sampleGestureTrack('forearm-far', 'rotation', WALK_SAMPLES, (t) => 10 - 8 * Math.cos(TAU * t)),
    // The body rises twice per cycle, at each passing pose. Negative is up.
    sampleGestureTrack('torso', 'y', WALK_SAMPLES, (t) => -4 * (0.5 - 0.5 * Math.cos(2 * TAU * t))),
    sampleGestureTrack(
      'backpack',
      'y',
      WALK_SAMPLES,
      (t) => -4 * (0.5 - 0.5 * Math.cos(2 * TAU * t)),
    ),
    // Counter-sway keeps the helmet from feeling welded to the shoulders.
    sampleGestureTrack('helmet', 'rotation', WALK_SAMPLES, (t) => -2 * Math.cos(2 * TAU * t)),
  ],
}

/** Held-pose life: the difference between a paused figure and a still image. */
export const IDLE_BREATH_GESTURE: GestureDefinition = {
  id: 'idle-breath',
  name: 'Idle breath',
  loop: true,
  tracks: [
    sampleGestureTrack('torso', 'y', 8, (t) => -2 * (0.5 - 0.5 * Math.cos(TAU * t))),
    sampleGestureTrack('helmet', 'y', 8, (t) => -3 * (0.5 - 0.5 * Math.cos(TAU * t))),
    sampleGestureTrack('helmet', 'rotation', 8, (t) => 1.5 * Math.sin(TAU * t)),
    sampleGestureTrack('arm-near', 'rotation', 8, (t) => 2 * Math.sin(TAU * t)),
    sampleGestureTrack('arm-far', 'rotation', 8, (t) => -2 * Math.sin(TAU * t)),
  ],
}

/** One-shot greeting. Not a loop: it starts and ends at the rest pose. */
export const WAVE_GESTURE: GestureDefinition = {
  id: 'wave',
  name: 'Wave',
  loop: false,
  tracks: [
    sampleGestureTrack('arm-near', 'rotation', 12, (t) => -110 * Math.sin(Math.PI * t)),
    sampleGestureTrack(
      'forearm-near',
      'rotation',
      12,
      (t) => -40 * Math.sin(Math.PI * t) + 18 * Math.sin(Math.PI * t) * Math.sin(6 * Math.PI * t),
    ),
    sampleGestureTrack('helmet', 'rotation', 12, (t) => -4 * Math.sin(Math.PI * t)),
  ],
}
