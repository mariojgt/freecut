/**
 * Path-data helpers for authoring blocks.
 *
 * Block artwork is committed source, so it is written as readable constructors
 * rather than pasted coordinate soup — a limb's length stays a number someone
 * can nudge, and the geometry survives review.
 */

/** Rounded capsule/rect. The radius clamps so it cannot invert on thin parts. */
export function capsule(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  const r = Math.min(radius, width / 2, height / 2)
  const right = x + width
  const bottom = y + height
  return [
    `M ${x + r} ${y}`,
    `L ${right - r} ${y}`,
    `A ${r} ${r} 0 0 1 ${right} ${y + r}`,
    `L ${right} ${bottom - r}`,
    `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
    `L ${x + r} ${bottom}`,
    `A ${r} ${r} 0 0 1 ${x} ${bottom - r}`,
    `L ${x} ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ')
}

/** Ellipse as two half arcs; one arc cannot express a full sweep. */
export function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return [
    `M ${cx - rx} ${cy}`,
    `A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy}`,
    `A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy}`,
    'Z',
  ].join(' ')
}

export function circle(cx: number, cy: number, r: number): string {
  return ellipse(cx, cy, r, r)
}

/**
 * Thick line segment with round caps.
 *
 * Character rigs use this instead of a stroked line so every limb has stable
 * filled bounds in the path renderer. The endpoints stay meaningful authoring
 * joints while the perpendicular is derived from their direction.
 */
export function roundedSegment(
  from: readonly [number, number],
  to: readonly [number, number],
  width: number,
): string {
  const [x1, y1] = from
  const [x2, y2] = to
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy)
  if (length === 0) return circle(x1, y1, Math.max(0, width) / 2)

  const radius = Math.max(0, width) / 2
  const nx = (-dy / length) * radius
  const ny = (dx / length) * radius
  return [
    `M ${x1 + nx} ${y1 + ny}`,
    `L ${x2 + nx} ${y2 + ny}`,
    `A ${radius} ${radius} 0 0 0 ${x2 - nx} ${y2 - ny}`,
    `L ${x1 - nx} ${y1 - ny}`,
    `A ${radius} ${radius} 0 0 0 ${x1 + nx} ${y1 + ny}`,
    'Z',
  ].join(' ')
}

/**
 * Closed polygon through the given points.
 *
 * Arrow heads, cursors and check marks are all straight-edged silhouettes that
 * would be unreadable as a hand-written path string, and unlike `capsule` they
 * have no repeating structure to parameterise.
 */
export function polygon(points: readonly [number, number][]): string {
  if (points.length < 3) {
    throw new Error(`A polygon needs at least three points, got ${points.length}.`)
  }
  const [first, ...rest] = points
  return [`M ${first![0]} ${first![1]}`, ...rest.map(([x, y]) => `L ${x} ${y}`), 'Z'].join(' ')
}

/**
 * Horizontal bar with fully rounded ends.
 *
 * The shape almost every UI block is made of — a field, a label, a line of
 * placeholder copy — so it is worth not restating the radius each time.
 */
export function bar(x: number, y: number, width: number, height: number): string {
  return capsule(x, y, width, height, height / 2)
}
