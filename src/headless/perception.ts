/**
 * What the harness can tell an agent about a frame it cannot see.
 *
 * `grab_frame` returns a picture, which is only useful to something with eyes.
 * These functions turn resolved layout into numbers and named failures instead,
 * so a model can measure whether a beat actually moved, whether anything left
 * the frame, and whether the thing it just animated is visible at all — and then
 * iterate. Without this it authors keyframes and hopes.
 *
 * Pure on purpose: everything here takes plain resolved geometry, so the rules
 * are testable in Node with no browser, GPU or render round-trip.
 */

/** One item's resolved geometry at one frame, as `dumpLayout` reports it. */
export interface PerceivedBox {
  id: string
  type: string
  /** Canvas-space top-left corner (px), origin at canvas top-left. */
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  z: number
  text?: string
}

export interface PerceivedFrame {
  frame: number
  boxes: PerceivedBox[]
}

export interface PerceivedCanvas {
  width: number
  height: number
  fps: number
}

// ---------------------------------------------------------------------------
// Motion sampling
// ---------------------------------------------------------------------------

export interface MotionSample {
  frame: number
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
}

export interface MotionSummary {
  id: string
  type: string
  samples: MotionSample[]
  /** Path length of the box centre across the range, in px. */
  travel: number
  /** Straight-line distance from first to last centre, in px. */
  netDisplacement: number
  /** Fastest centre movement between two consecutive samples, px per frame. */
  peakSpeed: number
  /** Peak-to-trough spread of each channel across the range. */
  rotationRange: number
  widthRange: number
  heightRange: number
  opacityRange: number
  /**
   * Whether anything measurably changed. This is the number that answers "did my
   * keyframes do anything", which is the question a model cannot otherwise ask.
   */
  moved: boolean
  /** Frames in the range where the item was not drawn at all. */
  absentFrames: number
}

export interface MotionReport {
  frames: number[]
  canvas: PerceivedCanvas
  items: MotionSummary[]
}

/** Frames sampled when a caller names a range but not a resolution. */
const DEFAULT_SAMPLES = 24

/** Below this, a change is rounding noise rather than motion anyone can see. */
const MOTION_EPSILON = 0.5
const ROTATION_EPSILON = 0.05
const OPACITY_EPSILON = 0.004

function spread(values: readonly number[]): number {
  if (values.length === 0) return 0
  return Math.max(...values) - Math.min(...values)
}

function round(value: number, places = 2): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/**
 * Reduce a sampled range to per-item motion statistics.
 *
 * Reports the centre rather than the corner because a box that only scales has a
 * moving corner and a still centre, and calling that "movement" would make the
 * `moved` flag useless for the case it exists to catch.
 */
export function summarizeMotion(
  frames: readonly PerceivedFrame[],
  canvas: PerceivedCanvas,
  options: { itemIds?: readonly string[] } = {},
): MotionReport {
  const wanted = options.itemIds?.length ? new Set(options.itemIds) : null
  const byItem = new Map<string, { type: string; samples: MotionSample[] }>()

  for (const frame of frames) {
    for (const box of frame.boxes) {
      if (wanted && !wanted.has(box.id)) continue
      const entry = byItem.get(box.id) ?? { type: box.type, samples: [] }
      entry.samples.push({
        frame: frame.frame,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        rotation: box.rotation,
        opacity: box.opacity,
      })
      byItem.set(box.id, entry)
    }
  }

  const items: MotionSummary[] = [...byItem.entries()].map(([id, entry]) => {
    const { samples } = entry
    const centres = samples.map((sample) => ({
      x: sample.x + sample.width / 2,
      y: sample.y + sample.height / 2,
    }))

    let travel = 0
    let peakSpeed = 0
    for (let index = 1; index < centres.length; index++) {
      const previous = centres[index - 1]!
      const current = centres[index]!
      const step = Math.hypot(current.x - previous.x, current.y - previous.y)
      const frameGap = Math.max(1, samples[index]!.frame - samples[index - 1]!.frame)
      travel += step
      peakSpeed = Math.max(peakSpeed, step / frameGap)
    }

    const first = centres[0]
    const last = centres[centres.length - 1]
    const netDisplacement = first && last ? Math.hypot(last.x - first.x, last.y - first.y) : 0

    const rotationRange = spread(samples.map((sample) => sample.rotation))
    const widthRange = spread(samples.map((sample) => sample.width))
    const heightRange = spread(samples.map((sample) => sample.height))
    const opacityRange = spread(samples.map((sample) => sample.opacity))

    return {
      id,
      type: entry.type,
      samples: samples.map((sample) => ({
        frame: sample.frame,
        x: round(sample.x, 1),
        y: round(sample.y, 1),
        width: round(sample.width, 1),
        height: round(sample.height, 1),
        rotation: round(sample.rotation, 2),
        opacity: round(sample.opacity, 3),
      })),
      travel: round(travel, 1),
      netDisplacement: round(netDisplacement, 1),
      peakSpeed: round(peakSpeed, 2),
      rotationRange: round(rotationRange, 2),
      widthRange: round(widthRange, 1),
      heightRange: round(heightRange, 1),
      opacityRange: round(opacityRange, 3),
      moved:
        travel > MOTION_EPSILON ||
        rotationRange > ROTATION_EPSILON ||
        widthRange > MOTION_EPSILON ||
        heightRange > MOTION_EPSILON ||
        opacityRange > OPACITY_EPSILON,
      absentFrames: frames.length - samples.length,
    }
  })

  return {
    frames: frames.map((frame) => frame.frame),
    canvas,
    // Stable order so two runs of the same project compare cleanly.
    items: items.sort((a, b) => a.id.localeCompare(b.id)),
  }
}

// ---------------------------------------------------------------------------
// Scene gates
// ---------------------------------------------------------------------------

export type SceneIssueSeverity = 'error' | 'warning'

export interface SceneIssue {
  code: string
  severity: SceneIssueSeverity
  message: string
  itemId?: string
  /** First frame the issue was observed at. */
  frame?: number
  /** How many sampled frames showed it, so a one-frame blip reads as one. */
  frames?: number
}

export interface CheckSceneOptions {
  /**
   * Fraction of the canvas on-screen copy must stay inside. Broadcast practice
   * is 90%; text that touches the edge is the most common generated-scene fault.
   */
  titleSafe?: number
  /** Opacity below which an item composites but cannot be seen. */
  ghostOpacity?: number
  /** Fraction of its own area a box may have outside the canvas before warning. */
  offCanvasTolerance?: number
}

const DEFAULTS: Required<CheckSceneOptions> = {
  titleSafe: 0.9,
  ghostOpacity: 0.06,
  offCanvasTolerance: 0.25,
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Overlap of a box with a rect, as a fraction of the box's own area. */
function insideFraction(box: PerceivedBox, rect: Rect): number {
  const area = box.width * box.height
  if (area <= 0) return 0
  const overlapWidth = Math.max(
    0,
    Math.min(box.x + box.width, rect.x + rect.width) - Math.max(box.x, rect.x),
  )
  const overlapHeight = Math.max(
    0,
    Math.min(box.y + box.height, rect.y + rect.height) - Math.max(box.y, rect.y),
  )
  return (overlapWidth * overlapHeight) / area
}

/** Accumulates one issue per (code, itemId) with a first frame and a count. */
class IssueLedger {
  private readonly entries = new Map<string, SceneIssue>()

  add(issue: SceneIssue): void {
    const key = `${issue.code}:${issue.itemId ?? ''}`
    const existing = this.entries.get(key)
    if (existing) {
      existing.frames = (existing.frames ?? 1) + 1
      return
    }
    this.entries.set(key, { ...issue, frames: 1 })
  }

  /** Errors first, then by code, so the worst thing is always at the top. */
  list(): SceneIssue[] {
    return [...this.entries.values()].sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1
      return a.code.localeCompare(b.code) || (a.itemId ?? '').localeCompare(b.itemId ?? '')
    })
  }
}

/** Gates that only make sense within one frame. */
function checkFrame(
  frame: PerceivedFrame,
  scene: { canvas: PerceivedCanvas; canvasRect: Rect; settings: Required<CheckSceneOptions> },
  ledger: IssueLedger,
): void {
  const { canvas, canvasRect, settings } = scene
  const context: GateContext = {
    canvasRect,
    safeRect: {
      x: (canvas.width * (1 - settings.titleSafe)) / 2,
      y: (canvas.height * (1 - settings.titleSafe)) / 2,
      width: canvas.width * settings.titleSafe,
      height: canvas.height * settings.titleSafe,
    },
    canvasArea: canvas.width * canvas.height,
    settings,
    frame: frame.frame,
  }

  if (frame.boxes.length > 0 && !frame.boxes.some((box) => box.visible)) {
    ledger.add({
      code: 'empty-frame',
      severity: 'warning',
      frame: frame.frame,
      message: 'Nothing is drawn at this frame, though items are active on the timeline.',
    })
  }

  const backdrops: PerceivedBox[] = []
  for (const box of frame.boxes) {
    if (gateUndrawable(box, context, ledger)) continue
    // An invisible item may sit anywhere; only what is drawn is judged.
    if (!box.visible) continue
    gateFraming(box, context, ledger)
    gateGhostOpacity(box, context, ledger)
    gateTitleSafe(box, context, ledger)
    if (isBackdrop(box, context)) backdrops.push(box)
  }

  // Two opaque full-frame layers at once is the cross-dissolve that reads as
  // ghosting rather than as a cut.
  if (backdrops.length > 1) {
    ledger.add({
      code: 'stacked-backdrops',
      severity: 'warning',
      frame: frame.frame,
      message: `${backdrops.length} full-frame layers are visible at once (${backdrops
        .map((box) => box.id)
        .join(', ')}); one will read as a ghost over the other.`,
    })
  }
}

/** Gates that need more than one frame to mean anything. */
function checkRange(
  frames: readonly PerceivedFrame[],
  canvas: PerceivedCanvas,
  ledger: IssueLedger,
): void {
  if (frames.length <= 1) return
  for (const summary of summarizeMotion(frames, canvas).items) {
    if (summary.samples.length > 1 && !summary.moved) {
      ledger.add({
        code: 'static-across-range',
        severity: 'warning',
        itemId: summary.id,
        frame: frames[0]?.frame,
        message: 'Present for the whole range and never changes; no animation resolved for it.',
      })
    }
  }
}

/**
 * Run the semantic gates a rendered image cannot report.
 *
 * These are the faults that look fine in a single still and ruin a cut: a title
 * three pixels off the safe area, a layer left at 2% opacity that still costs a
 * composite, two full-frame backdrops cross-dissolving into mush, a keyframed
 * element that never actually moves.
 */
interface GateContext {
  canvasRect: Rect
  safeRect: Rect
  canvasArea: number
  settings: Required<CheckSceneOptions>
  frame: number
}

/** True once a box is malformed enough that no further gate can say anything. */
function gateUndrawable(box: PerceivedBox, context: GateContext, ledger: IssueLedger): boolean {
  const values = [box.x, box.y, box.width, box.height, box.rotation, box.opacity]
  if (values.some((value) => !Number.isFinite(value))) {
    ledger.add({
      code: 'non-finite-transform',
      severity: 'error',
      itemId: box.id,
      frame: context.frame,
      message: 'A resolved transform value is NaN or Infinity; this item cannot be drawn.',
    })
    return true
  }
  if (box.width <= 0 || box.height <= 0) {
    ledger.add({
      code: 'degenerate-size',
      severity: 'error',
      itemId: box.id,
      frame: context.frame,
      message: `Resolves to ${round(box.width, 1)}x${round(box.height, 1)}, so it occupies no area.`,
    })
    return true
  }
  return false
}

/** Whether what is drawn is actually inside the frame. */
function gateFraming(box: PerceivedBox, context: GateContext, ledger: IssueLedger): void {
  const inside = insideFraction(box, context.canvasRect)
  if (inside <= 0) {
    ledger.add({
      code: 'off-canvas',
      severity: 'error',
      itemId: box.id,
      frame: context.frame,
      message: 'Visible but entirely outside the canvas, so it renders as nothing.',
    })
    return
  }
  if (inside < 1 - context.settings.offCanvasTolerance) {
    ledger.add({
      code: 'clipped',
      severity: 'warning',
      itemId: box.id,
      frame: context.frame,
      message: `Only ${Math.round(inside * 100)}% of it is on canvas.`,
    })
  }
}

/** A layer that costs a composite but cannot be seen. */
function gateGhostOpacity(box: PerceivedBox, context: GateContext, ledger: IssueLedger): void {
  // Zero is a deliberate hide; a hair above zero is a mistake.
  if (box.opacity <= 0 || box.opacity >= context.settings.ghostOpacity) return
  ledger.add({
    code: 'ghost-opacity',
    severity: 'warning',
    itemId: box.id,
    frame: context.frame,
    message: `Held at ${round(box.opacity, 3)} opacity — it composites but reads as absent.`,
  })
}

/** On-screen copy has to survive overscan and platform-chrome cropping. */
function gateTitleSafe(box: PerceivedBox, context: GateContext, ledger: IssueLedger): void {
  if (box.type !== 'text') return
  if (insideFraction(box, context.safeRect) >= 1) return
  ledger.add({
    code: 'title-unsafe',
    severity: 'warning',
    itemId: box.id,
    frame: context.frame,
    message: `Text crosses the ${Math.round(context.settings.titleSafe * 100)}% title-safe area.`,
  })
}

/** A layer that fills the frame opaquely, and so hides everything behind it. */
function isBackdrop(box: PerceivedBox, context: GateContext): boolean {
  if (box.opacity < 0.5) return false
  if (insideFraction(box, context.canvasRect) < 0.9) return false
  return (box.width * box.height) / context.canvasArea >= 0.9
}

/**
 * Run the semantic gates a rendered image cannot report.
 *
 * These are the faults that look fine in a single still and ruin a cut: a title
 * three pixels off the safe area, a layer left at 2% opacity that still costs a
 * composite, two full-frame backdrops cross-dissolving into mush, a keyframed
 * element that never actually moves.
 */
export function checkScene(
  frames: readonly PerceivedFrame[],
  canvas: PerceivedCanvas,
  options: CheckSceneOptions = {},
): { ok: boolean; issues: SceneIssue[]; framesChecked: number } {
  const settings = { ...DEFAULTS, ...options }
  const ledger = new IssueLedger()
  const canvasRect = { x: 0, y: 0, width: canvas.width, height: canvas.height }

  for (const frame of frames) {
    checkFrame(frame, { canvas, canvasRect, settings }, ledger)
  }
  checkRange(frames, canvas, ledger)

  const issues = ledger.list()
  return {
    ok: issues.every((issue) => issue.severity !== 'error'),
    issues,
    framesChecked: frames.length,
  }
}

/**
 * Frames to sample across a range.
 *
 * Endpoints are always included: the last frame is where an unfinished move or
 * an unsettled title shows up, so a sampler that stopped short of it would
 * report a clean scene for exactly the case worth catching.
 */
export function planSampleFrames(input: {
  from?: number
  to?: number
  samples?: number
  /** Used when the caller gives no end, normally the last active frame. */
  defaultTo: number
}): number[] {
  const from = Math.max(0, Math.round(input.from ?? 0))
  const to = Math.max(from, Math.round(input.to ?? input.defaultTo))
  const span = to - from
  const requested = Math.max(1, Math.round(input.samples ?? Math.min(DEFAULT_SAMPLES, span + 1)))
  const count = Math.min(requested, span + 1)
  if (count === 1) return [from]
  const frames = Array.from({ length: count }, (_unused, index) =>
    Math.round(from + (span * index) / (count - 1)),
  )
  return [...new Set(frames)].sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// Contact sheets
// ---------------------------------------------------------------------------

export interface ContactSheetPlan {
  frames: number[]
  columns: number
  rows: number
  cellWidth: number
  cellHeight: number
  sheetWidth: number
  sheetHeight: number
}

/**
 * Choose which frames a contact sheet shows and how they tile.
 *
 * Endpoints are always included and the interior is evenly spaced: a sheet that
 * missed the last frame would hide exactly the kind of end-of-beat error — a
 * limb still mid-swing, a title not yet settled — that a sheet is read for.
 */
export function planContactSheet(input: {
  from: number
  to: number
  count: number
  canvas: { width: number; height: number }
  columns?: number
  cellWidth?: number
}): ContactSheetPlan {
  const from = Math.min(input.from, input.to)
  const to = Math.max(input.from, input.to)
  const span = to - from
  const count = Math.max(1, Math.min(Math.floor(input.count), span + 1))

  const frames =
    count === 1
      ? [from]
      : Array.from({ length: count }, (_unused, index) =>
          Math.round(from + (span * index) / (count - 1)),
        )
  const unique = [...new Set(frames)].sort((a, b) => a - b)

  const columns = Math.max(
    1,
    input.columns ?? Math.min(unique.length, Math.ceil(Math.sqrt(unique.length))),
  )
  const rows = Math.ceil(unique.length / columns)
  const cellWidth = Math.max(1, Math.round(input.cellWidth ?? 480))
  const cellHeight = Math.max(
    1,
    Math.round((cellWidth * input.canvas.height) / Math.max(1, input.canvas.width)),
  )

  return {
    frames: unique,
    columns,
    rows,
    cellWidth,
    cellHeight,
    sheetWidth: cellWidth * columns,
    sheetHeight: cellHeight * rows,
  }
}
