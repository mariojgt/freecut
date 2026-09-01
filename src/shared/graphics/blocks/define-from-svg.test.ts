// @vitest-environment jsdom

import { describe, expect, it } from 'vite-plus/test'
import { importSvgSource } from '../shapes/svg-document-import'
import { assertDefinedBlockIsSound, buildBlockFromSvg } from './define-from-svg'
import { instantiateBlock } from './instantiate'
import { DEFAULT_SCENE_PALETTE } from './scene-palette'

/** A two-limb figure, the smallest thing that needs a real hierarchy. */
const FIGURE = `
<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
  <rect id="torso" x="70" y="100" width="60" height="140" fill="#4477ff"/>
  <rect id="arm" x="120" y="110" width="24" height="90" fill="#223355"/>
  <circle id="head" cx="100" cy="70" r="34" fill="#4477ff"/>
  <rect id="shadow" x="50" y="360" width="100" height="16" fill="#000000"/>
</svg>`

const parse = (source = FIGURE) => importSvgSource(source, { idPrefix: 'test' })

describe('buildBlockFromSvg', () => {
  it('matches parts to elements by their SVG id', () => {
    const { block } = buildBlockFromSvg(parse(), {
      id: 'local-figure',
      name: 'Figure',
      category: 'character',
      parts: [{ id: 'torso' }, { id: 'head' }],
    })
    expect(block.parts.map((part) => part.id)).toEqual(['torso', 'head'])
    for (const part of block.parts) expect(part.d.length).toBeGreaterThan(0)
  })

  it('takes the block viewport from the document viewBox', () => {
    const { block } = buildBlockFromSvg(parse(), {
      id: 'local-figure',
      name: 'Figure',
      category: 'character',
      parts: [{ id: 'torso' }],
    })
    expect({ width: block.width, height: block.height }).toEqual({ width: 200, height: 400 })
  })

  it('rebuilds geometry in viewBox space, not in each shape own box', () => {
    // The importer normalizes each path into its own bounds; parts have to share
    // one coordinate space or the figure assembles on top of itself.
    const { block } = buildBlockFromSvg(parse(), {
      id: 'local-figure',
      name: 'Figure',
      category: 'character',
      parts: [{ id: 'torso' }, { id: 'head' }],
    })
    const numbers = (d: string) => d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
    const torsoXs = numbers(block.parts[0]!.d).filter((_v, i) => i % 2 === 0)
    const headXs = numbers(block.parts[1]!.d).filter((_v, i) => i % 2 === 0)
    // The torso spans x 70..130 and the head 66..134 — both well away from 0.
    expect(Math.min(...torsoXs)).toBeGreaterThan(50)
    expect(Math.min(...headXs)).toBeGreaterThan(50)
  })

  it('carries the rig: parents, joints, roles and depth', () => {
    const { block } = buildBlockFromSvg(parse(), {
      id: 'local-figure',
      name: 'Figure',
      category: 'character',
      parts: [
        { id: 'torso', fill: 'primary' },
        { id: 'arm', parent: 'torso', pivot: [130, 115], fill: 'ink', depth: 1, opacity: 0.5 },
      ],
    })
    const arm = block.parts.find((part) => part.id === 'arm')!
    expect({
      parent: arm.parent,
      pivot: arm.pivot,
      fill: arm.fill,
      depth: arm.depth,
      opacity: arm.opacity,
    }).toEqual({ parent: 'torso', pivot: [130, 115], fill: 'ink', depth: 1, opacity: 0.5 })
  })

  it('renames a part independently of the element it came from', () => {
    const { block } = buildBlockFromSvg(parse(), {
      id: 'local-figure',
      name: 'Figure',
      category: 'character',
      parts: [{ id: 'upper-arm', from: 'arm' }],
    })
    expect(block.parts[0]?.id).toBe('upper-arm')
    expect(block.parts[0]?.d.length).toBeGreaterThan(0)
  })

  it('gives an unroled part a paint so it is never invisible', () => {
    // A part with neither fill nor stroke draws nothing, and validateBlock
    // refuses it — so a spec that names no role still has to produce paint.
    const { block } = buildBlockFromSvg(parse(), {
      id: 'local-figure',
      name: 'Figure',
      category: 'prop',
      parts: [{ id: 'torso' }],
    })
    expect(Boolean(block.parts[0]?.fill || block.parts[0]?.stroke)).toBe(true)
  })

  it('defaults z to the element document order', () => {
    const { block } = buildBlockFromSvg(parse(), {
      id: 'local-figure',
      name: 'Figure',
      category: 'character',
      parts: [{ id: 'head' }, { id: 'torso' }],
    })
    const head = block.parts.find((part) => part.id === 'head')!
    const torso = block.parts.find((part) => part.id === 'torso')!
    // The head is drawn after the torso in the source, so it stacks in front.
    expect(head.z).toBeGreaterThan(torso.z)
  })

  it('reports elements no part claimed', () => {
    const { unusedElements } = buildBlockFromSvg(parse(), {
      id: 'local-figure',
      name: 'Figure',
      category: 'character',
      parts: [{ id: 'torso' }],
    })
    expect(unusedElements).toEqual(['arm', 'head', 'shadow'])
  })

  it('refuses a part naming an element the document does not have, and says what it has', () => {
    expect(() =>
      buildBlockFromSvg(parse(), {
        id: 'local-figure',
        name: 'Figure',
        category: 'character',
        parts: [{ id: 'torso' }, { id: 'tail' }],
      }),
    ).toThrow(/no element with id "tail".*Available: arm, head, shadow, torso/s)
  })

  it('refuses an empty rig', () => {
    expect(() =>
      buildBlockFromSvg(parse(), {
        id: 'local-figure',
        name: 'Figure',
        category: 'prop',
        parts: [],
      }),
    ).toThrow(/at least one part/)
  })

  it('carries slots and secondary links through', () => {
    const { block } = buildBlockFromSvg(parse(), {
      id: 'local-figure',
      name: 'Figure',
      category: 'character',
      parts: [{ id: 'torso' }, { id: 'arm', parent: 'torso', pivot: [130, 115] }],
      slots: [{ id: 'hand', label: 'Hand', at: [132, 195], partId: 'arm' }],
      secondary: [
        {
          id: 'sway',
          driverPartId: 'torso',
          driverChannel: 'y',
          followerPartId: 'arm',
          followerChannel: 'rotation',
          gain: -0.4,
          lagSeconds: 0.08,
        },
      ],
    })
    expect(block.slots?.[0]?.partId).toBe('arm')
    expect(block.secondary?.[0]?.followerPartId).toBe('arm')
  })
})

describe('assertDefinedBlockIsSound', () => {
  const define = (parts: Parameters<typeof buildBlockFromSvg>[1]['parts']) =>
    buildBlockFromSvg(parse(), {
      id: 'local-figure',
      name: 'Figure',
      category: 'character',
      parts,
    }).block

  it('accepts a sound rig', () => {
    expect(() =>
      assertDefinedBlockIsSound(
        define([
          { id: 'torso', fill: 'primary' },
          { id: 'arm', parent: 'torso', pivot: [130, 115] },
        ]),
      ),
    ).not.toThrow()
  })

  it('refuses a parent that is not a part of the block', () => {
    expect(() => assertDefinedBlockIsSound(define([{ id: 'arm', parent: 'ghost' }]))).toThrow(
      /not a part of this block/,
    )
  })

  it('refuses a parenting cycle', () => {
    expect(() =>
      assertDefinedBlockIsSound(
        define([
          { id: 'torso', parent: 'arm' },
          { id: 'arm', parent: 'torso' },
        ]),
      ),
    ).toThrow(/cycle/)
  })

  it('names the block and the part in the message', () => {
    // A generated rig has no reviewer, so the failure has to be actionable.
    expect(() => assertDefinedBlockIsSound(define([{ id: 'arm', parent: 'ghost' }]))).toThrow(
      /local-figure/,
    )
  })
})

describe('a generated block on the timeline', () => {
  it('lowers through the same path committed artwork does', () => {
    const { block } = buildBlockFromSvg(parse(), {
      id: 'local-figure',
      name: 'Figure',
      category: 'character',
      parts: [
        { id: 'torso', fill: 'primary' },
        { id: 'arm', parent: 'torso', pivot: [130, 115], fill: 'ink' },
        { id: 'head', parent: 'torso', fill: 'highlight' },
      ],
    })
    const result = instantiateBlock({
      block,
      palette: DEFAULT_SCENE_PALETTE,
      from: 0,
      durationInFrames: 60,
      fps: 30,
    })
    expect({ items: result.items.length, skipped: result.skipped }).toEqual({
      items: 3,
      skipped: [],
    })
    // The hierarchy survives, which is the whole point of rigging it.
    const arm = result.items.find((item) => item.id.endsWith('-arm'))
    expect(arm?.transformParent?.parentItemId).toBe('local-figure-torso')
    // And the joint is honoured rather than defaulting to the bounding centre.
    expect(arm?.transform?.anchorX).toBeCloseTo(10, 6)
  })

  it('drives a generated rig with secondary motion', () => {
    const { block } = buildBlockFromSvg(parse(), {
      id: 'local-figure',
      name: 'Figure',
      category: 'character',
      parts: [
        { id: 'torso', fill: 'primary' },
        { id: 'arm', parent: 'torso', pivot: [130, 115], fill: 'ink' },
      ],
      secondary: [
        {
          id: 'sway',
          driverPartId: 'torso',
          driverChannel: 'y',
          followerPartId: 'arm',
          followerChannel: 'rotation',
          gain: -0.6,
          lagSeconds: 0.08,
        },
      ],
    })
    const result = instantiateBlock({
      block,
      palette: DEFAULT_SCENE_PALETTE,
      from: 0,
      durationInFrames: 60,
      fps: 30,
      gestures: [
        {
          gesture: {
            id: 'bob',
            name: 'Bob',
            loop: true,
            tracks: [
              {
                partId: 'torso',
                channel: 'y',
                keyframes: [
                  { at: 0, value: 0, easing: 'ease-in-out' },
                  { at: 0.5, value: -20, easing: 'ease-in-out' },
                  { at: 1, value: 0, easing: 'ease-in-out' },
                ],
              },
            ],
          },
        },
      ],
    })
    const arm = result.keyframes.find((entry) => entry.itemId.endsWith('-arm'))
    expect(arm?.properties.some((entry) => entry.property === 'rotation')).toBe(true)
  })
})
