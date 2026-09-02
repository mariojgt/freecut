export interface FrameRenderViewport {
  startFrame: number
  endFrame: number
}

export interface SortedFrameRenderWindow<T> {
  /** Entries whose diamonds/markers are inside the viewport. */
  visible: ReadonlyArray<T>
  /** Visible entries plus one neighbour per side for crossing connectors. */
  connected: ReadonlyArray<T>
}

function lowerBound<T extends { frame: number }>(entries: ReadonlyArray<T>, frame: number): number {
  let low = 0
  let high = entries.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (entries[middle]!.frame < frame) low = middle + 1
    else high = middle
  }
  return low
}

function upperBound<T extends { frame: number }>(entries: ReadonlyArray<T>, frame: number): number {
  let low = 0
  let high = entries.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (entries[middle]!.frame <= frame) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * Binary-slice a sorted keyframe lane to the visible time window.
 *
 * A predecessor and successor are retained for connector/easing spans. That
 * keeps a long interpolation visible even when neither endpoint is on screen,
 * while bounding mounted diamonds and row work for generated 10k+ key lanes.
 */
export function getSortedFrameRenderWindow<T extends { frame: number }>(
  entries: ReadonlyArray<T>,
  viewport: FrameRenderViewport,
): SortedFrameRenderWindow<T> {
  if (entries.length === 0) return { visible: entries, connected: entries }

  const startFrame = Math.min(viewport.startFrame, viewport.endFrame)
  const endFrame = Math.max(viewport.startFrame, viewport.endFrame)
  const visibleStart = lowerBound(entries, startFrame)
  const visibleEnd = upperBound(entries, endFrame)
  const connectedStart = Math.max(0, visibleStart - 1)
  const connectedEnd = Math.min(entries.length, visibleEnd + 1)

  return {
    visible:
      visibleStart === 0 && visibleEnd === entries.length
        ? entries
        : entries.slice(visibleStart, visibleEnd),
    connected:
      connectedStart === 0 && connectedEnd === entries.length
        ? entries
        : entries.slice(connectedStart, connectedEnd),
  }
}
