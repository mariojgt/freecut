// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { instantiateBlock } from './instantiate'
import { poseToGesture } from './poses'
import { BLOCKS, GESTURES, POSES, getBlock, getPose } from './registry'
import { DEFAULT_SCENE_PALETTE } from './scene-palette'

/**
 * The explainer kit has to survive being lowered onto a timeline, because a
 * block that validates structurally can still produce nothing drawable — a
 * mistyped path, a zero-area shape, a contour the parser drops.
 */

const base = { palette: DEFAULT_SCENE_PALETTE, from: 0, durationInFrames: 90, fps: 30 }

const KIT_IDS = [
  'ui-browser-window',
  'ui-login-form',
  'ui-cursor',
  'infra-server-rack',
  'infra-database',
  'infra-token-card',
  'infra-flow-arrow',
  'infra-shield-badge',
] as const

describe('explainer kit geometry', () => {
  it('draws every part of every kit block', () => {
    for (const id of KIT_IDS) {
      const block = getBlock(id)!
      const result = instantiateBlock({ ...base, block })
      expect({ id, skipped: result.skipped, items: result.items.length }).toEqual({
        id,
        skipped: [],
        items: block.parts.length,
      })
    }
  })

  it('gives every part real area on canvas', () => {
    for (const id of KIT_IDS) {
      const result = instantiateBlock({ ...base, block: getBlock(id)! })
      for (const item of result.items) {
        expect({
          item: item.id,
          sized: (item.transform?.width ?? 0) > 0 && (item.transform?.height ?? 0) > 0,
        }).toEqual({ item: item.id, sized: true })
      }
    }
  })

  it('keeps every part inside its own block viewport', () => {
    // A part drawn outside the authoring viewport would be clipped or would
    // silently offset the block's centre from what the slots describe.
    for (const id of KIT_IDS) {
      const block = getBlock(id)!
      const result = instantiateBlock({ ...base, block, placement: { scale: 1 } })
      for (const item of result.items) {
        const t = item.transform ?? {}
        const halfWidth = block.width / 2
        const halfHeight = block.height / 2
        expect({
          item: item.id,
          inside:
            Math.abs(t.x ?? 0) - (t.width ?? 0) / 2 <= halfWidth + 0.5 &&
            Math.abs(t.y ?? 0) - (t.height ?? 0) / 2 <= halfHeight + 0.5,
        }).toEqual({ item: item.id, inside: true })
      }
    }
  })

  it('parents every non-root part into its rig', () => {
    for (const id of KIT_IDS) {
      const block = getBlock(id)!
      const result = instantiateBlock({ ...base, block })
      for (const part of block.parts) {
        if (!part.parent) continue
        const item = result.items.find((candidate) => candidate.id.endsWith(`-${part.id}`))
        expect({
          part: `${id}/${part.id}`,
          parent: item?.transformParent?.parentItemId?.split('-').slice(-1)[0],
        }).toEqual({
          part: `${id}/${part.id}`,
          parent: part.parent.split('-').slice(-1)[0],
        })
      }
    }
  })
})

describe('authored hidden states', () => {
  it('starts state-only parts fully transparent', () => {
    const form = getBlock('ui-login-form')!
    const result = instantiateBlock({ ...base, block: form })
    const hidden = ['email-focus', 'email-text', 'password-dots', 'error-banner', 'submit-spinner']
    for (const partId of hidden) {
      const item = result.items.find((candidate) => candidate.id.endsWith(`-${partId}`))
      expect({ partId, opacity: item?.transform?.opacity }).toEqual({ partId, opacity: 0 })
    }
  })

  it('leaves default-state parts fully opaque', () => {
    const result = instantiateBlock({ ...base, block: getBlock('ui-login-form')! })
    for (const partId of ['card', 'heading', 'email-well', 'submit-button']) {
      const item = result.items.find((candidate) => candidate.id.endsWith(`-${partId}`))
      expect({ partId, opacity: item?.transform?.opacity }).toEqual({ partId, opacity: 1 })
    }
  })

  it('cannot reveal a hidden state with a whole-block fade', () => {
    // The fade contributes -1 from each part's own rest opacity, and the
    // resolver clamps, so a focus ring stays hidden through a form-appear.
    const form = getBlock('ui-login-form')!
    const result = instantiateBlock({
      ...base,
      block: form,
      gestures: [{ gesture: GESTURES.get('form-appear')! }],
    })
    const ring = result.keyframes.find((entry) => entry.itemId.endsWith('-email-focus'))
    const values = ring?.properties
      .find((entry) => entry.property === 'opacity')
      ?.keyframes.map((entry) => entry.value)
    expect(values).toEqual([0, 0])
  })

  it('reveals a hidden state when a pose names it', () => {
    const pose = getPose('email-focused')!
    const result = instantiateBlock({
      ...base,
      block: getBlock('ui-login-form')!,
      gestures: [{ gesture: poseToGesture(pose) }],
    })
    const ring = result.keyframes.find((entry) => entry.itemId.endsWith('-email-focus'))
    const values = ring?.properties
      .find((entry) => entry.property === 'opacity')
      ?.keyframes.map((entry) => entry.value)
    expect(values?.[0]).toBe(0)
    expect(values?.at(-1)).toBe(1)
  })

  it('returns a revealed state to hidden when a later pose omits it', () => {
    const result = instantiateBlock({
      ...base,
      block: getBlock('ui-login-form')!,
      gestures: [
        {
          gesture: {
            id: 'seq',
            name: 'seq',
            loop: false,
            tracks: [
              {
                partId: 'error-banner',
                channel: 'opacity',
                keyframes: [
                  { at: 0, value: 1, easing: 'linear' },
                  { at: 1, value: 0, easing: 'linear' },
                ],
              },
            ],
          },
        },
      ],
    })
    const banner = result.keyframes.find((entry) => entry.itemId.endsWith('-error-banner'))
    const values = banner?.properties
      .find((entry) => entry.property === 'opacity')
      ?.keyframes.map((entry) => entry.value)
    expect(values).toEqual([1, 0])
  })
})

describe('kit gestures', () => {
  it('drives only parts the target block owns', () => {
    for (const block of BLOCKS.values()) {
      const partIds = new Set(block.parts.map((part) => part.id))
      for (const gestureId of block.gestures ?? []) {
        const gesture = GESTURES.get(gestureId)!
        for (const track of gesture.tracks) {
          expect({ gestureId, partId: track.partId, owned: partIds.has(track.partId) }).toEqual({
            gestureId,
            partId: track.partId,
            owned: true,
          })
        }
      }
    }
  })

  it('staggers a reveal so parts start at different times', () => {
    const reveal = GESTURES.get('form-reveal')!
    const starts = reveal.tracks
      .filter((track) => track.channel === 'opacity')
      .map((track) => track.keyframes[0]!.at)
    expect(new Set(starts).size).toBeGreaterThan(4)
    // The cascade still finishes within the span.
    expect(
      Math.max(...reveal.tracks.flatMap((t) => t.keyframes.map((k) => k.at))),
    ).toBeLessThanOrEqual(1)
  })

  it('ends every appear gesture at the block rest pose', () => {
    for (const id of ['window-appear', 'form-appear', 'rack-appear', 'token-appear']) {
      for (const track of GESTURES.get(id)!.tracks) {
        expect({ id, partId: track.partId, last: track.keyframes.at(-1)?.value }).toEqual({
          id,
          partId: track.partId,
          last: 0,
        })
      }
    }
  })

  it('marks looping ambient gestures as loops and one-shots as not', () => {
    const loops = ['window-nudge', 'rack-work', 'rack-hum', 'token-travel', 'arrow-pulse']
    for (const id of loops) expect({ id, loop: GESTURES.get(id)!.loop }).toEqual({ id, loop: true })
    const shots = ['window-appear', 'submit-press', 'cursor-click', 'shield-seal', 'arrow-draw']
    for (const id of shots)
      expect({ id, loop: GESTURES.get(id)!.loop }).toEqual({ id, loop: false })
  })

  it('returns every looping gesture to its opening pose', () => {
    for (const gesture of GESTURES.values()) {
      if (!gesture.loop) continue
      for (const track of gesture.tracks) {
        const first = track.keyframes[0]!
        const last = track.keyframes.at(-1)!
        expect({
          gesture: gesture.id,
          partId: track.partId,
          seam: Math.abs(last.value - first.value) < 1e-6,
        }).toEqual({ gesture: gesture.id, partId: track.partId, seam: true })
      }
    }
  })
})

describe('kit poses', () => {
  it('targets only parts of the block each pose was authored for', () => {
    for (const pose of POSES.values()) {
      const block = getBlock(pose.blockId)!
      const partIds = new Set(block.parts.map((part) => part.id))
      for (const channel of pose.channels) {
        expect({
          pose: pose.id,
          partId: channel.partId,
          owned: partIds.has(channel.partId),
        }).toEqual({ pose: pose.id, partId: channel.partId, owned: true })
      }
    }
  })

  it('keeps every opacity contribution reachable from the part rest value', () => {
    // A +1 on a part already at rest opacity 1 would clamp and do nothing, which
    // reads as a pose that silently fails.
    for (const pose of POSES.values()) {
      const block = getBlock(pose.blockId)!
      for (const channel of pose.channels) {
        if (channel.channel !== 'opacity') continue
        const part = block.parts.find((candidate) => candidate.id === channel.partId)!
        const rest = part.opacity ?? 1
        expect({
          pose: pose.id,
          partId: channel.partId,
          reachable: rest + channel.value >= 0 && rest + channel.value <= 1,
        }).toEqual({ pose: pose.id, partId: channel.partId, reachable: true })
      }
    }
  })
})
