// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { ASTRONAUT_BLOCK, IDLE_BREATH_GESTURE, WALK_GESTURE } from './character-astronaut'
import { instantiateBlock } from './instantiate'
import { DEEP_SPACE_PALETTE, DEFAULT_SCENE_PALETTE } from './scene-palette'
import type { BlockDefinition, GestureDefinition } from './types'
import { MOON_SURFACE_BLOCK, PARALLAX_PAN_GESTURE } from './world-moon'

/** 100x100 block with one 50x50 square at the origin. */
const simple: BlockDefinition = {
  id: 'simple',
  name: 'Simple',
  category: 'prop',
  width: 100,
  height: 100,
  parts: [{ id: 'body', label: 'Body', d: 'M 0 0 L 50 0 L 50 50 L 0 50 Z', fill: 'primary', z: 0 }],
}

const chained: BlockDefinition = {
  id: 'chained',
  name: 'Chained',
  category: 'character',
  width: 100,
  height: 100,
  parts: [
    { id: 'root', label: 'Root', d: 'M 0 0 L 20 0 L 20 20 L 0 20 Z', pivot: [10, 10], z: 0 },
    {
      id: 'limb',
      label: 'Limb',
      parent: 'root',
      d: 'M 20 0 L 40 0 L 40 20 L 20 20 Z',
      pivot: [20, 10],
      z: 1,
    },
  ],
}

const base = { palette: DEFAULT_SCENE_PALETTE, from: 0, durationInFrames: 60 }

describe('instantiateBlock', () => {
  it('creates one item and one track per drawn part, under a Layer Group', () => {
    const result = instantiateBlock({ ...base, block: ASTRONAUT_BLOCK })
    expect(result.items).toHaveLength(ASTRONAUT_BLOCK.parts.length)
    expect(result.tracks).toHaveLength(ASTRONAUT_BLOCK.parts.length + 1)
    expect(result.skipped).toEqual([])

    const [group, ...parts] = result.tracks
    expect(group).toMatchObject({ isGroup: true, name: 'Astronaut', items: [] })
    expect(parts.every((track) => track.parentTrackId === group!.id)).toBe(true)
    expect(parts.every((track) => track.items.length === 1)).toBe(true)
  })

  it('gives the frontmost part the lowest track order, since lower renders on top', () => {
    const result = instantiateBlock({ ...base, block: ASTRONAUT_BLOCK })
    const orderOf = (partId: string) =>
      result.tracks.find((track) => track.id.endsWith(`-track-${partId}`))?.order ?? -1
    // The near glove is the topmost part; the far arm is the deepest.
    expect(orderOf('glove-near')).toBeLessThan(orderOf('torso'))
    expect(orderOf('torso')).toBeLessThan(orderOf('arm-far'))
  })

  it('offsets the block from the canvas centre in block units times scale', () => {
    const result = instantiateBlock({ ...base, block: simple, placement: { scale: 2 } })
    // The square's centre sits at (25,25) in a 100x100 block, so 25 units up
    // and left of the block centre, doubled.
    expect(result.items[0]?.transform).toMatchObject({ x: -50, y: -50, width: 100, height: 100 })
  })

  it('translates the whole block by the placement offset', () => {
    const result = instantiateBlock({
      ...base,
      block: simple,
      placement: { x: 300, y: -120, scale: 1 },
    })
    expect(result.items[0]?.transform).toMatchObject({ x: 275, y: -145 })
  })

  it('anchors a rigged part at its joint rather than its bounding-box centre', () => {
    const result = instantiateBlock({ ...base, block: chained, placement: { scale: 2 } })
    const limb = result.items.find((item) => item.label === 'Limb')
    // Pivot (20,10) against bounds starting at (20,0), doubled.
    expect(limb?.transform).toMatchObject({ anchorX: 0, anchorY: 20 })
  })

  it('centres the anchor on parts with no declared joint', () => {
    const result = instantiateBlock({ ...base, block: simple, placement: { scale: 2 } })
    expect(result.items[0]?.transform).toMatchObject({ anchorX: 50, anchorY: 50 })
  })

  it('binds each child to its parent item so the armature carries motion', () => {
    const result = instantiateBlock({ ...base, block: chained })
    const root = result.items.find((item) => item.label === 'Root')!
    const limb = result.items.find((item) => item.label === 'Limb')!
    expect(root.transformParent).toBeUndefined()
    expect(limb.transformParent?.parentItemId).toBe(root.id)
  })

  it('binds with an identity basis, so the rest pose is exactly as authored', () => {
    const result = instantiateBlock({ ...base, block: chained })
    const limb = result.items.find((item) => item.label === 'Limb')!
    const binding = limb.transformParent!
    // Local and world references match at bind time; only a later parent delta
    // moves the child.
    expect(binding.childLocalReference).toEqual(binding.childWorldReference)
    expect(binding.parentReference).toBeDefined()
  })

  it('reproduces the full astronaut armature', () => {
    const result = instantiateBlock({ ...base, block: ASTRONAUT_BLOCK })
    const byLabel = new Map(result.items.map((item) => [item.id, item]))
    const shin = byLabel.get('character-astronaut-shin-near')!
    const thigh = byLabel.get('character-astronaut-thigh-near')!
    const boot = byLabel.get('character-astronaut-boot-near')!
    expect(shin.transformParent?.parentItemId).toBe(thigh.id)
    expect(boot.transformParent?.parentItemId).toBe(shin.id)
  })

  it('paints parts from the palette by role', () => {
    const warm = instantiateBlock({ ...base, block: simple })
    const cold = instantiateBlock({ ...base, block: simple, palette: DEEP_SPACE_PALETTE })
    expect(warm.items[0]?.fillColor).toBe(DEFAULT_SCENE_PALETTE.primary)
    expect(cold.items[0]?.fillColor).toBe(DEEP_SPACE_PALETTE.primary)
    expect(warm.items[0]?.fillEnabled).toBe(true)
  })

  it('leaves an unpainted part disabled rather than filling it with a guess', () => {
    const unpainted: BlockDefinition = {
      ...simple,
      parts: [{ ...simple.parts[0]!, fill: undefined }],
    }
    expect(instantiateBlock({ ...base, block: unpainted }).items[0]?.fillEnabled).toBe(false)
  })

  it('reports a part with no drawable geometry instead of emitting an empty item', () => {
    const broken: BlockDefinition = {
      ...simple,
      parts: [...simple.parts, { id: 'ghost', label: 'Ghost', d: 'M 5 5', z: 1 }],
    }
    const result = instantiateBlock({ ...base, block: broken })
    expect(result.items).toHaveLength(1)
    expect(result.skipped).toEqual([{ partId: 'ghost', reason: 'Part has no drawable geometry.' }])
  })

  it('namespaces ids so two instances of one block never collide', () => {
    const first = instantiateBlock({ ...base, block: ASTRONAUT_BLOCK, idPrefix: 'hero' })
    const second = instantiateBlock({ ...base, block: ASTRONAUT_BLOCK, idPrefix: 'extra' })
    const overlap = new Set(first.items.map((item) => item.id))
    expect(second.items.some((item) => overlap.has(item.id))).toBe(false)
  })
})

describe('partial inserts', () => {
  it('inserts only the requested parts', () => {
    const result = instantiateBlock({ ...base, block: ASTRONAUT_BLOCK, partIds: ['helmet'] })
    expect(result.items.map((item) => item.label).sort()).toEqual(['Helmet', 'Torso'])
  })

  it('pulls in ancestors so a partial insert stays articulated', () => {
    // A boot without its shin and thigh would bind to items that do not exist.
    const result = instantiateBlock({ ...base, block: ASTRONAUT_BLOCK, partIds: ['boot-near'] })
    const ids = result.items.map((item) => item.id)
    expect(ids).toContain('character-astronaut-shin-near')
    expect(ids).toContain('character-astronaut-thigh-near')
    const boot = result.items.find((item) => item.id.endsWith('-boot-near'))!
    expect(ids).toContain(boot.transformParent!.parentItemId!)
  })

  it('never leaves a child bound to a part that was not created', () => {
    const result = instantiateBlock({
      ...base,
      block: ASTRONAUT_BLOCK,
      partIds: ['glove-near', 'visor'],
    })
    const ids = new Set(result.items.map((item) => item.id))
    for (const item of result.items) {
      const parentId = item.transformParent?.parentItemId
      if (parentId)
        expect({ item: item.id, bound: ids.has(parentId) }).toEqual({ item: item.id, bound: true })
    }
  })

  it('treats an empty or unknown selection as the whole block', () => {
    expect(instantiateBlock({ ...base, block: ASTRONAUT_BLOCK, partIds: [] }).items).toHaveLength(
      ASTRONAUT_BLOCK.parts.length,
    )
    expect(
      instantiateBlock({ ...base, block: ASTRONAUT_BLOCK, partIds: ['nope'] }).items,
    ).toHaveLength(0)
  })

  it('keeps front-to-back order within a subset', () => {
    const result = instantiateBlock({
      ...base,
      block: ASTRONAUT_BLOCK,
      partIds: ['glove-near', 'backpack'],
    })
    const orderOf = (partId: string) =>
      result.tracks.find((track) => track.id.endsWith(`-track-${partId}`))?.order ?? -1
    expect(orderOf('glove-near')).toBeLessThan(orderOf('backpack'))
  })
})

describe('gesture application', () => {
  const walking = () =>
    instantiateBlock({
      ...base,
      block: ASTRONAUT_BLOCK,
      gestures: [{ gesture: WALK_GESTURE, cycles: 2 }],
    })

  const lane = (result: ReturnType<typeof instantiateBlock>, itemId: string, property: string) =>
    result.keyframes
      .find((entry) => entry.itemId === itemId)
      ?.properties.find((entry) => entry.property === property)

  it('writes rotation lanes for every driven limb', () => {
    const result = walking()
    const thigh = lane(result, 'character-astronaut-thigh-near', 'rotation')
    expect(thigh?.keyframes.length).toBeGreaterThan(16)
    // Rest rotation is 0, so the contribution is the value.
    expect(thigh?.keyframes[0]?.value).toBeCloseTo(-24, 6)
  })

  it('leaves undriven parts with no animation data', () => {
    // `visor-glint` is deliberately not used here: the walk turns the helmet, and
    // the block's secondary links derive a glint slide from that, so the only
    // genuinely untouched parts are the ones no gesture and no link reaches.
    expect(walking().keyframes.some((entry) => entry.itemId.endsWith('chest-panel'))).toBe(false)
    expect(walking().keyframes.some((entry) => entry.itemId.endsWith('glove-near'))).toBe(false)
  })

  it('adds positional contributions to the part rest pose, in canvas pixels', () => {
    const result = instantiateBlock({
      ...base,
      block: ASTRONAUT_BLOCK,
      placement: { scale: 2 },
      gestures: [{ gesture: WALK_GESTURE }],
    })
    const torso = result.items.find((item) => item.id.endsWith('-torso'))!
    const lane = result.keyframes
      .find((entry) => entry.itemId === torso.id)!
      .properties.find((entry) => entry.property === 'y')!
    // The body peaks 4 block units up at the passing pose, doubled by scale.
    const lowest = Math.min(...lane.keyframes.map((keyframe) => keyframe.value))
    expect(lowest).toBeCloseTo(torso.transform!.y! - 8, 6)
  })

  it('sums two gestures driving the same channel rather than letting one win', () => {
    const both = instantiateBlock({
      ...base,
      block: ASTRONAUT_BLOCK,
      gestures: [{ gesture: WALK_GESTURE }, { gesture: IDLE_BREATH_GESTURE }],
    })
    const walkOnly = instantiateBlock({
      ...base,
      block: ASTRONAUT_BLOCK,
      gestures: [{ gesture: WALK_GESTURE }],
    })
    const peak = (result: ReturnType<typeof instantiateBlock>) => {
      const values = lane(result, 'character-astronaut-torso', 'y')!.keyframes.map((k) => k.value)
      return Math.min(...values)
    }
    // Breath lifts the torso further than the walk alone.
    expect(peak(both)).toBeLessThan(peak(walkOnly))
  })

  it('scales contributions by intensity', () => {
    const soft = instantiateBlock({
      ...base,
      block: ASTRONAUT_BLOCK,
      gestures: [{ gesture: WALK_GESTURE, intensity: 0.5 }],
    })
    expect(
      lane(soft, 'character-astronaut-thigh-near', 'rotation')?.keyframes[0]?.value,
    ).toBeCloseTo(-12, 6)
  })

  it('clamps an opacity contribution into a renderable range', () => {
    const result = instantiateBlock({
      ...base,
      block: MOON_SURFACE_BLOCK,
      gestures: [
        { gesture: { ...PARALLAX_PAN_GESTURE, id: 'x' }, intensity: 1 },
        {
          gesture: {
            id: 'blast',
            name: 'Blast',
            loop: false,
            tracks: [
              {
                partId: 'sky',
                channel: 'opacity',
                keyframes: [
                  { at: 0, value: -9, easing: 'linear' },
                  { at: 1, value: 9, easing: 'linear' },
                ],
              },
            ],
          },
        },
      ],
    })
    const values = result.keyframes
      .find((entry) => entry.itemId.endsWith('-sky'))!
      .properties.find((entry) => entry.property === 'opacity')!
      .keyframes.map((keyframe) => keyframe.value)
    expect(Math.min(...values)).toBe(0)
    expect(Math.max(...values)).toBe(1)
  })

  it('declares separated component lanes so the dopesheet reads them correctly', () => {
    const result = walking()
    const torso = result.keyframes.find((entry) => entry.itemId.endsWith('-torso'))!
    expect(torso.animationVersion).toBe(2)
    expect(torso.separatedVectorProperties).toContain('position')
  })

  it('generates deterministic keyframe ids', () => {
    const first = walking()
    const second = walking()
    expect(first.keyframes).toEqual(second.keyframes)
  })
})

describe('an astronaut walking on the moon', () => {
  const FPS = 30
  const SECONDS = 6
  const duration = FPS * SECONDS

  const moon = instantiateBlock({
    block: MOON_SURFACE_BLOCK,
    palette: DEEP_SPACE_PALETTE,
    from: 0,
    durationInFrames: duration,
    placement: { scale: 1 },
    gestures: [{ gesture: PARALLAX_PAN_GESTURE }],
    baseTrackOrder: 20,
  })

  const hero = instantiateBlock({
    block: ASTRONAUT_BLOCK,
    palette: DEEP_SPACE_PALETTE,
    from: 0,
    durationInFrames: duration,
    // Feet on the ground: the block is 400 tall and the horizon sits at 760.
    placement: { x: -180, y: 190, scale: 0.9 },
    gestures: [{ gesture: WALK_GESTURE, cycles: SECONDS }, { gesture: IDLE_BREATH_GESTURE }],
    baseTrackOrder: 0,
  })

  it('builds a complete scene from two blocks', () => {
    expect(moon.skipped).toEqual([])
    expect(hero.skipped).toEqual([])
    expect(moon.items.length + hero.items.length).toBeGreaterThan(30)
  })

  it('keeps the character in front of the world', () => {
    const deepestHeroTrack = Math.max(...hero.tracks.map((track) => track.order))
    const nearestMoonTrack = Math.min(...moon.tracks.map((track) => track.order))
    expect(deepestHeroTrack).toBeLessThan(nearestMoonTrack)
  })

  it('never collides an id between the two blocks', () => {
    const ids = [...moon.items, ...hero.items].map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    const trackIds = [...moon.tracks, ...hero.tracks].map((track) => track.id)
    expect(new Set(trackIds).size).toBe(trackIds.length)
  })

  it('walks one cycle per second and holds every keyframe inside the clip', () => {
    const thigh = hero.keyframes.find((entry) => entry.itemId.endsWith('-thigh-near'))!
    const rotation = thigh.properties.find((entry) => entry.property === 'rotation')!
    expect(rotation.keyframes.at(-1)?.frame).toBe(duration)
    expect(rotation.keyframes.every((keyframe) => keyframe.frame >= 0)).toBe(true)
    // Six cycles of sixteen samples, sharing boundaries, plus the close.
    expect(rotation.keyframes).toHaveLength(SECONDS * 16 + 1)
  })

  it('drifts the ground faster than the sky', () => {
    const travel = (partId: string) => {
      const item = moon.items.find((entry) => entry.id.endsWith(`-${partId}`))!
      const lane = moon.keyframes
        .find((entry) => entry.itemId === item.id)!
        .properties.find((entry) => entry.property === 'x')!
      return Math.abs(lane.keyframes.at(-1)!.value - lane.keyframes[0]!.value)
    }
    expect(travel('rock-near')).toBeGreaterThan(travel('ground'))
    expect(travel('ground')).toBeGreaterThan(travel('sky'))
  })
})

describe('non-uniform scale channels', () => {
  /** A squash that flattens and widens by the same factor. */
  const squash: GestureDefinition = {
    id: 'squash',
    name: 'Squash',
    loop: false,
    tracks: [
      {
        partId: 'body',
        channel: 'scaleY',
        keyframes: [
          { at: 0, value: 0, easing: 'linear' },
          { at: 1, value: -0.5, easing: 'linear' },
        ],
      },
      {
        partId: 'body',
        channel: 'scaleX',
        keyframes: [
          { at: 0, value: 0, easing: 'linear' },
          { at: 1, value: 0.5, easing: 'linear' },
        ],
      },
    ],
  }

  const lane = (result: ReturnType<typeof instantiateBlock>, property: string) =>
    result.keyframes[0]?.properties.find((entry) => entry.property === property)

  it('writes width and height independently', () => {
    const result = instantiateBlock({ ...base, block: simple, gestures: [{ gesture: squash }] })
    // The part is 50x50 at scale 1, so a -0.5/+0.5 pair lands on 25 and 75.
    expect(lane(result, 'height')?.keyframes.at(-1)?.value).toBeCloseTo(25, 6)
    expect(lane(result, 'width')?.keyframes.at(-1)?.value).toBeCloseTo(75, 6)
  })

  it('sums a uniform scale and an axis scale on the same part', () => {
    const uniform: GestureDefinition = {
      id: 'shrink',
      name: 'Shrink',
      loop: false,
      tracks: [
        {
          partId: 'body',
          channel: 'scale',
          keyframes: [
            { at: 0, value: 0, easing: 'linear' },
            { at: 1, value: -0.2, easing: 'linear' },
          ],
        },
      ],
    }
    const result = instantiateBlock({
      ...base,
      block: simple,
      gestures: [{ gesture: squash }, { gesture: uniform }],
    })
    // width: 1 + 0.5 - 0.2 = 1.3; height: 1 - 0.5 - 0.2 = 0.3. A per-channel
    // emit would have let one of the two silently replace the other.
    expect(lane(result, 'width')?.keyframes.at(-1)?.value).toBeCloseTo(65, 6)
    expect(lane(result, 'height')?.keyframes.at(-1)?.value).toBeCloseTo(15, 6)
  })

  it('marks the scale lanes as separated so the dopesheet shows both', () => {
    const result = instantiateBlock({ ...base, block: simple, gestures: [{ gesture: squash }] })
    expect(result.keyframes[0]?.separatedVectorProperties).toContain('scale')
  })
})

describe('secondary motion', () => {
  const walking = (overrides: Partial<Parameters<typeof instantiateBlock>[0]> = {}) =>
    instantiateBlock({
      ...base,
      block: ASTRONAUT_BLOCK,
      fps: 30,
      gestures: [{ gesture: WALK_GESTURE, cycles: 2 }],
      ...overrides,
    })

  const forItem = (result: ReturnType<typeof instantiateBlock>, suffix: string) =>
    result.keyframes.find((entry) => entry.itemId.endsWith(suffix))

  it('drives the backpack even though no gesture names it', () => {
    // The walk moves the torso; the backpack is derived from that.
    expect(WALK_GESTURE.tracks.some((track) => track.partId === 'backpack')).toBe(false)
    expect(forItem(walking(), 'backpack')).toBeDefined()
  })

  it('writes every channel its links declare', () => {
    const backpack = forItem(walking(), 'backpack')
    expect(backpack?.properties.map((entry) => entry.property).sort()).toEqual(['rotation', 'y'])
  })

  it('trails the driver instead of matching it frame for frame', () => {
    const result = walking()
    const torso = forItem(result, '-torso')?.properties.find((e) => e.property === 'y')
    const backpack = forItem(result, 'backpack')?.properties.find((e) => e.property === 'y')
    expect(torso?.keyframes[0]?.value).not.toBeCloseTo(backpack?.keyframes[0]?.value ?? 0, 3)
  })

  it('can be switched off, leaving only the authored gestures', () => {
    expect(forItem(walking({ disableSecondaryMotion: true }), 'backpack')).toBeUndefined()
  })

  it('produces the same keyframes on every run', () => {
    expect(walking().keyframes).toEqual(walking().keyframes)
  })

  it('does not fire when the block is inserted without gestures', () => {
    expect(instantiateBlock({ ...base, block: ASTRONAUT_BLOCK, fps: 30 }).keyframes).toEqual([])
  })

  it('skips a link whose driver part was left out of a partial insert', () => {
    // `helmet` drives the glint, so a torso-only insert must not invent one.
    const partial = walking({ partIds: ['backpack'] })
    expect(forItem(partial, 'visor-glint')).toBeUndefined()
  })
})
