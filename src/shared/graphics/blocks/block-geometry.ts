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
