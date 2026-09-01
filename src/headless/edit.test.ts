import { describe, expect, it } from 'vite-plus/test'
import type { Project, ProjectTimeline } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'
import { editProject, type EditOp } from './edit'

/**
 * Integration tests through the REAL timeline stores/actions (the module
 * hydrates stores from the project and serializes them back) — this is the
 * interpreter every headless montage build runs on.
 */

function baseProject(timeline?: Partial<ProjectTimeline>): Project {
  return {
    id: 'p1',
    name: 'edit-test',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 300,
    schemaVersion: 14,
    metadata: { width: 1920, height: 1080, fps: 25 },
    timeline: {
      tracks: [
        {
          id: 't_v',
          name: 'V1',
          kind: 'video',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
        },
      ],
      items: [],
      transitions: [],
      keyframes: [],
      currentFrame: 0,
      zoomLevel: 1,
      scrollPosition: 0,
      ...timeline,
    } as ProjectTimeline,
  } as Project
}

const videoMedia: MediaMetadata = {
  id: 'm-vid',
  fileName: 'clip.mp4',
  fileSize: 1,
  mimeType: 'video/mp4',
  duration: 4,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: 'h264',
  audioCodec: 'aac',
  bitrate: 1,
} as MediaMetadata

describe('editProject', () => {
  it('addText places a text item with defaults on the existing video track', async () => {
    const result = await editProject({
      project: baseProject(),
      ops: [{ op: 'addText', text: 'Привет', from: 10 } as EditOp],
    })
    expect(result.applied).toBe(1)
    const items = result.project.timeline!.items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: 'text',
      text: 'Привет',
      trackId: 't_v',
      from: 10,
      durationInFrames: 90,
    })
  })

  it('a project with zero tracks gets a default track during hydration (addText still lands)', async () => {
    const result = await editProject({
      project: baseProject({ tracks: [] }),
      ops: [{ op: 'addText', text: 'x' } as EditOp],
    })
    expect(result.project.timeline!.items).toHaveLength(1)
    const trackId = result.project.timeline!.items[0]!.trackId
    expect(result.project.timeline!.tracks.some((t) => t.id === trackId)).toBe(true)
  })

  it('addTrack follows the order convention: video on top, audio at the bottom', async () => {
    const result = await editProject({
      project: baseProject(),
      ops: [
        { op: 'addTrack', kind: 'video' } as EditOp,
        { op: 'addTrack', kind: 'audio' } as EditOp,
      ],
    })
    const tracks = result.project.timeline!.tracks
    const orders = Object.fromEntries(tracks.map((t) => [t.kind ?? 'video', t.order]))
    const video = tracks.filter((t) => (t.kind ?? 'video') === 'video').map((t) => t.order)
    // New video track goes above the existing one (order 0 → min-1 = -1).
    expect(Math.min(...video)).toBe(-1)
    expect(orders['audio']).toBe(1)
  })

  it('resolves $ref chains between operations (track from a prior op)', async () => {
    const result = await editProject({
      project: baseProject(),
      ops: [
        { op: 'addTrack', kind: 'video', callerId: 'newTrack' } as EditOp,
        {
          op: 'addText',
          text: 'on new track',
          trackId: { $ref: 'newTrack#/detail/trackId' },
        } as EditOp,
      ],
    })
    const trackId = (result.results[0]!.detail as { trackId: string }).trackId
    const item = result.project.timeline!.items[0]!
    expect(item.trackId).toBe(trackId)
    expect(item.trackId).not.toBe('t_v')
  })

  it('split produces left/right ids and both halves land in the project', async () => {
    const result = await editProject({
      project: baseProject(),
      ops: [
        { op: 'addText', text: 'x', from: 0, durationInFrames: 100, callerId: 'a' } as EditOp,
        { op: 'split', id: { $ref: 'a#/detail/id' }, frame: 40 } as EditOp,
      ],
    })
    const detail = result.results[1]!.detail as { leftId: string; rightId: string }
    expect(detail.leftId).toBeTruthy()
    expect(detail.rightId).toBeTruthy()
    const items = result.project.timeline!.items
    expect(items.map((i) => i.durationInFrames).sort((a, b) => a - b)).toEqual([40, 60])
    expect(items.find((i) => i.id === detail.rightId)!.from).toBe(40)
  })

  it('removeItems accepts $ref inside the ids array', async () => {
    const result = await editProject({
      project: baseProject(),
      ops: [
        { op: 'addText', text: 'x', callerId: 'a' } as EditOp,
        { op: 'removeItems', ids: [{ $ref: 'a#/detail/id' }] } as EditOp,
      ],
    })
    expect(result.project.timeline!.items).toHaveLength(0)
  })

  it('rejects duplicate callerIds', async () => {
    await expect(
      editProject({
        project: baseProject(),
        ops: [
          { op: 'addText', text: 'x', callerId: 'dup' } as EditOp,
          { op: 'addText', text: 'y', callerId: 'dup' } as EditOp,
        ],
      }),
    ).rejects.toThrow(/Duplicate edit callerId/)
  })

  it('rejects a $ref to an unknown prior operation', async () => {
    await expect(
      editProject({
        project: baseProject(),
        ops: [{ op: 'addText', text: 'x', trackId: { $ref: 'nope#/detail/trackId' } } as EditOp],
      }),
    ).rejects.toThrow(/not a prior successful operation/)
  })

  it('rejects $ref in non-id fields (no data smuggling through refs)', async () => {
    await expect(
      editProject({
        project: baseProject(),
        ops: [
          { op: 'addText', text: 'x', callerId: 'a' } as EditOp,
          { op: 'addText', text: { $ref: 'a#/detail/id' } } as EditOp,
        ],
      }),
    ).rejects.toThrow(/\$ref is not allowed/)
  })

  it('addClip (video with audio) creates a linked audio companion with source-native frames', async () => {
    const result = await editProject({
      project: baseProject(),
      ops: [{ op: 'addClip', mediaId: 'm-vid', from: 5 } as EditOp],
      media: [{ mediaId: 'm-vid', metadata: videoMedia }],
    })
    const items = result.project.timeline!.items
    expect(items).toHaveLength(2)
    const video = items.find((i) => i.type === 'video')!
    const audio = items.find((i) => i.type === 'audio')!
    // Linked pair shares the group and the source cut.
    expect((video as { linkedGroupId?: string }).linkedGroupId).toBeTruthy()
    expect((audio as { linkedGroupId?: string }).linkedGroupId).toBe(
      (video as { linkedGroupId?: string }).linkedGroupId,
    )
    // 4s at source fps 30 → sourceEnd 120 (source-native frames, not project fps).
    expect(video).toMatchObject({ sourceStart: 0, sourceEnd: 120, sourceFps: 30 })
    // 4s at project fps 25 → 100 timeline frames.
    expect(video.durationInFrames).toBe(100)
    // The audio companion got its own bottom track.
    const audioTrack = result.project.timeline!.tracks.find((t) => t.id === audio.trackId)!
    expect(audioTrack.kind).toBe('audio')
  })

  it('addClip image defaults to a 150-frame still', async () => {
    const result = await editProject({
      project: baseProject(),
      ops: [{ op: 'addClip', mediaId: 'm-img' } as EditOp],
      media: [
        {
          mediaId: 'm-img',
          metadata: {
            ...videoMedia,
            id: 'm-img',
            mimeType: 'image/png',
            audioCodec: undefined,
          } as MediaMetadata,
        },
      ],
    })
    expect(result.project.timeline!.items[0]).toMatchObject({
      type: 'image',
      durationInFrames: 150,
      mediaId: 'm-img',
    })
  })

  it('setTransform initializes an addClip image that has no stored transform', async () => {
    const result = await editProject({
      project: baseProject(),
      ops: [
        { op: 'addClip', mediaId: 'm-img', callerId: 'clip' } as EditOp,
        {
          op: 'setTransform',
          id: { $ref: 'clip#/detail/created/0/id' },
          transform: { x: 12, y: 34, width: 320, height: 480 },
        } as EditOp,
      ],
      media: [
        {
          mediaId: 'm-img',
          metadata: {
            ...videoMedia,
            id: 'm-img',
            mimeType: 'image/png',
            audioCodec: undefined,
          } as MediaMetadata,
        },
      ],
    })

    expect(result.project.timeline!.items[0]?.transform).toMatchObject({
      x: 12,
      y: 34,
      width: 320,
      height: 480,
    })
  })

  const adjacentVideoTimeline = () => ({
    items: [
      {
        id: 'A',
        type: 'video',
        trackId: 't_v',
        from: 0,
        durationInFrames: 50,
        mediaId: 'm-vid',
        sourceStart: 15,
        sourceEnd: 75,
        sourceDuration: 120,
        speed: 1,
        label: 'A',
      },
      {
        id: 'B',
        type: 'video',
        trackId: 't_v',
        from: 50,
        durationInFrames: 50,
        mediaId: 'm-vid',
        sourceStart: 55,
        sourceEnd: 115,
        sourceDuration: 120,
        speed: 1,
        label: 'B',
      },
    ] as never,
  })

  it('addTransition carries GPU presentation, alignment and shader properties', async () => {
    const result = await editProject({
      project: baseProject(adjacentVideoTimeline()),
      media: [{ mediaId: 'm-vid', metadata: videoMedia }],
      ops: [
        {
          op: 'addTransition',
          leftClipId: 'A',
          rightClipId: 'B',
          durationInFrames: 10,
          presentation: 'glitch',
          alignment: 0.4,
          timing: 'ease-in-out',
          properties: { intensity: 2 },
          callerId: 'tr',
        } as EditOp,
      ],
    })
    const transitions = result.project.timeline!.transitions!
    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toMatchObject({
      type: 'crossfade',
      leftClipId: 'A',
      rightClipId: 'B',
      durationInFrames: 10,
      presentation: 'glitch',
      alignment: 0.4,
      timing: 'ease-in-out',
      properties: { intensity: 2 },
    })
    expect((result.results[0]!.detail as { id?: string }).id).toBe(transitions[0]!.id)
  })

  it('updateTransition and removeTransition round-trip through $ref', async () => {
    const base = {
      project: baseProject(adjacentVideoTimeline()),
      media: [{ mediaId: 'm-vid', metadata: videoMedia }],
    }
    const updated = await editProject({
      ...base,
      ops: [
        { op: 'addTransition', leftClipId: 'A', rightClipId: 'B', callerId: 'tr' } as EditOp,
        {
          op: 'updateTransition',
          id: { $ref: 'tr#/detail/id' },
          presentation: 'wipe',
          direction: 'from-left',
        } as EditOp,
      ],
    })
    expect(updated.project.timeline!.transitions![0]).toMatchObject({
      presentation: 'wipe',
      direction: 'from-left',
    })

    const removed = await editProject({
      ...base,
      ops: [
        { op: 'addTransition', leftClipId: 'A', rightClipId: 'B', callerId: 'tr' } as EditOp,
        { op: 'removeTransition', id: { $ref: 'tr#/detail/id' } } as EditOp,
      ],
    })
    expect(removed.project.timeline!.transitions ?? []).toHaveLength(0)
  })

  it('updateTransition fails loudly when the store rejects the new duration', async () => {
    // Regression: the store action validates against the handles available on
    // both clips and, on rejection, only logs — it returns void. The op used to
    // report ok while the transition kept its old duration.
    await expect(
      editProject({
        project: baseProject(adjacentVideoTimeline()),
        media: [{ mediaId: 'm-vid', metadata: videoMedia }],
        ops: [
          { op: 'addTransition', leftClipId: 'A', rightClipId: 'B', callerId: 'tr' } as EditOp,
          {
            op: 'updateTransition',
            id: { $ref: 'tr#/detail/id' },
            // Far longer than either clip, so no handle arrangement can fit it.
            durationInFrames: 100_000,
          } as EditOp,
        ],
      }),
    ).rejects.toThrow(/was rejected: durationInFrames=100000/)
  })

  it('removeTransition on an unknown id fails loudly', async () => {
    await expect(
      editProject({
        project: baseProject(adjacentVideoTimeline()),
        ops: [{ op: 'removeTransition', id: 'ghost' } as EditOp],
      }),
    ).rejects.toThrow('transition "ghost" does not exist')
  })

  it('setTransformParent binds via the real action and round-trips the binding', async () => {
    const result = await editProject({
      project: baseProject(adjacentVideoTimeline()),
      media: [{ mediaId: 'm-vid', metadata: videoMedia }],
      ops: [{ op: 'setTransformParent', id: 'B', parentItemId: 'A' } as EditOp],
    })
    const child = result.project.timeline!.items.find((item) => item.id === 'B') as Record<
      string,
      unknown
    >
    const binding = child.transformParent as {
      parentItemId?: string
      parentReference?: { width: number }
      childLocalReference: { width: number }
      childWorldReference: { width: number }
    }
    expect(binding?.parentItemId).toBe('A')
    // The action computes bind references from resolved transforms — all present and sane.
    expect(binding.childLocalReference.width).toBeGreaterThan(0)
    expect(binding.childWorldReference.width).toBeGreaterThan(0)
    expect(binding.parentReference?.width).toBeGreaterThan(0)

    const detached = await editProject({
      project: result.project,
      media: [{ mediaId: 'm-vid', metadata: videoMedia }],
      ops: [{ op: 'setTransformParent', id: 'B', parentItemId: null } as EditOp],
    })
    const freed = detached.project.timeline!.items.find((item) => item.id === 'B') as {
      transformParent?: { parentItemId?: string }
    }
    // Detach keeps the bind-space record but drops the parent link.
    expect(freed.transformParent?.parentItemId).toBeUndefined()
  })

  it('setTransformParent fails loudly on a missing parent', async () => {
    await expect(
      editProject({
        project: baseProject(adjacentVideoTimeline()),
        ops: [{ op: 'setTransformParent', id: 'A', parentItemId: 'ghost' } as EditOp],
      }),
    ).rejects.toThrow('parentItemId: item "ghost" does not exist')
  })

  it('addKeyframe carries a custom spring easingConfig', async () => {
    const result = await editProject({
      project: baseProject(adjacentVideoTimeline()),
      ops: [
        {
          op: 'addKeyframe',
          itemId: 'A',
          property: 'rotation',
          frame: 0,
          value: 0,
          easing: 'spring',
          easingConfig: { type: 'spring', spring: { tension: 300, friction: 10, mass: 1 } },
        } as EditOp,
      ],
    })
    const group = result.project.timeline!.keyframes!.find(
      (candidate) => candidate.itemId === 'A',
    ) as unknown as {
      properties: Array<{ property: string; keyframes: Array<Record<string, unknown>> }>
    }
    const rotation = group.properties.find((candidate) => candidate.property === 'rotation')!
    expect(rotation.keyframes[0]).toMatchObject({
      easing: 'spring',
      easingConfig: { type: 'spring', spring: { tension: 300, friction: 10, mass: 1 } },
    })
  })
})

describe('rigged block ops', () => {
  const place = async (extra: EditOp[] = []) =>
    editProject({
      project: baseProject(),
      ops: [
        { op: 'addBlock', blockId: 'character-astronaut', durationInFrames: 60, scale: 2 },
        ...extra,
      ],
    })

  /** Every keyframe written for one part item and property. */
  const lane = (project: Project, suffix: string, property: string) =>
    project.timeline?.keyframes
      ?.find((entry) => entry.itemId.endsWith(suffix))
      ?.properties.find((entry) => entry.property === property)

  /** `addBlock` reports the prefix it namespaced the instance with. */
  const prefixOf = (result: Awaited<ReturnType<typeof editProject>>) =>
    (result.results[0] as { detail: { idPrefix: string } }).detail.idPrefix

  /** Ids are generated, so a follow-up op has to read the one that was made. */
  const idOf = (result: Awaited<ReturnType<typeof editProject>>, index: number) =>
    (result.results[index] as { detail: { id: string } }).detail.id

  it('lowers a block into one item per part', async () => {
    const { project } = await place()
    const parts = project.timeline?.items?.filter((item) => item.id.includes('character-astronaut'))
    expect(parts?.length).toBe(17)
  })

  it('bakes a gesture onto an existing instance', async () => {
    const first = await place()
    const prefix = prefixOf(first)
    const { project } = await editProject({
      project: first.project,
      ops: [{ op: 'applyGesture', idPrefix: prefix, gestureId: 'walk', cycles: 2, scale: 2 }],
    })
    expect(lane(project, '-thigh-near', 'rotation')?.keyframes.length).toBeGreaterThan(16)
  })

  it('applies the scale channel, which a per-channel copy used to drop', async () => {
    const first = await place()
    const prefix = prefixOf(first)
    const before = first.project.timeline?.items?.find((item) => item.id.endsWith('-torso'))
    const { project } = await editProject({
      project: first.project,
      ops: [{ op: 'applyGesture', idPrefix: prefix, gestureId: 'land-squash', scale: 2 }],
    })

    const height = lane(project, '-torso', 'height')
    const width = lane(project, '-torso', 'width')
    expect(height?.keyframes.length).toBeGreaterThan(2)
    expect(width?.keyframes.length).toBeGreaterThan(2)

    // The squash flattens to -22% and widens to +18% of the authored box.
    const restHeight = before?.transform?.height ?? 0
    const flattest = Math.min(...(height?.keyframes.map((k) => k.value) ?? []))
    expect(flattest).toBeCloseTo(restHeight * 0.78, 4)
  })

  it('holds a named pose on an instance', async () => {
    const first = await place()
    const { project } = await editProject({
      project: first.project,
      ops: [
        {
          op: 'applyPose',
          idPrefix: prefixOf(first),
          poses: [{ id: 'point-forward' }],
          scale: 2,
        },
      ],
    })
    const arm = lane(project, '-arm-near', 'rotation')
    expect(arm?.keyframes[0]?.value).toBeCloseTo(0, 6)
    expect(arm?.keyframes.at(-1)?.value).toBeCloseTo(-78, 6)
  })

  it('sequences poses and spaces them evenly when untimed', async () => {
    const first = await place()
    const { project } = await editProject({
      project: first.project,
      ops: [
        {
          op: 'applyPose',
          idPrefix: prefixOf(first),
          poses: [{ id: 'stand' }, { id: 'crouch' }, { id: 'stand' }],
          durationInFrames: 60,
          scale: 2,
        },
      ],
    })
    const thigh = lane(project, '-thigh-near', 'rotation')
    expect(thigh?.keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 30, 60])
    // Down into the crouch and back to rest.
    expect(thigh?.keyframes[1]?.value).toBeCloseTo(52, 6)
    expect(thigh?.keyframes.at(-1)?.value).toBeCloseTo(0, 6)
  })

  it('refuses an unknown pose', async () => {
    const first = await place()
    await expect(
      editProject({
        project: first.project,
        ops: [{ op: 'applyPose', idPrefix: prefixOf(first), poses: [{ id: 'moonwalk' }] }],
      }),
    ).rejects.toThrow(/unknown pose/i)
  })

  it('attaches an item to a slot and parents it to the slot part', async () => {
    const withText = await place([
      { op: 'addText', text: 'flag', from: 0, durationInFrames: 60, trackId: 't_v' },
    ])
    const prefix = prefixOf(withText)
    const flagId = idOf(withText, 1)
    const { project } = await editProject({
      project: withText.project,
      ops: [{ op: 'attachToSlot', idPrefix: prefix, slotId: 'hand', itemId: flagId, scale: 2 }],
    })
    const flag = project.timeline?.items?.find((item) => item.id === flagId)
    expect(flag?.transformParent?.parentItemId).toBe(`${prefix}-glove-near`)
    // Slot 'hand' sits at [110, 282] in a 200x400 block, so at scale 2 the
    // canvas offset from block centre is (10*2, 82*2).
    expect({ x: flag?.transform?.x, y: flag?.transform?.y }).toEqual({ x: 20, y: 164 })
  })

  it('refuses a slot the block does not have', async () => {
    const withText = await place([
      { op: 'addText', text: 'x', from: 0, durationInFrames: 60, trackId: 't_v' },
    ])
    await expect(
      editProject({
        project: withText.project,
        ops: [
          {
            op: 'attachToSlot',
            idPrefix: prefixOf(withText),
            slotId: 'tail',
            itemId: idOf(withText, 1),
          },
        ],
      }),
    ).rejects.toThrow(/has no slot "tail"/)
  })
})

describe('a login-page explainer, composed end to end', () => {
  /**
   * The scene the kit exists for: a browser window opens, a form assembles, a
   * cursor clicks through the fields, the request reaches a server, the store is
   * read and a verdict comes back.
   *
   * Asserted as one scene rather than per block because the interesting failures
   * are compositional — a form that is not attached to the viewport it is
   * supposed to sit in, or a cursor that never reaches the field it clicks.
   */
  const build = async () =>
    editProject({
      project: baseProject(),
      ops: [
        // --- Front end ---
        {
          op: 'addBlock',
          blockId: 'ui-browser-window',
          from: 0,
          durationInFrames: 250,
          scale: 0.6,
          idPrefix: 'win',
          gestures: [{ id: 'window-appear' }],
        },
        {
          op: 'addBlock',
          blockId: 'ui-login-form',
          from: 20,
          durationInFrames: 230,
          // 0.45, not 0.62: the form is 900 units tall and the window viewport is
          // 892 units at the window's own 0.6, so anything above ~0.47 overflows
          // the container it was just attached to.
          scale: 0.45,
          idPrefix: 'form',
          gestures: [{ id: 'form-reveal' }],
        },
        // The form rides in the window's page area, so a window move carries it.
        {
          op: 'attachToSlot',
          idPrefix: 'win',
          slotId: 'viewport',
          itemId: 'form-card',
          scale: 0.6,
        },
        {
          op: 'applyPose',
          idPrefix: 'form',
          scale: 0.45,
          durationInFrames: 230,
          startFrame: 20,
          poses: [
            { id: 'form-empty', at: 0 },
            { id: 'email-focused', at: 0.2 },
            { id: 'email-entered', at: 0.35 },
            { id: 'password-focused', at: 0.5 },
            { id: 'credentials-entered', at: 0.62 },
            { id: 'form-submitting', at: 0.75 },
          ],
        },
        {
          op: 'addBlock',
          blockId: 'ui-cursor',
          from: 40,
          durationInFrames: 210,
          scale: 0.5,
          idPrefix: 'cur',
          gestures: [{ id: 'cursor-click', startFrame: 30 }],
        },

        // --- Back end ---
        {
          op: 'addBlock',
          blockId: 'infra-flow-arrow',
          from: 170,
          durationInFrames: 80,
          scale: 0.4,
          y: 420,
          idPrefix: 'req',
          gestures: [{ id: 'arrow-draw' }],
        },
        {
          op: 'addBlock',
          blockId: 'infra-server-rack',
          from: 180,
          durationInFrames: 70,
          scale: 0.35,
          x: 620,
          y: 300,
          idPrefix: 'srv',
          gestures: [{ id: 'rack-appear' }, { id: 'rack-work', cycles: 3 }],
        },
        {
          op: 'addBlock',
          blockId: 'infra-database',
          from: 195,
          durationInFrames: 55,
          scale: 0.3,
          x: 620,
          y: -300,
          idPrefix: 'db',
          gestures: [{ id: 'database-read' }],
        },
        {
          op: 'addBlock',
          blockId: 'infra-shield-badge',
          from: 215,
          durationInFrames: 35,
          scale: 0.4,
          x: -620,
          y: 300,
          idPrefix: 'verdict',
          gestures: [{ id: 'shield-seal' }],
        },
        {
          op: 'applyPose',
          idPrefix: 'verdict',
          scale: 0.4,
          durationInFrames: 35,
          startFrame: 215,
          poses: [{ id: 'verdict-granted' }],
        },
      ],
    })

  it('composes without a single failed operation', async () => {
    const { results } = await build()
    expect(results.filter((entry) => !(entry as { ok: boolean }).ok)).toEqual([])
  })

  it('places every block of the scene', async () => {
    const { project } = await build()
    const prefixes = ['win', 'form', 'cur', 'req', 'srv', 'db', 'verdict']
    for (const prefix of prefixes) {
      const owned = project.timeline?.items?.filter((item) => item.id.startsWith(`${prefix}-`))
      expect({ prefix, placed: (owned?.length ?? 0) > 0 }).toEqual({ prefix, placed: true })
    }
  })

  it('parents the form into the browser viewport', async () => {
    const { project } = await build()
    const card = project.timeline?.items?.find((item) => item.id === 'form-card')
    expect(card?.transformParent?.parentItemId).toBe('win-viewport')
  })

  it('animates the form state, the window and the back end', async () => {
    const { project } = await build()
    const keyed = new Set(project.timeline?.keyframes?.map((entry) => entry.itemId) ?? [])
    // The focus ring only moves because a pose named it.
    expect(keyed.has('form-email-focus')).toBe(true)
    expect(keyed.has('form-password-focus')).toBe(true)
    // The window fades and scales in.
    expect(keyed.has('win-frame')).toBe(true)
    // The verdict check is revealed by its pose.
    expect(keyed.has('verdict-check')).toBe(true)
  })

  it('keeps the whole cast inside one timeline span', async () => {
    const { project } = await build()
    const items = project.timeline?.items ?? []
    for (const item of items) {
      expect({
        id: item.id,
        withinSpan: item.from >= 0 && item.from + item.durationInFrames <= 250,
      }).toEqual({ id: item.id, withinSpan: true })
    }
  })
})

describe('directed actions and camera moves', () => {
  const place = async (extra: EditOp[] = []) =>
    editProject({
      project: baseProject(),
      ops: [
        {
          op: 'addBlock',
          blockId: 'infra-token-card',
          durationInFrames: 90,
          scale: 1,
          idPrefix: 'tok',
        },
        ...extra,
      ],
    })

  const lane = (project: Project, itemId: string, property: string) =>
    project.timeline?.keyframes
      ?.find((entry) => entry.itemId === itemId)
      ?.properties.find((entry) => entry.property === property)
      ?.keyframes.map((entry) => entry.value)

  it('moves a block instance as a whole from a single intent', async () => {
    const { project } = await editProject({
      project: (await place()).project,
      ops: [
        {
          op: 'directAction',
          idPrefix: 'tok',
          action: 'enter',
          direction: 'left',
          from: 0,
          durationInFrames: 30,
        },
      ],
    })
    // The root travels...
    const xs = lane(project, 'tok-card', 'x')
    expect(xs?.[0]).toBeLessThan(0)
    expect(xs?.at(-1)).toBe(0)
    // ...and every part fades, because opacity is not inherited.
    expect(lane(project, 'tok-stripe', 'opacity')?.[0]).toBe(0)
    // ...but only the root translates, or the rig would tear apart.
    expect(lane(project, 'tok-stripe', 'x')).toBeUndefined()
  })

  it('needs no numbers beyond the beat', async () => {
    // The whole point: distance, overshoot and easing are engine decisions.
    const { results } = await editProject({
      project: (await place()).project,
      ops: [{ op: 'directAction', idPrefix: 'tok', action: 'enter', durationInFrames: 30 }],
    })
    expect((results[0] as { detail: { keyframes: number } }).detail.keyframes).toBeGreaterThan(0)
  })

  it('arcs a move rather than sliding it in a straight line', async () => {
    const { project } = await editProject({
      project: (await place()).project,
      ops: [
        {
          op: 'directAction',
          idPrefix: 'tok',
          action: 'moveTo',
          to: { x: 600, y: 0 },
          arc: 200,
          from: 0,
          durationInFrames: 30,
        },
      ],
    })
    const ys = lane(project, 'tok-card', 'y') ?? []
    expect(Math.max(...ys.map(Math.abs))).toBeGreaterThan(50)
  })

  it('reveals a set of items as a cascade', async () => {
    // A block's parts, which is the realistic case: they already sit on their own
    // tracks, so nothing is displaced by track-overlap repair.
    const ids = ['tok-card', 'tok-stripe', 'tok-payload-1', 'tok-payload-2', 'tok-payload-3']
    const { project } = await editProject({
      project: (await place()).project,
      ops: [{ op: 'directAction', itemIds: ids, action: 'reveal', from: 0, durationInFrames: 40 }],
    })
    const starts = ids.map(
      (id) =>
        project.timeline?.keyframes
          ?.find((entry) => entry.itemId === id)
          ?.properties.find((entry) => entry.property === 'opacity')?.keyframes[0]?.frame ?? -1,
    )
    // Strictly increasing: each part waits for the one before it.
    for (let index = 1; index < starts.length; index++) {
      expect(starts[index]).toBeGreaterThan(starts[index - 1]!)
    }
    // And the whole cascade still finishes inside the beat.
    const last = project.timeline?.keyframes
      ?.flatMap((entry) => entry.properties.flatMap((p) => p.keyframes.map((k) => k.frame)))
      .reduce((a, b) => Math.max(a, b), 0)
    expect(last).toBeLessThanOrEqual(40)
  })

  it('scales a camera move by parallax plane', async () => {
    const two = await editProject({
      project: baseProject(),
      ops: [
        {
          op: 'addBlock',
          blockId: 'infra-token-card',
          durationInFrames: 90,
          idPrefix: 'near',
          x: -300,
        },
        {
          op: 'addBlock',
          blockId: 'infra-token-card',
          durationInFrames: 90,
          idPrefix: 'far',
          x: 300,
        },
      ],
    })
    const { project } = await editProject({
      project: two.project,
      ops: [
        {
          op: 'setCamera',
          itemIds: ['near-card', 'far-card'],
          intent: 'pan-left',
          from: 0,
          durationInFrames: 40,
          planes: [
            { idPrefix: 'near', plane: 0 },
            { idPrefix: 'far', plane: 5 },
          ],
        },
      ],
    })
    const nearShift = Math.abs((lane(project, 'near-card', 'x')?.at(-1) ?? 0) + 300)
    const farShift = Math.abs((lane(project, 'far-card', 'x')?.at(-1) ?? 0) - 300)
    // The whole point of a camera: the foreground travels further.
    expect(nearShift).toBeGreaterThan(farShift * 2)
  })

  it('converts a beat in composition time onto the item own timeline', async () => {
    // The bug this guards: keyframe frames are item-relative, so a beat authored
    // at composition frame 228 for an item starting at 214 must land at 14 — not
    // at 228, which is past the item's last frame and resolves to nothing.
    const scene = await editProject({
      project: baseProject(),
      ops: [
        {
          op: 'addBlock',
          blockId: 'infra-token-card',
          from: 200,
          durationInFrames: 60,
          scale: 0.5,
          x: 600,
          idPrefix: 'late',
        },
        {
          op: 'directAction',
          idPrefix: 'late',
          action: 'moveTo',
          to: { x: -600 },
          from: 210,
          durationInFrames: 30,
        },
      ],
    })
    const xs = lane(scene.project, 'late-card', 'x')
    const frames = scene.project.timeline?.keyframes
      ?.find((entry) => entry.itemId === 'late-card')
      ?.properties.find((entry) => entry.property === 'x')
      ?.keyframes.map((entry) => entry.frame)
    // 210..240 in composition time is 10..40 on an item that starts at 200.
    expect(frames).toEqual([10, 40])
    expect(xs?.[0]).toBe(600)
    expect(xs?.at(-1)).toBe(-600)
  })

  it('refuses a beat that misses its target entirely', async () => {
    // Silently dropping these is what made the bug above invisible.
    await expect(
      editProject({
        project: (await place()).project,
        ops: [
          {
            op: 'directAction',
            idPrefix: 'tok',
            action: 'enter',
            from: 5000,
            durationInFrames: 30,
          },
        ],
      }),
    ).rejects.toThrow(/does not overlap any target/)
  })

  it('refuses a target that matches nothing', async () => {
    await expect(
      editProject({
        project: (await place()).project,
        ops: [{ op: 'directAction', idPrefix: 'nobody', action: 'enter' }],
      }),
    ).rejects.toThrow(/no items matched/)
  })

  it('contain-fits an attached item inside its slot', async () => {
    const scene = await editProject({
      project: baseProject(),
      ops: [
        {
          op: 'addBlock',
          blockId: 'ui-browser-window',
          durationInFrames: 90,
          scale: 0.6,
          idPrefix: 'win',
        },
        {
          op: 'addBlock',
          blockId: 'ui-login-form',
          durationInFrames: 90,
          // Deliberately too large for the viewport it is about to be put in.
          scale: 1.2,
          idPrefix: 'form',
        },
      ],
    })
    const before = scene.project.timeline?.items?.find((item) => item.id === 'form-card')
    const { project } = await editProject({
      project: scene.project,
      ops: [
        {
          op: 'attachToSlot',
          idPrefix: 'win',
          slotId: 'viewport',
          itemId: 'form-card',
          scale: 0.6,
          fit: 'contain',
        },
      ],
    })
    const after = project.timeline?.items?.find((item) => item.id === 'form-card')
    const viewport = project.timeline?.items?.find((item) => item.id === 'win-viewport')

    expect(after?.transform?.height).toBeLessThan(before?.transform?.height ?? 0)
    // It now fits, with the default 10% margin to spare.
    expect(after?.transform?.height).toBeLessThanOrEqual(
      (viewport?.transform?.height ?? 0) * 0.9 + 0.5,
    )
    // The aspect ratio survives the fit.
    const beforeRatio = (before?.transform?.width ?? 1) / (before?.transform?.height ?? 1)
    const afterRatio = (after?.transform?.width ?? 1) / (after?.transform?.height ?? 1)
    expect(afterRatio).toBeCloseTo(beforeRatio, 4)
  })

  it('never grows an item to fill its container', async () => {
    // Scaling committed artwork past its authored size softens it.
    const scene = await editProject({
      project: baseProject(),
      ops: [
        {
          op: 'addBlock',
          blockId: 'ui-browser-window',
          durationInFrames: 90,
          scale: 0.6,
          idPrefix: 'win',
        },
        {
          op: 'addBlock',
          blockId: 'infra-token-card',
          durationInFrames: 90,
          scale: 0.2,
          idPrefix: 'tok',
        },
      ],
    })
    const before = scene.project.timeline?.items?.find((item) => item.id === 'tok-card')
    const { project } = await editProject({
      project: scene.project,
      ops: [
        {
          op: 'attachToSlot',
          idPrefix: 'win',
          slotId: 'viewport',
          itemId: 'tok-card',
          scale: 0.6,
          fit: 'contain',
        },
      ],
    })
    const after = project.timeline?.items?.find((item) => item.id === 'tok-card')
    expect(after?.transform?.width).toBe(before?.transform?.width)
  })
})

describe('rigging art the caller just drew', () => {
  const FIGURE = [
    '<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">',
    '  <rect id="torso" x="70" y="100" width="60" height="140" fill="#4477ff"/>',
    '  <rect id="arm" x="120" y="110" width="24" height="90" fill="#223355"/>',
    '  <circle id="head" cx="100" cy="70" r="34" fill="#4477ff"/>',
    '</svg>',
  ].join('\n')

  const define = (overrides: Record<string, unknown> = {}): EditOp => ({
    op: 'defineBlock',
    blockId: 'local-figure',
    name: 'Figure',
    category: 'character',
    source: FIGURE,
    parts: [
      { id: 'torso', fill: 'primary' },
      { id: 'arm', parent: 'torso', pivot: [130, 115], fill: 'ink' },
      { id: 'head', parent: 'torso', fill: 'highlight' },
    ],
    ...overrides,
  })

  it('defines and places a rig in one call', async () => {
    const { project, results } = await editProject({
      project: baseProject(),
      ops: [
        define(),
        {
          op: 'addBlock',
          blockId: 'local-figure',
          from: 0,
          durationInFrames: 60,
          scale: 1,
          idPrefix: 'fig',
        },
      ],
    })
    expect((results[0] as { detail: { parts: number } }).detail.parts).toBe(3)
    const items = project.timeline?.items?.filter((item) => item.id.startsWith('fig-'))
    expect(items?.length).toBe(3)
    // Rigged, not a pile of paths: the arm hangs off the torso.
    const arm = items?.find((item) => item.id === 'fig-arm')
    expect(arm?.transformParent?.parentItemId).toBe('fig-torso')
  })

  it('animates generated art with the same intent vocabulary', async () => {
    const { project } = await editProject({
      project: baseProject(),
      ops: [
        define(),
        {
          op: 'addBlock',
          blockId: 'local-figure',
          from: 0,
          durationInFrames: 60,
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
    })
    const xs = project.timeline?.keyframes
      ?.find((entry) => entry.itemId === 'fig-torso')
      ?.properties.find((entry) => entry.property === 'x')
      ?.keyframes.map((entry) => entry.value)
    expect(xs?.[0]).toBeLessThan(0)
    expect(xs?.at(-1)).toBe(0)
    // Only the root travels; the rig holds together.
    expect(
      project.timeline?.keyframes
        ?.find((entry) => entry.itemId === 'fig-arm')
        ?.properties.some((entry) => entry.property === 'x'),
    ).toBeFalsy()
  })

  it('attaches to a slot on a generated block', async () => {
    const scene = await editProject({
      project: baseProject(),
      ops: [
        define({ slots: [{ id: 'hand', label: 'Hand', at: [132, 195], partId: 'arm' }] }),
        {
          op: 'addBlock',
          blockId: 'local-figure',
          from: 0,
          durationInFrames: 60,
          scale: 1,
          idPrefix: 'fig',
        },
        { op: 'addText', text: 'prop', from: 0, durationInFrames: 60, trackId: 't_v' },
      ],
    })
    const propId = (scene.results[2] as { detail: { id: string } }).detail.id
    const { project } = await editProject({
      project: scene.project,
      ops: [
        // The definition is re-sent because it lives for one call; this is the
        // cost of not persisting it, stated plainly.
        define({ slots: [{ id: 'hand', label: 'Hand', at: [132, 195], partId: 'arm' }] }),
        { op: 'attachToSlot', idPrefix: 'fig', slotId: 'hand', itemId: propId, scale: 1 },
      ],
    })
    const prop = project.timeline?.items?.find((item) => item.id === propId)
    expect(prop?.transformParent?.parentItemId).toBe('fig-arm')
    // Slot [132, 195] in a 200x400 viewport is (32, -5) from the block centre.
    expect({ x: prop?.transform?.x, y: prop?.transform?.y }).toEqual({ x: 32, y: -5 })
  })

  it('picks the right block when part ids collide with committed artwork', async () => {
    // `character-astronaut` also has a part called `torso`. Matching on "any part
    // id in common" resolved a three-part generated figure to the seventeen-part
    // astronaut and then silently parented nothing.
    const scene = await editProject({
      project: baseProject(),
      ops: [
        define({ slots: [{ id: 'hand', label: 'Hand', at: [132, 195], partId: 'arm' }] }),
        { op: 'addBlock', blockId: 'local-figure', durationInFrames: 60, idPrefix: 'fig' },
        { op: 'addText', text: 'prop', from: 0, durationInFrames: 60, trackId: 't_v' },
        {
          op: 'attachToSlot',
          idPrefix: 'fig',
          slotId: 'hand',
          itemId: { $ref: 'prop#/detail/id' } as unknown as string,
        },
      ].map((op, index) => (index === 2 ? { ...op, callerId: 'prop' } : op)) as EditOp[],
    })
    const propId = (scene.results[2] as { detail: { id: string } }).detail.id
    const prop = scene.project.timeline?.items?.find((item) => item.id === propId)
    expect(prop?.transformParent?.parentItemId).toBe('fig-arm')
  })

  it('lets the caller name the block when inference would be ambiguous', async () => {
    const scene = await editProject({
      project: baseProject(),
      ops: [
        define({ slots: [{ id: 'hand', label: 'Hand', at: [132, 195], partId: 'arm' }] }),
        { op: 'addBlock', blockId: 'local-figure', durationInFrames: 60, idPrefix: 'fig' },
        {
          op: 'addText',
          text: 'prop',
          from: 0,
          durationInFrames: 60,
          trackId: 't_v',
          callerId: 'p',
        },
        {
          op: 'attachToSlot',
          idPrefix: 'fig',
          blockId: 'local-figure',
          slotId: 'hand',
          itemId: { $ref: 'p#/detail/id' } as unknown as string,
        },
      ] as EditOp[],
    })
    const propId = (scene.results[2] as { detail: { id: string } }).detail.id
    expect(
      scene.project.timeline?.items?.find((item) => item.id === propId)?.transformParent
        ?.parentItemId,
    ).toBe('fig-arm')
  })

  it('refuses a rig whose part names an element the drawing does not have', async () => {
    await expect(
      editProject({
        project: baseProject(),
        ops: [define({ parts: [{ id: 'torso' }, { id: 'tail' }] })],
      }),
    ).rejects.toThrow(/no element with id "tail"/)
  })

  it('refuses a rig that would not hold together', async () => {
    await expect(
      editProject({
        project: baseProject(),
        ops: [define({ parts: [{ id: 'torso', parent: 'ghost' }] })],
      }),
    ).rejects.toThrow(/not sound/)
  })

  it('refuses to shadow committed artwork', async () => {
    await expect(
      editProject({
        project: baseProject(),
        ops: [define({ blockId: 'character-astronaut' })],
      }),
    ).rejects.toThrow(/committed block/)
  })

  it('does not leak a definition into a later call', async () => {
    // Generated rigs are scoped to the call that authored them; the alternative
    // is a schema change for something the caller can simply re-send.
    const first = await editProject({ project: baseProject(), ops: [define()] })
    await expect(
      editProject({
        project: first.project,
        ops: [{ op: 'addBlock', blockId: 'local-figure', durationInFrames: 60 }],
      }),
    ).rejects.toThrow(/defineBlock it in this same call/)
  })

  it('places one definition more than once', async () => {
    const { project } = await editProject({
      project: baseProject(),
      ops: [
        define(),
        { op: 'addBlock', blockId: 'local-figure', durationInFrames: 60, x: -300, idPrefix: 'a' },
        { op: 'addBlock', blockId: 'local-figure', durationInFrames: 60, x: 300, idPrefix: 'b' },
      ],
    })
    expect(project.timeline?.items?.filter((item) => item.id.startsWith('a-')).length).toBe(3)
    expect(project.timeline?.items?.filter((item) => item.id.startsWith('b-')).length).toBe(3)
  })
})

describe('timing a cut to the recorded read', () => {
  /** "You type an email and a password to log in." at 25fps. */
  const WORDS = [
    { text: 'You', start: 0.0, end: 0.2 },
    { text: 'type', start: 0.2, end: 0.5 },
    { text: 'an', start: 0.5, end: 0.6 },
    { text: 'Email,', start: 0.6, end: 1.0 },
    { text: 'and', start: 1.0, end: 1.2 },
    { text: 'a', start: 1.2, end: 1.3 },
    { text: 'password', start: 1.3, end: 2.0 },
    { text: 'to', start: 2.0, end: 2.1 },
    { text: 'log', start: 2.1, end: 2.4 },
    { text: 'in.', start: 2.4, end: 2.8 },
  ]

  const narrate = (): EditOp => ({ op: 'setNarration', words: WORDS })

  const lane = (project: Project, itemId: string, property: string) =>
    project.timeline?.keyframes
      ?.find((entry) => entry.itemId === itemId)
      ?.properties.find((entry) => entry.property === property)?.keyframes

  it('places a beat where the word is actually spoken', async () => {
    const { project } = await editProject({
      project: baseProject(),
      ops: [
        narrate(),
        {
          op: 'addBlock',
          blockId: 'infra-token-card',
          from: 0,
          durationInFrames: 100,
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
    })
    // The project runs at 25fps, so 1.3s..2.0s is frames 33..50.
    const frames = lane(project, 'tok-card', 'x')?.map((entry) => entry.frame)
    expect(frames?.[0]).toBe(33)
    expect(frames?.at(-1)).toBe(50)
  })

  it('anticipates a word so the move lands on it rather than after it', async () => {
    const { project } = await editProject({
      project: baseProject(),
      ops: [
        narrate(),
        { op: 'addBlock', blockId: 'infra-token-card', durationInFrames: 100, idPrefix: 'tok' },
        {
          op: 'directAction',
          idPrefix: 'tok',
          action: 'emphasize',
          fromCue: { word: 'password', offsetSeconds: -0.4 },
          forSeconds: 0.4,
        },
      ],
    })
    // 1.3 - 0.4 = 0.9s, which is frame 23 at 25fps.
    expect(lane(project, 'tok-card', 'width')?.[0]?.frame).toBe(23)
  })

  it('lands each pose on the word it illustrates', async () => {
    const { project } = await editProject({
      project: baseProject(),
      ops: [
        narrate(),
        {
          op: 'addBlock',
          blockId: 'ui-login-form',
          from: 0,
          durationInFrames: 100,
          scale: 1,
          idPrefix: 'form',
        },
        {
          op: 'applyPose',
          idPrefix: 'form',
          scale: 1,
          fromCue: { word: 'You' },
          untilCue: { word: 'in', edge: 'end' },
          poses: [
            { id: 'form-empty', atCue: { word: 'You' } },
            { id: 'email-focused', atCue: { word: 'Email' } },
            { id: 'credentials-entered', atCue: { word: 'password' } },
            { id: 'form-submitting', atCue: { word: 'log' } },
          ],
        },
      ],
    })
    // The email focus ring reaches full opacity on the word "email" (0.6s ->
    // frame 15), not at some fraction of an evenly divided span.
    const ring = lane(project, 'form-email-focus', 'opacity') ?? []
    const lit = ring.find((entry) => entry.value === 1)
    expect(lit?.frame).toBe(15)
    // And the submit spinner appears on "log" (2.1s -> frame 53).
    const spinner = lane(project, 'form-submit-spinner', 'opacity') ?? []
    expect(spinner.find((entry) => entry.value === 1)?.frame).toBe(53)
  })

  it('converts a cued span onto the instance own timeline', async () => {
    // The same item-relative trap directAction had: a block starting at frame 40
    // must receive a beat cued at 1.3s as frame 33 - 40, not as 33.
    const { project } = await editProject({
      project: baseProject(),
      ops: [
        narrate(),
        {
          op: 'addBlock',
          blockId: 'ui-login-form',
          from: 20,
          durationInFrames: 80,
          scale: 1,
          idPrefix: 'form',
        },
        {
          op: 'applyPose',
          idPrefix: 'form',
          scale: 1,
          fromCue: { word: 'password' },
          untilCue: { word: 'in', edge: 'end' },
          poses: [{ id: 'form-empty' }, { id: 'credentials-entered' }],
        },
      ],
    })
    const dots = lane(project, 'form-password-dots', 'opacity') ?? []
    // 1.3s is composition frame 33; the item starts at 20, so 13 relative.
    expect(dots[0]?.frame).toBe(13)
  })

  it('refuses a cue the read does not contain, and suggests what it does', async () => {
    await expect(
      editProject({
        project: baseProject(),
        ops: [
          narrate(),
          { op: 'addBlock', blockId: 'infra-token-card', durationInFrames: 100, idPrefix: 'tok' },
          { op: 'directAction', idPrefix: 'tok', action: 'enter', fromCue: { word: 'passwrd' } },
        ],
      }),
    ).rejects.toThrow(/never says the word "passwrd".*password/s)
  })

  it('refuses a cue before any narration is attached', async () => {
    await expect(
      editProject({
        project: baseProject(),
        ops: [
          { op: 'addBlock', blockId: 'infra-token-card', durationInFrames: 100, idPrefix: 'tok' },
          { op: 'directAction', idPrefix: 'tok', action: 'enter', fromCue: { word: 'password' } },
        ],
      }),
    ).rejects.toThrow(/no narration is attached/)
  })

  it('refuses a step cue when the sequence itself is not cued', async () => {
    await expect(
      editProject({
        project: baseProject(),
        ops: [
          narrate(),
          { op: 'addBlock', blockId: 'ui-login-form', durationInFrames: 100, idPrefix: 'form' },
          {
            op: 'applyPose',
            idPrefix: 'form',
            poses: [{ id: 'email-focused', atCue: { word: 'Email' } }],
          },
        ],
      }),
    ).rejects.toThrow(/needs the sequence itself to be cued/)
  })

  it('refuses a cued beat that misses the instance entirely', async () => {
    await expect(
      editProject({
        project: baseProject(),
        ops: [
          narrate(),
          {
            op: 'addBlock',
            blockId: 'ui-login-form',
            from: 0,
            durationInFrames: 10,
            idPrefix: 'form',
          },
          {
            op: 'applyPose',
            idPrefix: 'form',
            fromCue: { word: 'log' },
            forSeconds: 0.5,
            poses: [{ id: 'email-focused' }],
          },
        ],
      }),
    ).rejects.toThrow(/does not overlap "form"/)
  })

  it('does not leak narration into a later call', async () => {
    const first = await editProject({ project: baseProject(), ops: [narrate()] })
    await expect(
      editProject({
        project: first.project,
        ops: [
          { op: 'addBlock', blockId: 'infra-token-card', durationInFrames: 100, idPrefix: 'tok' },
          { op: 'directAction', idPrefix: 'tok', action: 'enter', fromCue: { word: 'password' } },
        ],
      }),
    ).rejects.toThrow(/no narration is attached/)
  })

  it('accepts a transcript in segment shape', async () => {
    const { results } = await editProject({
      project: baseProject(),
      ops: [
        {
          op: 'setNarration',
          segments: [{ text: 'You type', words: WORDS.slice(0, 2) }, { words: WORDS.slice(2) }],
        },
      ],
    })
    expect((results[0] as { detail: { words: number } }).detail.words).toBe(WORDS.length)
  })
})

describe('a project that owns its own blocks', () => {
  const FIGURE = [
    '<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">',
    '  <rect id="torso" x="70" y="100" width="60" height="140" fill="#4477ff"/>',
    '  <rect id="arm" x="120" y="110" width="24" height="90" fill="#223355"/>',
    '</svg>',
  ].join('\n')

  const define = (overrides: Record<string, unknown> = {}): EditOp => ({
    op: 'defineBlock',
    blockId: 'local-figure',
    name: 'Figure',
    category: 'character',
    source: FIGURE,
    persist: true,
    parts: [
      { id: 'torso', fill: 'primary' },
      { id: 'arm', parent: 'torso', pivot: [130, 115], fill: 'ink' },
    ],
    ...overrides,
  })

  it('saves a definition onto the project', async () => {
    const { project, results } = await editProject({ project: baseProject(), ops: [define()] })
    expect((results[0] as { detail: { persisted: boolean } }).detail.persisted).toBe(true)
    expect(project.blocks?.map((entry) => entry.definition.id)).toEqual(['local-figure'])
    expect(project.blocks?.[0]?.definition.parts).toHaveLength(2)
  })

  it('survives into a later call, which call-scoped definitions do not', async () => {
    const first = await editProject({ project: baseProject(), ops: [define()] })
    const { project } = await editProject({
      project: first.project,
      ops: [{ op: 'addBlock', blockId: 'local-figure', durationInFrames: 60, idPrefix: 'fig' }],
    })
    expect(project.timeline?.items?.filter((item) => item.id.startsWith('fig-'))).toHaveLength(2)
  })

  it('still scopes an unpersisted definition to its call', async () => {
    const first = await editProject({
      project: baseProject(),
      ops: [define({ persist: false })],
    })
    expect(first.project.blocks).toBeUndefined()
    await expect(
      editProject({
        project: first.project,
        ops: [{ op: 'addBlock', blockId: 'local-figure', durationInFrames: 60 }],
      }),
    ).rejects.toThrow(/defineBlock it in this same call/)
  })

  it('does not grow a blocks key on a project that owns none', async () => {
    // An empty array would churn every project file on every edit.
    const { project } = await editProject({
      project: baseProject(),
      ops: [{ op: 'addText', text: 'hi', from: 0, durationInFrames: 30, trackId: 't_v' }],
    })
    expect('blocks' in project).toBe(false)
  })

  it('lists committed and project blocks separately', async () => {
    const first = await editProject({ project: baseProject(), ops: [define()] })
    const { results } = await editProject({
      project: first.project,
      ops: [{ op: 'listBlocks' }],
    })
    const detail = (results[0] as { detail: { committed: unknown[]; project: unknown[] } }).detail
    expect(detail.committed.length).toBeGreaterThan(5)
    expect(detail.project).toHaveLength(1)
  })

  it('edits a saved rig and re-validates it', async () => {
    const first = await editProject({ project: baseProject(), ops: [define()] })
    const { project } = await editProject({
      project: first.project,
      ops: [{ op: 'updateBlock', blockId: 'local-figure', definition: { name: 'Figure mk2' } }],
    })
    expect(project.blocks?.[0]?.definition.name).toBe('Figure mk2')
    expect(project.blocks?.[0]?.updatedAt).toBeGreaterThanOrEqual(
      project.blocks?.[0]?.createdAt ?? 0,
    )
  })

  it('refuses an edit that would break the rig', async () => {
    // An edit can orphan a child exactly as easily as a bad definition can.
    const first = await editProject({ project: baseProject(), ops: [define()] })
    await expect(
      editProject({
        project: first.project,
        ops: [
          {
            op: 'updateBlock',
            blockId: 'local-figure',
            definition: {
              parts: [
                {
                  id: 'arm',
                  label: 'Arm',
                  d: 'M 0 0 L 4 0 L 4 4 Z',
                  parent: 'ghost',
                  fill: 'ink',
                  z: 0,
                },
              ],
            },
          },
        ],
      }),
    ).rejects.toThrow(/not sound/)
  })

  it('removes a saved rig without disturbing what it already drew', async () => {
    const placed = await editProject({
      project: baseProject(),
      ops: [
        define(),
        { op: 'addBlock', blockId: 'local-figure', durationInFrames: 60, idPrefix: 'fig' },
      ],
    })
    const { project } = await editProject({
      project: placed.project,
      ops: [{ op: 'removeBlock', blockId: 'local-figure' }],
    })
    expect(project.blocks).toBeUndefined()
    // The items are ordinary shapes once lowered, so the scene is untouched.
    expect(project.timeline?.items?.filter((item) => item.id.startsWith('fig-'))).toHaveLength(2)
  })

  it('refuses to remove or edit committed artwork', async () => {
    for (const op of [
      { op: 'removeBlock', blockId: 'character-astronaut' },
      { op: 'updateBlock', blockId: 'character-astronaut', definition: { name: 'x' } },
    ] as EditOp[]) {
      await expect(editProject({ project: baseProject(), ops: [op] })).rejects.toThrow()
    }
  })

  it('never lets a project block shadow committed artwork', async () => {
    // The registry is consulted first, whatever a project calls its own blocks.
    const first = await editProject({ project: baseProject(), ops: [define()] })
    const forged = {
      ...first.project,
      blocks: [
        {
          ...first.project.blocks![0]!,
          definition: { ...first.project.blocks![0]!.definition, id: 'character-astronaut' },
        },
      ],
    }
    const { project } = await editProject({
      project: forged as Project,
      ops: [
        {
          op: 'addBlock',
          blockId: 'character-astronaut',
          durationInFrames: 60,
          idPrefix: 'real',
        },
      ],
    })
    // 17 parts means the committed astronaut won, not the two-part forgery.
    expect(project.timeline?.items?.filter((item) => item.id.startsWith('real-'))).toHaveLength(17)
  })
})

describe('moving a rig between projects', () => {
  const RIG = {
    id: 'local-badge',
    name: 'Badge',
    category: 'prop' as const,
    width: 100,
    height: 100,
    parts: [
      { id: 'body', label: 'Body', d: 'M 10 10 L 90 10 L 90 90 L 10 90 Z', fill: 'accent', z: 0 },
    ],
  }

  it('imports a rig and records where it came from', async () => {
    const { project } = await editProject({
      project: baseProject(),
      ops: [{ op: 'importBlock', definition: RIG, fromProjectId: 'other-project' }],
    })
    expect(project.blocks?.[0]?.definition.id).toBe('local-badge')
    expect(project.blocks?.[0]?.origin).toEqual({
      kind: 'copied',
      fromProjectId: 'other-project',
    })
  })

  it('places an imported rig immediately', async () => {
    const { project } = await editProject({
      project: baseProject(),
      ops: [
        { op: 'importBlock', definition: RIG },
        { op: 'addBlock', blockId: 'local-badge', durationInFrames: 60, idPrefix: 'b' },
      ],
    })
    expect(project.timeline?.items?.filter((item) => item.id.startsWith('b-'))).toHaveLength(1)
  })

  it('re-validates on the way in, because a travelled rig had no reviewer', async () => {
    await expect(
      editProject({
        project: baseProject(),
        ops: [
          {
            op: 'importBlock',
            definition: { ...RIG, parts: [{ ...RIG.parts[0]!, parent: 'ghost' }] },
          },
        ],
      }),
    ).rejects.toThrow(/not sound/)
  })

  it('imports under a new id so a copy need not collide', async () => {
    const { project } = await editProject({
      project: baseProject(),
      ops: [
        { op: 'importBlock', definition: RIG },
        { op: 'importBlock', definition: RIG, blockId: 'local-badge-2' },
      ],
    })
    expect(project.blocks?.map((entry) => entry.definition.id)).toEqual([
      'local-badge',
      'local-badge-2',
    ])
  })

  it('round-trips a whole exported record', async () => {
    const source = await editProject({
      project: baseProject(),
      ops: [{ op: 'importBlock', definition: RIG }],
    })
    const exported = source.project.blocks![0]!
    const { project, results } = await editProject({
      project: baseProject(),
      ops: [{ op: 'importBlock', block: exported, fromProjectId: 'source' }],
    })
    expect((results[0] as { detail: { replaced: boolean } }).detail.replaced).toBe(false)
    expect(project.blocks?.[0]?.definition).toEqual(exported.definition)
  })
})
