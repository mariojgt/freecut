// Portable Chrome contract test for every public headless edit operation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createHarnessServer } from './server.mjs'
import { chromeLaunchArgs } from './lib/cli.mjs'
import { EDIT_OPERATION_NAMES, editOpSchema } from './lib/contract.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function baseProject() {
  return {
    id: 'edit-contract',
    name: 'Edit contract',
    description: '',
    schemaVersion: 10,
    createdAt: 1_735_689_600_000,
    updatedAt: 1_735_689_600_000,
    duration: 120,
    metadata: { width: 1280, height: 720, fps: 30, backgroundColor: '#000000' },
    timeline: {
      masterBusDb: 0,
      tracks: [
        {
          id: 'video-1',
          name: 'V1',
          kind: 'video',
          height: 60,
          locked: false,
          syncLock: true,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
          items: [],
        },
        {
          id: 'video-2',
          name: 'V2',
          kind: 'video',
          height: 60,
          locked: false,
          syncLock: true,
          visible: true,
          muted: false,
          solo: false,
          order: 1,
          items: [],
        },
        {
          id: 'audio-1',
          name: 'A1',
          kind: 'audio',
          height: 60,
          locked: false,
          syncLock: true,
          visible: true,
          muted: false,
          solo: false,
          order: 2,
          items: [],
        },
      ],
      items: [
        {
          id: 'text-1',
          type: 'text',
          trackId: 'video-1',
          from: 0,
          durationInFrames: 90,
          label: 'Title',
          text: 'hello',
          color: '#fff',
          fontSize: 80,
          textAlign: 'center',
          verticalAlign: 'middle',
          transform: {},
        },
        {
          id: 'clip-left',
          type: 'video',
          trackId: 'video-2',
          from: 0,
          durationInFrames: 30,
          label: 'Left',
          mediaId: 'existing',
          src: '',
          volume: 0,
          sourceStart: 0,
          sourceEnd: 30,
          sourceDuration: 60,
          sourceFps: 30,
          speed: 1,
          transform: {},
        },
        {
          id: 'clip-right',
          type: 'video',
          trackId: 'video-2',
          from: 30,
          durationInFrames: 30,
          label: 'Right',
          mediaId: 'existing',
          src: '',
          volume: 0,
          sourceStart: 30,
          sourceEnd: 60,
          sourceDuration: 90,
          sourceFps: 30,
          speed: 1,
          transform: {},
        },
      ],
      transitions: [],
      keyframes: [],
      compositions: [],
    },
  }
}

const item = (project, id) => project.timeline.items.find((candidate) => candidate.id === id)
const roundTrip = (project) => JSON.parse(JSON.stringify(project))

const cases = [
  {
    name: 'addText',
    op: {
      op: 'addText',
      id: 'new-text',
      text: 'added',
      from: 10,
      durationInFrames: 20,
      trackId: 'video-1',
    },
    assert: (project) => assert.equal(item(project, 'new-text')?.text, 'added'),
    failure: { op: 'addText', id: 'bad-text', trackId: 'missing-track' },
  },
  {
    name: 'addItem',
    op: {
      op: 'addItem',
      item: {
        id: 'new-item',
        type: 'text',
        trackId: 'video-1',
        from: 5,
        durationInFrames: 15,
        text: 'raw',
        label: 'Raw',
        color: '#fff',
        fontSize: 50,
      },
    },
    assert: (project) =>
      assert.deepEqual(
        [item(project, 'new-item')?.label, item(project, 'new-item')?.durationInFrames],
        ['Raw', 15],
      ),
    failure: {
      op: 'addItem',
      item: { type: 'text', trackId: 'missing-track', from: 0, durationInFrames: 10 },
    },
  },
  {
    name: 'updateItem',
    op: { op: 'updateItem', id: 'text-1', updates: { label: 'Updated' } },
    assert: (project) => assert.equal(item(project, 'text-1')?.label, 'Updated'),
    failure: { op: 'updateItem', id: 'missing', updates: { label: 'nope' } },
  },
  {
    name: 'moveItem',
    op: { op: 'moveItem', id: 'text-1', from: 12, trackId: 'video-2' },
    assert: (project) =>
      assert.deepEqual(
        [item(project, 'text-1')?.from, item(project, 'text-1')?.trackId],
        [12, 'video-2'],
      ),
    failure: { op: 'moveItem', id: 'missing', from: 2 },
  },
  {
    name: 'removeItems',
    op: { op: 'removeItems', ids: ['text-1'] },
    assert: (project) => assert.equal(item(project, 'text-1'), undefined),
    failure: { op: 'removeItems', ids: ['missing'] },
  },
  {
    name: 'setInOutPoints',
    op: { op: 'setInOutPoints', inPoint: 0, outPoint: 60 },
    assert: (project) =>
      assert.deepEqual([project.timeline.inPoint, project.timeline.outPoint], [0, 60]),
    failure: { op: 'setInOutPoints', inPoint: 50, outPoint: 10 },
  },
  {
    name: 'split',
    op: { op: 'split', id: 'clip-left', frame: 15 },
    assert: (project) => {
      const parts = project.timeline.items.filter((candidate) => candidate.label === 'Left')
      assert.equal(parts.length, 2)
      assert.equal(
        parts.reduce((sum, candidate) => sum + candidate.durationInFrames, 0),
        30,
      )
    },
    failure: { op: 'split', id: 'clip-left', frame: 0 },
  },
  {
    name: 'trimStart',
    op: { op: 'trimStart', id: 'text-1', amount: 5 },
    assert: (project) =>
      assert.deepEqual(
        [item(project, 'text-1')?.from, item(project, 'text-1')?.durationInFrames],
        [5, 85],
      ),
    failure: { op: 'trimStart', id: 'missing', amount: 5 },
  },
  {
    name: 'trimEnd',
    op: { op: 'trimEnd', id: 'text-1', amount: 5 },
    assert: (project) => assert.equal(item(project, 'text-1')?.durationInFrames, 95),
    failure: { op: 'trimEnd', id: 'missing', amount: 5 },
  },
  {
    name: 'addTransition',
    op: {
      op: 'addTransition',
      leftClipId: 'clip-left',
      rightClipId: 'clip-right',
      type: 'crossfade',
      durationInFrames: 10,
      presentation: 'glitch',
      alignment: 0.4,
      properties: { intensity: 2 },
    },
    assert: (project) => {
      assert.equal(project.timeline.transitions.length, 1)
      const transition = project.timeline.transitions[0]
      assert.equal(transition.presentation, 'glitch')
      assert.equal(transition.alignment, 0.4)
      assert.deepEqual(transition.properties, { intensity: 2 })
    },
    failure: {
      op: 'addTransition',
      leftClipId: 'clip-left',
      rightClipId: 'missing',
      durationInFrames: 10,
    },
  },
  {
    name: 'updateTransition',
    op: { op: 'updateTransition', id: 'tr-x', presentation: 'wipe' },
    ops: [
      {
        op: 'addTransition',
        leftClipId: 'clip-left',
        rightClipId: 'clip-right',
        durationInFrames: 10,
        callerId: 'tr',
      },
      {
        op: 'updateTransition',
        id: { $ref: 'tr#/detail/id' },
        presentation: 'wipe',
        direction: 'from-left',
      },
    ],
    assert: (project) => {
      const transition = project.timeline.transitions[0]
      assert.equal(transition.presentation, 'wipe')
      assert.equal(transition.direction, 'from-left')
    },
    schemaFailure: { op: 'updateTransition', id: 'x', alignment: 2 },
  },
  {
    name: 'removeTransition',
    op: { op: 'removeTransition', id: 'tr-x' },
    ops: [
      {
        op: 'addTransition',
        leftClipId: 'clip-left',
        rightClipId: 'clip-right',
        durationInFrames: 10,
        callerId: 'tr',
      },
      { op: 'removeTransition', id: { $ref: 'tr#/detail/id' } },
    ],
    assert: (project) => assert.equal(project.timeline.transitions?.length ?? 0, 0),
    failure: { op: 'removeTransition', id: 'ghost' },
  },
  {
    name: 'setTransformParent',
    op: { op: 'setTransformParent', id: 'clip-right', parentItemId: 'clip-left' },
    assert: (project) => {
      const child = item(project, 'clip-right')
      assert.equal(child.transformParent?.parentItemId, 'clip-left')
      assert.ok(child.transformParent.childLocalReference.width > 0)
      assert.ok(child.transformParent.childWorldReference.width > 0)
    },
    failure: { op: 'setTransformParent', id: 'clip-right', parentItemId: 'missing' },
  },
  {
    name: 'addTrack',
    op: { op: 'addTrack', kind: 'audio', order: 9 },
    assert: (project) =>
      assert.ok(
        project.timeline.tracks.some((track) => track.kind === 'audio' && track.order === 9),
      ),
    schemaFailure: { op: 'addTrack', kind: 'data' },
  },
  {
    name: 'addClip',
    op: {
      op: 'addClip',
      mediaId: 'video-media',
      from: 20,
      durationInFrames: 30,
      trackId: 'video-1',
    },
    media: [
      {
        mediaId: 'video-media',
        metadata: {
          id: 'video-media',
          fileName: 'generated.mp4',
          mimeType: 'video/mp4',
          duration: 1,
          fps: 30,
          width: 320,
          height: 180,
          audioCodec: 'aac',
          audioCodecSupported: true,
        },
      },
    ],
    assert: (project) => {
      const linked = project.timeline.items.filter(
        (candidate) => candidate.mediaId === 'video-media',
      )
      assert.deepEqual(linked.map((candidate) => candidate.type).sort(), ['audio', 'video'])
      assert.equal(new Set(linked.map((candidate) => candidate.linkedGroupId)).size, 1)
    },
    failure: { op: 'addClip', mediaId: 'missing-media' },
  },
  {
    name: 'addKeyframe',
    op: {
      op: 'addKeyframe',
      itemId: 'text-1',
      property: 'opacity',
      frame: 10,
      value: 0.5,
      easing: 'linear',
    },
    assert: (project) =>
      assert.equal(project.timeline.keyframes[0]?.properties[0]?.keyframes[0]?.value, 0.5),
    failure: { op: 'addKeyframe', itemId: 'missing', property: 'opacity', frame: 10, value: 0.5 },
  },
  {
    name: 'removeKeyframes',
    ops: [
      { op: 'addKeyframe', itemId: 'text-1', property: 'opacity', frame: 10, value: 0.5 },
      { op: 'removeKeyframes', itemId: 'text-1', property: 'opacity' },
    ],
    op: { op: 'removeKeyframes', itemId: 'text-1', property: 'opacity' },
    assert: (project) =>
      assert.equal(
        project.timeline.keyframes.some(
          (group) =>
            group.itemId === 'text-1' &&
            group.properties.some((property) => property.property === 'opacity'),
        ),
        false,
      ),
    failure: { op: 'removeKeyframes', itemId: 'missing', property: 'opacity' },
  },
  {
    name: 'addEffect',
    op: { op: 'addEffect', itemId: 'text-1', gpuEffectType: 'gpu-invert', params: {} },
    assert: (project) => assert.equal(item(project, 'text-1')?.effects?.length, 1),
    failure: { op: 'addEffect', itemId: 'missing', gpuEffectType: 'gpu-invert', params: {} },
  },
  {
    name: 'removeEffect',
    setup: async (page) =>
      (
        await edit(page, baseProject(), [
          { op: 'addEffect', itemId: 'text-1', gpuEffectType: 'gpu-invert', params: {} },
        ])
      ).project,
    opFrom: (project) => ({
      op: 'removeEffect',
      itemId: 'text-1',
      effectId: item(project, 'text-1').effects[0].id,
    }),
    op: { op: 'removeEffect', itemId: 'text-1', effectId: 'effect-id' },
    assert: (project) => assert.equal(item(project, 'text-1')?.effects?.length ?? 0, 0),
    failure: { op: 'removeEffect', itemId: 'text-1', effectId: 'missing-effect' },
  },
  {
    name: 'setTransform',
    op: { op: 'setTransform', id: 'text-1', transform: { opacity: 0.4, x: 12 } },
    assert: (project) =>
      assert.deepEqual(
        [item(project, 'text-1')?.transform?.opacity, item(project, 'text-1')?.transform?.x],
        [0.4, 12],
      ),
    failure: { op: 'setTransform', id: 'missing', transform: { opacity: 0.4 } },
  },
  {
    name: 'addBlock',
    op: {
      op: 'addBlock',
      blockId: 'character-astronaut',
      from: 0,
      durationInFrames: 90,
      x: -120,
      y: 40,
      scale: 0.5,
      palette: 'deep-space',
      idPrefix: 'hero',
      gestures: [{ id: 'walk', cycles: 2 }],
    },
    assert: (project) => {
      // One path item per rigged part, each on its own track under one group.
      const parts = project.timeline.items.filter((candidate) => candidate.id.startsWith('hero-'))
      assert.equal(parts.length, 17)
      assert.equal(
        parts.every((candidate) => candidate.type === 'shape' && candidate.shapeType === 'path'),
        true,
      )
      // The armature has to survive the project round-trip, or the rig is just
      // a pile of unrelated shapes.
      assert.equal(item(project, 'hero-helmet')?.transformParent?.parentItemId, 'hero-torso')
      const walked = project.timeline.keyframes.filter((entry) => entry.itemId.startsWith('hero-'))
      assert.equal(walked.length > 0, true)
      // Derived follow-through: no gesture names the backpack.
      assert.equal(
        walked.some((entry) => entry.itemId === 'hero-backpack'),
        true,
      )
    },
    schemaFailure: { op: 'addBlock', blockId: 'character-unicorn' },
  },
  {
    name: 'applyGesture',
    op: { op: 'applyGesture', idPrefix: 'hero', gestureId: 'land-squash', scale: 0.5 },
    ops: [
      {
        op: 'addBlock',
        blockId: 'character-astronaut',
        durationInFrames: 60,
        scale: 0.5,
        idPrefix: 'hero',
      },
      { op: 'applyGesture', idPrefix: 'hero', gestureId: 'land-squash', scale: 0.5 },
    ],
    assert: (project) => {
      const torso = project.timeline.keyframes.find((entry) => entry.itemId === 'hero-torso')
      const lanes = torso.properties.map((entry) => entry.property).sort()
      // The squash is non-uniform, so it must reach width and height separately.
      assert.deepEqual(lanes, ['height', 'width'])
      const heights = torso.properties
        .find((entry) => entry.property === 'height')
        .keyframes.map((entry) => entry.value)
      assert.equal(Math.min(...heights) < Math.max(...heights), true)
    },
    failure: { op: 'applyGesture', idPrefix: 'not-placed', gestureId: 'walk' },
  },
  {
    name: 'applyPose',
    op: { op: 'applyPose', idPrefix: 'hero', poses: [{ id: 'point-forward' }] },
    ops: [
      {
        op: 'addBlock',
        blockId: 'character-astronaut',
        durationInFrames: 60,
        scale: 0.5,
        idPrefix: 'hero',
      },
      {
        op: 'applyPose',
        idPrefix: 'hero',
        poses: [
          { id: 'stand', at: 0 },
          { id: 'crouch', at: 0.5 },
          { id: 'stand', at: 1 },
        ],
        durationInFrames: 60,
        scale: 0.5,
      },
    ],
    assert: (project) => {
      const thigh = project.timeline.keyframes
        .find((entry) => entry.itemId === 'hero-thigh-near')
        .properties.find((entry) => entry.property === 'rotation')
      assert.deepEqual(
        thigh.keyframes.map((entry) => entry.frame),
        [0, 30, 60],
      )
      // Into the crouch and back to rest, so the sequence returns the pose.
      assert.equal(thigh.keyframes[1].value > thigh.keyframes[0].value, true)
      assert.equal(Math.abs(thigh.keyframes[2].value - thigh.keyframes[0].value) < 1e-6, true)
    },
    failure: { op: 'applyPose', idPrefix: 'not-placed', poses: [{ id: 'stand' }] },
  },
  {
    name: 'attachToSlot',
    op: { op: 'attachToSlot', idPrefix: 'hero', slotId: 'hand', itemId: 'text-1', scale: 0.5 },
    ops: [
      {
        op: 'addBlock',
        blockId: 'character-astronaut',
        durationInFrames: 60,
        scale: 0.5,
        idPrefix: 'hero',
      },
      { op: 'attachToSlot', idPrefix: 'hero', slotId: 'hand', itemId: 'text-1', scale: 0.5 },
    ],
    assert: (project) => {
      const attached = item(project, 'text-1')
      // Parented to the glove, so the label travels with the arm.
      assert.equal(attached?.transformParent?.parentItemId, 'hero-glove-near')
      // Slot 'hand' is at [110, 282] in a 200x400 block, so at scale 0.5 the
      // offset from the block centre is (5, 41).
      assert.deepEqual([attached?.transform?.x, attached?.transform?.y], [5, 41])
    },
    failure: { op: 'attachToSlot', idPrefix: 'not-placed', slotId: 'hand', itemId: 'text-1' },
  },
  {
    name: 'directAction',
    op: {
      op: 'directAction',
      idPrefix: 'hero',
      action: 'enter',
      direction: 'left',
      from: 0,
      durationInFrames: 24,
    },
    ops: [
      {
        op: 'addBlock',
        blockId: 'infra-token-card',
        durationInFrames: 60,
        scale: 0.5,
        idPrefix: 'hero',
      },
      {
        op: 'directAction',
        idPrefix: 'hero',
        action: 'enter',
        direction: 'left',
        from: 0,
        durationInFrames: 24,
      },
    ],
    assert: (project) => {
      const lane = (itemId, property) =>
        project.timeline.keyframes
          .find((entry) => entry.itemId === itemId)
          ?.properties.find((entry) => entry.property === property)
          ?.keyframes.map((entry) => entry.value)

      // The root travels in and lands exactly at rest.
      const xs = lane('hero-card', 'x')
      assert.ok(xs[0] < 0, `expected an off-screen start, got ${xs[0]}`)
      assert.equal(xs.at(-1), 0)
      // Every part fades, because opacity is not inherited down the chain.
      assert.equal(lane('hero-stripe', 'opacity')[0], 0)
      // Only the root translates, or the rig would come apart.
      assert.equal(lane('hero-stripe', 'x'), undefined)
    },
    failure: { op: 'directAction', idPrefix: 'not-placed', action: 'enter' },
  },
  {
    name: 'setCamera',
    op: { op: 'setCamera', itemId: 'text-1', intent: 'push', from: 0, durationInFrames: 30 },
    ops: [
      {
        op: 'addBlock',
        blockId: 'infra-token-card',
        durationInFrames: 60,
        scale: 0.5,
        x: -200,
        idPrefix: 'near',
      },
      {
        op: 'addBlock',
        blockId: 'infra-token-card',
        durationInFrames: 60,
        scale: 0.5,
        x: 200,
        idPrefix: 'far',
      },
      {
        op: 'setCamera',
        itemIds: ['near-card', 'far-card'],
        intent: 'pan-left',
        from: 0,
        durationInFrames: 30,
        planes: [
          { idPrefix: 'near', plane: 0 },
          { idPrefix: 'far', plane: 5 },
        ],
      },
    ],
    assert: (project) => {
      const shift = (itemId, rest) => {
        const values = project.timeline.keyframes
          .find((entry) => entry.itemId === itemId)
          .properties.find((entry) => entry.property === 'x')
          .keyframes.map((entry) => entry.value)
        return Math.abs(values.at(-1) - rest)
      }
      // Depth, not a flat slide: the foreground has to travel further.
      assert.ok(
        shift('near-card', -200) > shift('far-card', 200) * 2,
        'expected the near plane to pan further than the far plane',
      )
    },
    failure: { op: 'setCamera', itemId: 'missing-item', intent: 'push' },
  },
  {
    name: 'defineBlock',
    op: {
      op: 'defineBlock',
      blockId: 'local-figure',
      name: 'Figure',
      category: 'character',
      source:
        '<svg viewBox="0 0 200 400"><rect id="torso" x="70" y="100" width="60" height="140" ' +
        'fill="#47f"/><rect id="arm" x="120" y="110" width="24" height="90" fill="#235"/></svg>',
      parts: [
        { id: 'torso', fill: 'primary' },
        { id: 'arm', parent: 'torso', pivot: [130, 115], fill: 'ink' },
      ],
    },
    ops: [
      {
        op: 'defineBlock',
        blockId: 'local-figure',
        name: 'Figure',
        category: 'character',
        source:
          '<svg viewBox="0 0 200 400"><rect id="torso" x="70" y="100" width="60" height="140" ' +
          'fill="#47f"/><rect id="arm" x="120" y="110" width="24" height="90" fill="#235"/></svg>',
        parts: [
          { id: 'torso', fill: 'primary' },
          { id: 'arm', parent: 'torso', pivot: [130, 115], fill: 'ink' },
        ],
      },
      {
        op: 'addBlock',
        blockId: 'local-figure',
        from: 0,
        durationInFrames: 60,
        scale: 1,
        idPrefix: 'fig',
      },
      {
        op: 'directAction',
        idPrefix: 'fig',
        action: 'enter',
        direction: 'left',
        from: 0,
        durationInFrames: 20,
      },
    ],
    assert: (project) => {
      const items = project.timeline.items.filter((item) => item.id.startsWith('fig-'))
      assert.equal(items.length, 2)
      // Rigged, not a pile of paths: the arm hangs off the torso and turns at
      // the joint the caller named rather than at its own centre.
      const arm = items.find((item) => item.id === 'fig-arm')
      assert.equal(arm.transformParent?.parentItemId, 'fig-torso')
      assert.ok(Math.abs(arm.transform.anchorX - 10) < 0.001, `anchorX ${arm.transform.anchorX}`)
      // And generated art takes the same intent vocabulary as committed art.
      const xs = project.timeline.keyframes
        .find((entry) => entry.itemId === 'fig-torso')
        .properties.find((entry) => entry.property === 'x')
        .keyframes.map((entry) => entry.value)
      assert.ok(xs[0] < 0, `expected an off-screen start, got ${xs[0]}`)
      assert.equal(xs.at(-1), 0)
    },
    failure: {
      op: 'defineBlock',
      blockId: 'local-broken',
      name: 'Broken',
      source: '<svg viewBox="0 0 10 10"><rect id="a" width="4" height="4" fill="#fff"/></svg>',
      parts: [{ id: 'a', parent: 'ghost' }],
    },
  },
  {
    name: 'listBlocks',
    op: { op: 'listBlocks' },
    assert: () => {},
    ops: [{ op: 'listBlocks' }],
    schemaFailure: { op: 'listBlocks', surprise: true },
  },
  {
    name: 'importBlock',
    op: {
      op: 'importBlock',
      definition: {
        id: 'local-badge',
        name: 'Badge',
        category: 'prop',
        width: 100,
        height: 100,
        parts: [
          {
            id: 'body',
            label: 'Body',
            d: 'M 10 10 L 90 10 L 90 90 L 10 90 Z',
            fill: 'accent',
            z: 0,
          },
        ],
      },
    },
    assert: (project) => {
      assert.equal(project.blocks?.length, 1)
      assert.equal(project.blocks[0].definition.id, 'local-badge')
    },
    failure: {
      op: 'importBlock',
      definition: {
        id: 'local-broken',
        name: 'Broken',
        category: 'prop',
        width: 10,
        height: 10,
        parts: [
          { id: 'p', label: 'P', d: 'M 0 0 L 1 0 L 1 1 Z', parent: 'ghost', fill: 'ink', z: 0 },
        ],
      },
    },
  },
  {
    name: 'updateBlock',
    op: { op: 'updateBlock', blockId: 'local-badge', definition: { name: 'Badge mk2' } },
    ops: [
      {
        op: 'importBlock',
        definition: {
          id: 'local-badge',
          name: 'Badge',
          category: 'prop',
          width: 100,
          height: 100,
          parts: [
            {
              id: 'body',
              label: 'Body',
              d: 'M 10 10 L 90 10 L 90 90 L 10 90 Z',
              fill: 'accent',
              z: 0,
            },
          ],
        },
      },
      { op: 'updateBlock', blockId: 'local-badge', definition: { name: 'Badge mk2' } },
    ],
    assert: (project) => {
      assert.equal(project.blocks[0].definition.name, 'Badge mk2')
    },
    failure: { op: 'updateBlock', blockId: 'local-missing', definition: { name: 'x' } },
  },
  {
    name: 'removeBlock',
    op: { op: 'removeBlock', blockId: 'local-badge' },
    ops: [
      {
        op: 'importBlock',
        definition: {
          id: 'local-badge',
          name: 'Badge',
          category: 'prop',
          width: 100,
          height: 100,
          parts: [
            {
              id: 'body',
              label: 'Body',
              d: 'M 10 10 L 90 10 L 90 90 L 10 90 Z',
              fill: 'accent',
              z: 0,
            },
          ],
        },
      },
      {
        op: 'addBlock',
        blockId: 'local-badge',
        from: 0,
        durationInFrames: 30,
        idPrefix: 'badge',
      },
      { op: 'removeBlock', blockId: 'local-badge' },
    ],
    assert: (project) => {
      // The definition is gone and the project no longer carries the key at all.
      assert.equal(project.blocks, undefined)
      // What it already drew is untouched: lowered parts are ordinary shapes.
      assert.equal(project.timeline.items.filter((item) => item.id.startsWith('badge-')).length, 1)
    },
    failure: { op: 'removeBlock', blockId: 'local-never-existed' },
  },
  {
    name: 'setNarration',
    op: {
      op: 'setNarration',
      words: [
        { text: 'You', start: 0, end: 0.2 },
        { text: 'type', start: 0.2, end: 0.5 },
        { text: 'a', start: 0.5, end: 0.6 },
        { text: 'password.', start: 0.6, end: 1.2 },
      ],
    },
    ops: [
      {
        op: 'setNarration',
        words: [
          { text: 'You', start: 0, end: 0.2 },
          { text: 'type', start: 0.2, end: 0.5 },
          { text: 'a', start: 0.5, end: 0.6 },
          { text: 'password.', start: 0.6, end: 1.2 },
        ],
      },
      {
        op: 'addBlock',
        blockId: 'infra-token-card',
        from: 0,
        durationInFrames: 60,
        scale: 0.5,
        idPrefix: 'tok',
      },
      {
        op: 'directAction',
        idPrefix: 'tok',
        action: 'enter',
        direction: 'left',
        fromCue: { word: 'password' },
        untilCue: { word: 'password', edge: 'end' },
      },
    ],
    assert: (project) => {
      const frames = project.timeline.keyframes
        .find((entry) => entry.itemId === 'tok-card')
        .properties.find((entry) => entry.property === 'x')
        .keyframes.map((entry) => entry.frame)
      // The harness project runs at 30fps, so 0.6s..1.2s is frames 18..36 —
      // measured from the read rather than typed in.
      assert.equal(frames[0], 18)
      assert.equal(frames.at(-1), 36)
    },
    // Schema-valid and impossible to satisfy: the read never says it.
    failure: {
      op: 'setNarration',
      words: [{ text: 'hello', start: 0, end: 0.4 }],
    },
    schemaFailure: { op: 'setNarration' },
  },
  {
    name: 'importSvg',
    op: {
      op: 'importSvg',
      source: '<svg viewBox="0 0 20 20"><path d="M 0 0 L 20 0 L 20 20 Z" fill="#ff0000"/></svg>',
      name: 'Wedge',
      idPrefix: 'art',
      size: 240,
    },
    assert: (project) => {
      const imported = project.timeline.items.filter((candidate) => candidate.id.startsWith('art-'))
      assert.equal(imported.length, 1)
      assert.equal(imported[0].shapeType, 'path')
      assert.equal(imported[0].pathVertices.length > 0, true)
    },
    // A document with no drawable geometry is schema-valid and must fail loudly
    // rather than silently adding nothing.
    failure: { op: 'importSvg', source: '<svg viewBox="0 0 10 10"></svg>' },
  },
  {
    name: 'morphPath',
    op: {
      op: 'morphPath',
      itemId: 'art-0-0',
      fromFrame: 0,
      toFrame: 30,
      targetPathData: 'M 0 0 L 20 0 L 20 20 L 0 20 Z',
    },
    ops: [
      {
        op: 'importSvg',
        source: '<svg viewBox="0 0 20 20"><path d="M 0 0 L 20 0 L 20 20 Z"/></svg>',
        idPrefix: 'art',
        size: 240,
      },
      {
        op: 'morphPath',
        itemId: 'art-0-0',
        fromFrame: 0,
        toFrame: 30,
        targetPathData: 'M 0 0 L 20 0 L 20 20 L 0 20 Z',
        easing: 'ease-in-out',
      },
    ],
    assert: (project) => {
      const animated = project.timeline.keyframes.find((entry) => entry.itemId === 'art-0-0')
      assert.equal(animated.properties.length > 0, true)
      // Vertex lanes are keyed at both ends of the morph window.
      const frames = new Set(
        animated.properties.flatMap((entry) => entry.keyframes.map((key) => key.frame)),
      )
      assert.deepEqual(
        [...frames].sort((a, b) => a - b),
        [0, 30],
      )
    },
    failure: {
      op: 'morphPath',
      itemId: 'missing-path',
      fromFrame: 0,
      toFrame: 30,
      targetPathData: 'M 0 0 L 1 1',
    },
  },
]

async function edit(page, project, ops, media) {
  return page.evaluate((input) => window.freecut.editProject(input), { project, ops, media })
}

async function main() {
  const distDir = path.join(ROOT, 'dist')
  if (!fs.existsSync(path.join(distDir, 'headless.html'))) {
    throw new Error('dist/headless.html is missing; run npm run build first')
  }
  assert.deepEqual(
    cases.map(({ name }) => name).sort(),
    [...EDIT_OPERATION_NAMES].sort(),
    'schema/test operation parity',
  )
  for (const testCase of cases)
    assert.equal(
      editOpSchema.safeParse(testCase.op).success,
      true,
      `${testCase.name} success payload schema`,
    )

  const server = await createHarnessServer({ distDir })
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: chromeLaunchArgs(),
  })
  try {
    const page = await browser.newPage()
    await page.goto(server.harnessUrl, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })

    for (const testCase of cases) {
      const project = testCase.setup ? await testCase.setup(page) : baseProject()
      const operation = testCase.opFrom ? testCase.opFrom(project) : testCase.op
      const result = await edit(page, project, testCase.ops ?? [operation], testCase.media)
      assert.equal(result.ok, true, `${testCase.name} reports success`)
      testCase.assert(roundTrip(result.project))

      if (testCase.schemaFailure) {
        assert.equal(
          editOpSchema.safeParse(testCase.schemaFailure).success,
          false,
          `${testCase.name} rejects invalid schema`,
        )
      } else {
        assert.equal(
          editOpSchema.safeParse(testCase.failure).success,
          true,
          `${testCase.name} failure payload schema`,
        )
        await assert.rejects(
          edit(page, baseProject(), [testCase.failure]),
          undefined,
          `${testCase.name} meaningful failure`,
        )
      }
      process.stdout.write(`  PASS  ${testCase.name}\n`)
    }
  } finally {
    await browser.close()
    await server.close()
  }
  process.stdout.write(`All ${cases.length} edit operation contracts passed\n`)
}

main().catch((error) => {
  process.stderr.write(`Edit operation contract failed: ${error.stack ?? error}\n`)
  process.exitCode = 1
})
