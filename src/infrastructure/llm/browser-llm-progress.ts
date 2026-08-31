export interface TransformersProgressInfo {
  status?: string
  progress?: number
  loaded?: number
  total?: number
}

export interface BrowserLlmProgressSnapshot {
  percent: number
  loadedBytes: number
  totalBytes: number
}

/** Converts Transformers.js aggregate file progress into stable UI progress. */
export class BrowserLlmProgressTracker {
  private lastPercent = 5
  private lastLoadedBytes = 0

  update(info: TransformersProgressInfo): BrowserLlmProgressSnapshot | null {
    // Transformers.js also emits progress for each individual file. Those
    // values reset at every file boundary, so only the aggregate event can
    // drive a truthful whole-model progress bar.
    if (info.status !== 'progress_total' || !info.total) return null

    const loadedBytes = info.loaded ?? 0
    const fraction = Math.min(1, Math.max(0, loadedBytes / info.total))
    const percent = Math.round(5 + fraction * 90)
    const bytesMoved = loadedBytes - this.lastLoadedBytes >= 1_000_000
    if (percent <= this.lastPercent && !bytesMoved && loadedBytes < info.total) return null

    this.lastPercent = Math.max(this.lastPercent, percent)
    this.lastLoadedBytes = loadedBytes
    return {
      percent: this.lastPercent,
      loadedBytes,
      totalBytes: info.total,
    }
  }
}
