import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  HEADLESS_API_VERSION,
  EDIT_OPERATION_NAMES,
  capabilities,
  checkRequestSchema,
  contactSheetRequestSchema,
  editOpSchema,
  motionRequestSchema,
  editRequestSchema,
  frameRequestSchema,
  layoutRequestSchema,
  normalizeRenderInput,
  renderRequestSchema,
  validate,
} from './lib/contract.mjs'
import { parseArgs } from './lib/cli.mjs'
import { listProjects, loadProject } from './lib/workspace.mjs'

const samples = {
  addText: { op: 'addText', text: 'hello', from: 0 },
  addItem: {
    op: 'addItem',
    item: { type: 'text', id: 'i', trackId: 'v', from: 0, durationInFrames: 1 },
  },
  updateItem: { op: 'updateItem', id: 'i', updates: { text: 'new' } },
  moveItem: { op: 'moveItem', id: 'i', from: 2, trackId: 'v' },
  removeItems: { op: 'removeItems', ids: ['i'] },
  split: { op: 'split', id: 'i', frame: 1 },
  trimStart: { op: 'trimStart', id: 'i', amount: 1 },
  trimEnd: { op: 'trimEnd', id: 'i', amount: 1 },
  addTransition: {
    op: 'addTransition',
    leftClipId: 'a',
    rightClipId: 'b',
    type: 'crossfade',
    presentation: 'glitch',
    direction: 'from-left',
    alignment: 0.4,
    properties: { intensity: 2 },
  },
  updateTransition: {
    op: 'updateTransition',
    id: 't',
    presentation: 'wipe',
    direction: 'from-top',
  },
  removeTransition: { op: 'removeTransition', id: 't' },
  addTrack: { op: 'addTrack', kind: 'audio', order: 2 },
  addClip: { op: 'addClip', mediaId: 'm', from: 0 },
  addKeyframe: {
    op: 'addKeyframe',
    itemId: 'i',
    property: 'opacity',
    frame: 0,
    value: 1,
    easing: 'linear',
  },
  removeKeyframes: { op: 'removeKeyframes', itemId: 'i', property: 'effect:gpu-blur:e1:radius' },
  setTransformParent: {
    op: 'setTransformParent',
    id: 'arm',
    parentItemId: 'body',
    behavior: 'preserve-world',
    frame: 0,
  },
  addEffect: {
    op: 'addEffect',
    itemId: 'i',
    gpuEffectType: 'gpu-gaussian-blur',
    params: { radius: 2 },
  },
  removeEffect: { op: 'removeEffect', itemId: 'i', effectId: 'e' },
  setTransform: { op: 'setTransform', id: 'i', transform: { opacity: 0.5, rotation: 2 } },
  addBlock: {
    op: 'addBlock',
    blockId: 'character-astronaut',
    from: 0,
    durationInFrames: 180,
    x: -180,
    y: 190,
    scale: 0.9,
    palette: 'deep-space',
    gestures: [{ id: 'walk', cycles: 6 }],
  },
  applyGesture: { op: 'applyGesture', idPrefix: 'hero', gestureId: 'idle-breath', scale: 0.9 },
  applyPose: {
    op: 'applyPose',
    idPrefix: 'hero',
    poses: [
      { id: 'stand', at: 0 },
      { id: 'point-forward', at: 0.6, easing: 'ease-out' },
    ],
    durationInFrames: 90,
    scale: 0.9,
  },
  attachToSlot: {
    op: 'attachToSlot',
    idPrefix: 'hero',
    slotId: 'hand',
    itemId: 'i',
    x: -180,
    y: 190,
    scale: 0.9,
  },
  directAction: {
    op: 'directAction',
    idPrefix: 'hero',
    action: 'enter',
    direction: 'left',
    from: 0,
    durationInFrames: 24,
    distance: 480,
    intensity: 1,
    easing: 'ease-out',
  },
  setCamera: {
    op: 'setCamera',
    itemIds: ['i'],
    intent: 'push',
    from: 0,
    durationInFrames: 40,
    amount: 1,
    planes: [{ idPrefix: 'hero', plane: 0 }],
  },
  defineBlock: {
    op: 'defineBlock',
    blockId: 'local-robot',
    name: 'Robot',
    category: 'character',
    source: '<svg viewBox="0 0 100 200"><path id="torso" d="M 0 0 L 10 0 L 10 10 Z"/></svg>',
    parts: [
      { id: 'torso', fill: 'primary', z: 0 },
      { id: 'arm', from: 'arm-left', parent: 'torso', pivot: [50, 60], fill: 'ink', z: 1 },
    ],
    slots: [{ id: 'hand', label: 'Hand', at: [50, 120], partId: 'arm' }],
    secondary: [
      {
        id: 'antenna',
        driverPartId: 'torso',
        driverChannel: 'y',
        followerPartId: 'arm',
        followerChannel: 'rotation',
        gain: -0.5,
        lagSeconds: 0.08,
      },
    ],
  },
  importSvg: { op: 'importSvg', source: '<svg/>', size: 480 },
  morphPath: {
    op: 'morphPath',
    itemId: 'i',
    fromFrame: 0,
    toFrame: 30,
    targetPathData: 'M 0 0 L 1 1',
  },
}

test('every published edit discriminator has a valid strict schema', () => {
  assert.deepEqual(Object.keys(samples), EDIT_OPERATION_NAMES)
  for (const op of EDIT_OPERATION_NAMES)
    assert.equal(editOpSchema.safeParse(samples[op]).success, true, op)
  assert.equal(editOpSchema.safeParse({ ...samples.addText, surprise: true }).success, false)
  assert.equal(editOpSchema.safeParse({ op: 'invented' }).success, false)
  assert.equal(
    editOpSchema.safeParse({ op: 'addEffect', itemId: 'i', gpuEffectType: 'gpu-invented' }).success,
    false,
  )
  assert.equal(editOpSchema.safeParse({ op: 'updateItem', id: 'i', updates: {} }).success, false)
  assert.equal(
    editOpSchema.safeParse({ op: 'setTransform', id: 'i', transform: {} }).success,
    false,
  )
})

test('edit request requires exactly one project source and nonempty valid ops', () => {
  assert.equal(editRequestSchema.safeParse({ project: 'p', ops: [] }).success, false)
  assert.equal(
    editRequestSchema.safeParse({ project: 'p', projectObject: {}, ops: [samples.addText] })
      .success,
    false,
  )
  assert.equal(editRequestSchema.safeParse({ project: 'p', ops: [samples.addText] }).success, true)
})

test('render request enforces finite bounds, ranges, enums, and canonical HTTP fields', () => {
  assert.equal(
    renderRequestSchema.safeParse({ project: 'p', fps: 1, resolution: '16x16' }).success,
    true,
  )
  assert.equal(
    renderRequestSchema.safeParse({ project: 'p', fps: 240, resolution: '16384x16384' }).success,
    true,
  )
  for (const invalid of [
    { project: 'p', fps: 0 },
    { project: 'p', fps: Number.NaN },
    { project: 'p', resolution: '15x1080' },
    { project: 'p', quality: 'best' },
    { project: 'p', inSec: 2, outSec: 1 },
    { project: 'p', duration: 0 },
    { project: 'p', in: 1 },
    { project: 'p', outSec: 2, duration: 1 },
    { project: 'p', container: 'mp3' },
    { project: 'p', audioOnly: true, container: 'webm' },
  ])
    assert.equal(renderRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid))
  assert.deepEqual(
    normalizeRenderInput({ project: 'p', in: '1', 'out-sec': '2', 'audio-only': true }),
    {
      project: 'p',
      inSec: 1,
      outSec: 2,
      audioOnly: true,
    },
  )
})

test('frame and layout requests reject invalid targets and frame options', () => {
  assert.deepEqual(
    frameRequestSchema.parse({ project: 'p', frame: 0, format: 'WEBP', quality: 0 }),
    { project: 'p', frame: 0, format: 'webp', quality: 0 },
  )
  assert.equal(layoutRequestSchema.safeParse({ projectObject: {}, at: 1.5 }).success, true)

  for (const invalid of [
    { project: 'p', frame: '12' },
    { project: 'p', frame: Number.NaN },
    { project: 'p', at: '1.5' },
    { project: 'p', atSeconds: Number.POSITIVE_INFINITY },
    { project: 'p', format: 'gif' },
    { project: 'p', quality: -0.1 },
    { project: 'p', quality: 1.1 },
    { project: 'p', width: 0 },
    { project: 'p', height: 10.5 },
    { project: 'p', projectObject: {}, frame: 0 },
    { frame: 0 },
  ])
    assert.equal(frameRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid))

  for (const invalid of [
    { project: 'p', frame: '12' },
    { project: 'p', at: '1.5' },
    { project: 'p', format: 'png' },
  ])
    assert.equal(layoutRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid))
})

test('directed actions and camera moves need exactly one target form', () => {
  const ok = (value) => editOpSchema.safeParse(value).success
  const action = { op: 'directAction', action: 'enter' }
  assert.equal(ok({ ...action, idPrefix: 'hero' }), true)
  assert.equal(ok({ ...action, itemId: 'i' }), true)
  assert.equal(ok({ ...action, itemIds: ['i', 'j'] }), true)
  // Ambiguous or absent targets are refused at the wire rather than guessed at.
  assert.equal(ok(action), false)
  assert.equal(ok({ ...action, idPrefix: 'hero', itemId: 'i' }), false)
  assert.equal(ok({ ...action, itemIds: [] }), false)

  assert.equal(ok({ ...action, idPrefix: 'hero', action: 'teleport' }), false)
  assert.equal(ok({ ...action, idPrefix: 'hero', direction: 'sideways' }), false)
  assert.equal(ok({ ...action, idPrefix: 'hero', to: { x: 10, y: 20 } }), true)
  assert.equal(ok({ ...action, idPrefix: 'hero', to: { z: 1 } }), false)
  assert.equal(ok({ ...action, idPrefix: 'hero', step: 0 }), false)

  const camera = { op: 'setCamera', itemId: 'i' }
  assert.equal(ok({ ...camera, intent: 'push' }), true)
  assert.equal(ok({ ...camera, intent: 'zoom' }), false)
  assert.equal(ok({ ...camera, intent: 'push', planes: [{ idPrefix: 'a', plane: 3 }] }), true)
  // A plane outside the parallax range, or naming both forms, is a mistake.
  assert.equal(ok({ ...camera, intent: 'push', planes: [{ idPrefix: 'a', plane: 9 }] }), false)
  assert.equal(
    ok({ ...camera, intent: 'push', planes: [{ idPrefix: 'a', itemId: 'b', plane: 1 }] }),
    false,
  )
})

test('generated block ids are namespaced away from committed ones', () => {
  const ok = (value) => editOpSchema.safeParse(value).success
  const base = {
    op: 'defineBlock',
    name: 'Robot',
    source: '<svg/>',
    parts: [{ id: 'torso' }],
  }
  assert.equal(ok({ ...base, blockId: 'local-robot' }), true)
  // A generated block must not be able to take a committed id, or reviewed
  // artwork could be shadowed by something invented at request time.
  assert.equal(ok({ ...base, blockId: 'character-astronaut' }), false)
  assert.equal(ok({ ...base, blockId: 'robot' }), false)
  assert.equal(ok({ ...base, parts: [] }), false)

  // addBlock accepts both namespaces and nothing else.
  const add = { op: 'addBlock' }
  assert.equal(ok({ ...add, blockId: 'character-astronaut' }), true)
  assert.equal(ok({ ...add, blockId: 'local-robot' }), true)
  assert.equal(ok({ ...add, blockId: 'made-up' }), false)

  // Rig fields are bounded: a depth outside the parallax planes, an unknown
  // palette role or a negative follower lag are all refused at the wire.
  assert.equal(ok({ ...base, blockId: 'local-a', parts: [{ id: 'p', depth: 9 }] }), false)
  assert.equal(ok({ ...base, blockId: 'local-a', parts: [{ id: 'p', fill: 'neon' }] }), false)
  assert.equal(ok({ ...base, blockId: 'local-a', parts: [{ id: 'p', pivot: [1] }] }), false)
  assert.equal(
    ok({
      ...base,
      blockId: 'local-a',
      secondary: [
        {
          id: 's',
          driverPartId: 'a',
          followerPartId: 'b',
          driverChannel: 'y',
          followerChannel: 'rotation',
          gain: 1,
          lagSeconds: -1,
        },
      ],
    }),
    false,
  )
})

test('attachToSlot can contain-fit an item inside its slot', () => {
  const ok = (value) => editOpSchema.safeParse(value).success
  const base = { op: 'attachToSlot', idPrefix: 'win', slotId: 'viewport', itemId: 'card' }
  assert.equal(ok({ ...base, fit: 'contain', margin: 0.1 }), true)
  assert.equal(ok({ ...base, fit: 'cover' }), false)
  assert.equal(ok({ ...base, margin: 1 }), false)
})

test('perception requests bound their ranges, sample counts and thresholds', () => {
  const ok = (schema, value) => schema.safeParse(value).success
  // Every field is optional but the project source is not: a range with no
  // project would silently answer about nothing.
  assert.equal(ok(motionRequestSchema, { project: 'p' }), true)
  assert.equal(ok(motionRequestSchema, {}), false)
  assert.equal(ok(motionRequestSchema, { project: 'p', projectObject: { id: 'p' } }), false)

  assert.equal(ok(motionRequestSchema, { project: 'p', from: 0, to: 120, samples: 24 }), true)
  assert.equal(ok(motionRequestSchema, { project: 'p', samples: 0 }), false)
  assert.equal(ok(motionRequestSchema, { project: 'p', samples: 601 }), false)
  assert.equal(ok(motionRequestSchema, { project: 'p', samples: 2.5 }), false)
  assert.equal(ok(motionRequestSchema, { project: 'p', from: -1 }), false)
  assert.equal(ok(motionRequestSchema, { project: 'p', itemIds: ['a', 'b'] }), true)
  assert.equal(ok(motionRequestSchema, { project: 'p', surprise: true }), false)

  assert.equal(ok(checkRequestSchema, { project: 'p', titleSafe: 0.9 }), true)
  // A title-safe fraction under 10% would report every title as unsafe.
  assert.equal(ok(checkRequestSchema, { project: 'p', titleSafe: 0 }), false)
  assert.equal(ok(checkRequestSchema, { project: 'p', titleSafe: 1.5 }), false)
  assert.equal(ok(checkRequestSchema, { project: 'p', ghostOpacity: 0.06 }), true)
  assert.equal(ok(checkRequestSchema, { project: 'p', ghostOpacity: 2 }), false)
  assert.equal(ok(checkRequestSchema, { project: 'p', offCanvasTolerance: 0.25 }), true)

  assert.equal(ok(contactSheetRequestSchema, { project: 'p', count: 9, columns: 3 }), true)
  assert.equal(ok(contactSheetRequestSchema, { project: 'p', count: 0 }), false)
  assert.equal(ok(contactSheetRequestSchema, { project: 'p', count: 65 }), false)
  assert.equal(ok(contactSheetRequestSchema, { project: 'p', columns: 17 }), false)
  assert.equal(ok(contactSheetRequestSchema, { project: 'p', cellWidth: 4097 }), false)
  assert.equal(ok(contactSheetRequestSchema, { project: 'p', format: 'PNG' }), true)
  assert.equal(ok(contactSheetRequestSchema, { project: 'p', format: 'gif' }), false)
  assert.equal(ok(contactSheetRequestSchema, { project: 'p', label: false }), true)
})

test('capabilities advertises the perception routes and their schemas', () => {
  const result = capabilities()
  for (const route of ['POST /v1/motion', 'POST /v1/check', 'POST /v1/contact-sheet']) {
    assert.ok(result.lifecycle.routes.includes(route), route)
  }
  for (const schema of ['motion', 'check', 'contactSheet']) {
    assert.ok(result.schemas[schema], schema)
  }
})

test('validation errors and capabilities are machine-readable and bounded', () => {
  assert.throws(
    () => validate(editRequestSchema, { project: 'p', ops: [] }),
    (error) => {
      assert.equal(error.code, 'VALIDATION_ERROR')
      assert.ok(error.fields.some((field) => field.path === 'ops'))
      return true
    },
  )
  const result = capabilities()
  assert.equal(result.apiVersion, HEADLESS_API_VERSION)
  assert.deepEqual(result.operations, EDIT_OPERATION_NAMES)
  assert.ok(result.schemas.render)
  assert.ok(result.schemas.frame)
  assert.ok(result.schemas.layout)
  // Guards against an unbounded capabilities document, which every client fetches
  // and which an agent reads into its context. The op union is what grows: it is
  // ~20KB across 28 operations and gains ~1KB per operation added. Emitting it
  // with `reused: 'ref'` was measured LARGER (24KB vs 20KB) — the shared
  // sub-schemas are not repeated enough to pay for the $defs indirection. If this
  // is reached again, move `schemas.edit` behind an explicit request rather than
  // raising the number a second time.
  assert.ok(
    JSON.stringify(result).length < 48_000,
    `capabilities is ${JSON.stringify(result).length} bytes`,
  )
})

test('CLI rejects unknown options and normalizes aliases', () => {
  const allowed = new Set(['inSec'])
  assert.deepEqual(parseArgs(['--in', '2'], { allowed, aliases: { in: 'inSec' } }), {
    _: [],
    inSec: '2',
  })
  assert.throws(() => parseArgs(['--typo'], { allowed }), /Unknown option/)
})

test('project listings expose distinct actionable directory ids', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-contract-'))
  try {
    for (const dir of ['one', 'two']) {
      const projectDir = path.join(root, 'projects', dir)
      fs.mkdirSync(projectDir, { recursive: true })
      fs.writeFileSync(
        path.join(projectDir, 'project.json'),
        JSON.stringify({ id: 'duplicate', name: dir, updatedAt: 1 }),
      )
    }
    const listed = listProjects(root)
    assert.deepEqual(listed.map((entry) => entry.id).sort(), ['one', 'two'])
    assert.deepEqual(
      listed.map((entry) => entry.projectId),
      ['duplicate', 'duplicate'],
    )
    for (const entry of listed) assert.equal(loadProject(root, entry.id).project.name, entry.name)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
