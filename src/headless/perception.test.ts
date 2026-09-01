// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  checkScene,
  planContactSheet,
  planSampleFrames,
  summarizeMotion,
  type PerceivedBox,
  type PerceivedFrame,
} from './perception'

const canvas = { width: 1920, height: 1080, fps: 30 }

const box = (overrides: Partial<PerceivedBox> = {}): PerceivedBox => ({
  id: 'a',
  type: 'shape',
  x: 800,
  y: 400,
  width: 200,
  height: 200,
  rotation: 0,
  opacity: 1,
  visible: true,
  z: 0,
  ...overrides,
})

const frames = (...perFrame: PerceivedBox[][]): PerceivedFrame[] =>
  perFrame.map((boxes, index) => ({ frame: index * 10, boxes }))

const codes = (result: ReturnType<typeof checkScene>) => result.issues.map((issue) => issue.code)

describe('summarizeMotion', () => {
  it('measures travel along the centre path, not the corner', () => {
    // Scaling around a fixed centre moves the corner but not the object.
    const report = summarizeMotion(
      frames(
        [box({ x: 800, y: 400, width: 200, height: 200 })],
        [box({ x: 750, y: 350, width: 300, height: 300 })],
      ),
      canvas,
    )
    expect(report.items[0]?.travel).toBe(0)
    expect(report.items[0]?.widthRange).toBe(100)
    expect(report.items[0]?.moved).toBe(true)
  })

  it('accumulates path length rather than only start-to-end distance', () => {
    const report = summarizeMotion(
      frames([box({ x: 0 })], [box({ x: 100 })], [box({ x: 0 })]),
      canvas,
    )
    expect(report.items[0]?.travel).toBe(200)
    expect(report.items[0]?.netDisplacement).toBe(0)
  })

  it('reports peak speed per frame, not per sample', () => {
    // 100px over a 10-frame gap is 10px/frame.
    const report = summarizeMotion(frames([box({ x: 0 })], [box({ x: 100 })]), canvas)
    expect(report.items[0]?.peakSpeed).toBe(10)
  })

  it('flags a keyframed item that never actually changes', () => {
    const report = summarizeMotion(frames([box()], [box()], [box()]), canvas)
    expect(report.items[0]?.moved).toBe(false)
  })

  it('treats sub-pixel drift as still, so noise does not read as motion', () => {
    const report = summarizeMotion(frames([box({ x: 800 })], [box({ x: 800.1 })]), canvas)
    expect(report.items[0]?.moved).toBe(false)
  })

  it('detects a rotation-only or opacity-only change', () => {
    expect(summarizeMotion(frames([box()], [box({ rotation: 12 })]), canvas).items[0]?.moved).toBe(
      true,
    )
    expect(summarizeMotion(frames([box()], [box({ opacity: 0.5 })]), canvas).items[0]?.moved).toBe(
      true,
    )
  })

  it('counts frames an item was absent from', () => {
    const report = summarizeMotion(frames([box()], [], [box()]), canvas)
    expect(report.items[0]?.absentFrames).toBe(1)
  })

  it('narrows to requested items', () => {
    const report = summarizeMotion(frames([box({ id: 'a' }), box({ id: 'b' })]), canvas, {
      itemIds: ['b'],
    })
    expect(report.items.map((item) => item.id)).toEqual(['b'])
  })

  it('orders items stably so two runs compare cleanly', () => {
    const shuffled = frames([box({ id: 'z' }), box({ id: 'a' }), box({ id: 'm' })])
    expect(summarizeMotion(shuffled, canvas).items.map((item) => item.id)).toEqual(['a', 'm', 'z'])
  })
})

describe('checkScene', () => {
  it('passes a clean frame', () => {
    const result = checkScene(frames([box()]), canvas)
    expect({ ok: result.ok, issues: result.issues }).toEqual({ ok: true, issues: [] })
  })

  it('errors on a visible item entirely off canvas', () => {
    const result = checkScene(frames([box({ x: 5000 })]), canvas)
    expect(codes(result)).toContain('off-canvas')
    expect(result.ok).toBe(false)
  })

  it('warns when an item is mostly off canvas but not entirely', () => {
    const result = checkScene(frames([box({ x: -150, width: 200 })]), canvas)
    expect(codes(result)).toContain('clipped')
    // A clip is a judgement call, not a broken frame.
    expect(result.ok).toBe(true)
  })

  it('warns when text leaves the title-safe area for the whole range', () => {
    const result = checkScene(
      frames([box({ type: 'text', text: 'hello', x: 20, y: 500, width: 400, height: 80 })]),
      canvas,
    )
    expect(codes(result)).toContain('title-unsafe')
  })

  it('does not judge the placement of an invisible item', () => {
    // Parked off-canvas is a normal way to hide something; only what is drawn is
    // held to the geometry gates. (The frame is separately reported as empty.)
    const result = checkScene(
      frames([box({ id: 'parked', x: 5000, visible: false }), box({ id: 'seen' })]),
      canvas,
    )
    expect(result.issues).toEqual([])
  })

  it('catches a layer that never rises above ghost opacity', () => {
    const result = checkScene(frames([box({ opacity: 0.02 })], [box({ opacity: 0.03 })]), canvas)
    expect(codes(result)).toContain('ghost-opacity')
  })

  it('does not call a fade through low opacity a ghost', () => {
    // A fade-in legitimately passes through 2%; only a layer that never becomes
    // visible is a fault, so this is judged across the range, not per frame.
    const result = checkScene(
      frames([box({ opacity: 0.02 })], [box({ opacity: 0.5 })], [box({ opacity: 1 })]),
      canvas,
    )
    expect(codes(result)).not.toContain('ghost-opacity')
  })

  it('does not call a fully transparent item a ghost', () => {
    // Opacity 0 is a deliberate hide; a hair above zero is a mistake.
    expect(
      codes(checkScene(frames([box({ opacity: 0 })], [box({ opacity: 0 })]), canvas)),
    ).not.toContain('ghost-opacity')
  })

  it('warns when text leaves the title-safe area', () => {
    const result = checkScene(
      frames([box({ type: 'text', text: 'hello', x: 20, y: 500, width: 400, height: 80 })]),
      canvas,
    )
    expect(codes(result)).toContain('title-unsafe')
  })

  it('leaves text inside the safe area alone', () => {
    const result = checkScene(
      frames([box({ type: 'text', text: 'hi', x: 700, y: 500, width: 400, height: 80 })]),
      canvas,
    )
    expect(codes(result)).not.toContain('title-unsafe')
  })

  it('does not mistake fractional text-metric arithmetic for clipping', () => {
    const result = checkScene(
      frames([
        box({
          type: 'text',
          text: 'THE DEV REALM',
          x: 260,
          y: 751.4020408163265,
          width: 1400,
          height: 130.39999999999998,
        }),
      ]),
      canvas,
      { titleSafe: 0.92 },
    )
    expect(codes(result)).not.toContain('title-unsafe')
  })

  it('does not hold non-text to the title-safe area', () => {
    const result = checkScene(frames([box({ x: 20, y: 500, width: 400, height: 80 })]), canvas)
    expect(codes(result)).not.toContain('title-unsafe')
  })

  it('errors on a degenerate box', () => {
    const result = checkScene(frames([box({ width: 0 })]), canvas)
    expect(codes(result)).toContain('degenerate-size')
    expect(result.ok).toBe(false)
  })

  it('errors on a non-finite transform', () => {
    const result = checkScene(frames([box({ x: Number.NaN })]), canvas)
    expect(codes(result)).toContain('non-finite-transform')
    expect(result.ok).toBe(false)
  })

  it('catches two full-frame layers ghosting over each other', () => {
    const backdrop = (id: string) =>
      box({ id, x: 0, y: 0, width: 1920, height: 1080, opacity: 0.7 })
    const result = checkScene(frames([backdrop('sky'), backdrop('room')]), canvas)
    expect(codes(result)).toContain('stacked-backdrops')
  })

  it('allows one full-frame backdrop', () => {
    const result = checkScene(
      frames([box({ id: 'sky', x: 0, y: 0, width: 1920, height: 1080 })]),
      canvas,
    )
    expect(codes(result)).not.toContain('stacked-backdrops')
  })

  it('reports a blank frame in the middle of a range', () => {
    const result = checkScene(frames([box()], [box({ visible: false })], [box()]), canvas)
    expect(codes(result)).toContain('empty-frame')
  })

  it('does not report a blank frame at either end of the range', () => {
    // An appear gesture starts from nothing and a dismiss ends there, so the
    // endpoints are where a correct fade is legitimately empty.
    const result = checkScene(
      frames([box({ visible: false })], [box()], [box({ visible: false })]),
      canvas,
    )
    expect(codes(result)).not.toContain('empty-frame')
  })

  it('flags a keyframed item that never changes', () => {
    const keyed = box({ animated: true })
    const result = checkScene(frames([keyed], [keyed], [keyed]), canvas)
    expect(codes(result)).toContain('static-across-range')
  })

  it('does not flag an item that was never animated for holding still', () => {
    // Most of a scene is deliberately static; only a broken animation is news.
    const result = checkScene(frames([box()], [box()], [box()]), canvas)
    expect(codes(result)).not.toContain('static-across-range')
  })

  it('does not flag a keyframed item that does move', () => {
    const result = checkScene(
      frames([box({ animated: true, x: 0 })], [box({ animated: true, x: 300 })]),
      canvas,
    )
    expect(codes(result)).not.toContain('static-across-range')
  })

  it('does not flag a static item when only one frame was sampled', () => {
    expect(codes(checkScene(frames([box({ animated: true })]), canvas))).not.toContain(
      'static-across-range',
    )
  })

  it('will not call a barely-sampled item static', () => {
    // A short-lived item catches only a frame or two of a coarse grid, and two
    // samples of a settled pose look identical to an animation that never ran.
    const keyed = box({ animated: true })
    const sparse = [
      { frame: 0, boxes: [] },
      { frame: 10, boxes: [keyed] },
      { frame: 20, boxes: [keyed] },
      { frame: 30, boxes: [] },
    ]
    expect(codes(checkScene(sparse, canvas))).not.toContain('static-across-range')
  })

  it('collapses a repeated per-frame issue into one entry with a count', () => {
    const result = checkScene(frames([box({ width: 0 })], [box({ width: 0 })]), canvas)
    const degenerate = result.issues.filter((issue) => issue.code === 'degenerate-size')
    expect(degenerate).toHaveLength(1)
    expect({ frame: degenerate[0]?.frame, frames: degenerate[0]?.frames }).toEqual({
      frame: 0,
      frames: 2,
    })
  })

  it('does not fault an item that starts off canvas and travels in', () => {
    // An `enter` from the right begins outside the frame by design; flagging it
    // would fire on every correctly-authored entrance.
    const result = checkScene(
      frames([box({ x: 4000 })], [box({ x: 1500 })], [box({ x: 860 })]),
      canvas,
    )
    expect(codes(result)).not.toContain('off-canvas')
    expect(codes(result)).not.toContain('clipped')
  })

  it('errors on an item that is never on canvas at any sampled frame', () => {
    const result = checkScene(frames([box({ x: 4000 })], [box({ x: 5000 })]), canvas)
    expect(codes(result)).toContain('off-canvas')
    expect(result.ok).toBe(false)
  })

  it('warns about an item that is never more than partly on canvas', () => {
    const result = checkScene(
      frames([box({ x: -150, width: 200 })], [box({ x: -160, width: 200 })]),
      canvas,
    )
    expect(codes(result)).toContain('clipped')
    expect(result.ok).toBe(true)
  })

  it('lets text pass through the title-safe edge on its way in', () => {
    const text = (x: number) => box({ type: 'text', text: 'hi', x, y: 500, width: 400, height: 80 })
    const result = checkScene(frames([text(10)], [text(760)]), canvas)
    expect(codes(result)).not.toContain('title-unsafe')
  })

  it('sorts errors above warnings', () => {
    const result = checkScene(
      frames([box({ id: 'ghost', opacity: 0.01 }), box({ id: 'gone', x: 9000 })]),
      canvas,
    )
    expect(result.issues[0]?.severity).toBe('error')
  })

  it('honours a custom title-safe fraction', () => {
    const text = box({ type: 'text', x: 100, y: 500, width: 400, height: 80 })
    expect(codes(checkScene(frames([text]), canvas, { titleSafe: 0.99 }))).not.toContain(
      'title-unsafe',
    )
    expect(codes(checkScene(frames([text]), canvas, { titleSafe: 0.5 }))).toContain('title-unsafe')
  })
})

describe('planContactSheet', () => {
  const shape = { width: 1920, height: 1080 }

  it('always includes both endpoints', () => {
    const plan = planContactSheet({ from: 0, to: 90, count: 4, canvas: shape })
    expect(plan.frames[0]).toBe(0)
    expect(plan.frames.at(-1)).toBe(90)
  })

  it('spaces the interior evenly', () => {
    expect(planContactSheet({ from: 0, to: 90, count: 4, canvas: shape }).frames).toEqual([
      0, 30, 60, 90,
    ])
  })

  it('never asks for more frames than the range holds', () => {
    expect(planContactSheet({ from: 10, to: 12, count: 20, canvas: shape }).frames).toEqual([
      10, 11, 12,
    ])
  })

  it('handles a single-frame range', () => {
    expect(planContactSheet({ from: 7, to: 7, count: 5, canvas: shape }).frames).toEqual([7])
  })

  it('normalizes a reversed range', () => {
    expect(planContactSheet({ from: 90, to: 0, count: 3, canvas: shape }).frames).toEqual([
      0, 45, 90,
    ])
  })

  it('preserves the canvas aspect ratio in each cell', () => {
    const plan = planContactSheet({ from: 0, to: 10, count: 4, canvas: shape, cellWidth: 480 })
    expect(plan.cellHeight).toBe(270)
  })

  it('sizes the sheet from the grid', () => {
    const plan = planContactSheet({
      from: 0,
      to: 30,
      count: 4,
      canvas: shape,
      columns: 2,
      cellWidth: 480,
    })
    expect({
      columns: plan.columns,
      rows: plan.rows,
      sheetWidth: plan.sheetWidth,
      sheetHeight: plan.sheetHeight,
    }).toEqual({ columns: 2, rows: 2, sheetWidth: 960, sheetHeight: 540 })
  })

  it('lays out a near-square grid by default', () => {
    const plan = planContactSheet({ from: 0, to: 100, count: 9, canvas: shape })
    expect({ columns: plan.columns, rows: plan.rows }).toEqual({ columns: 3, rows: 3 })
  })
})

describe('planSampleFrames', () => {
  it('always includes both endpoints', () => {
    const frames = planSampleFrames({ from: 0, to: 100, samples: 5, defaultTo: 100 })
    expect([frames[0], frames.at(-1)]).toEqual([0, 100])
  })

  it('spaces samples evenly', () => {
    expect(planSampleFrames({ from: 0, to: 60, samples: 4, defaultTo: 60 })).toEqual([
      0, 20, 40, 60,
    ])
  })

  it('falls back to the supplied end of the range', () => {
    expect(planSampleFrames({ samples: 3, defaultTo: 20 })).toEqual([0, 10, 20])
  })

  it('never returns more samples than the range has frames', () => {
    expect(planSampleFrames({ from: 5, to: 7, samples: 50, defaultTo: 7 })).toEqual([5, 6, 7])
  })

  it('collapses a zero-length range to a single frame', () => {
    expect(planSampleFrames({ from: 9, to: 9, samples: 8, defaultTo: 9 })).toEqual([9])
  })

  it('treats an end before the start as a single frame', () => {
    expect(planSampleFrames({ from: 30, to: 10, samples: 4, defaultTo: 10 })).toEqual([30])
  })

  it('clamps a negative start to zero', () => {
    expect(planSampleFrames({ from: -10, to: 2, samples: 3, defaultTo: 2 })).toEqual([0, 1, 2])
  })

  it('caps the default resolution so a long cut stays cheap to sample', () => {
    expect(planSampleFrames({ from: 0, to: 5000, defaultTo: 5000 })).toHaveLength(24)
  })

  it('samples every frame of a range shorter than the default', () => {
    expect(planSampleFrames({ from: 0, to: 3, defaultTo: 3 })).toEqual([0, 1, 2, 3])
  })
})
