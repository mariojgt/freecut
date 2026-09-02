import type { SvgImportWarning } from '@/shared/graphics/shapes/svg-document-import'
import { importSvgSource } from '@/shared/graphics/shapes/svg-document-import'
import { instantiateSvgLayers } from '@/shared/graphics/shapes/instantiate-svg'
import { useItemsStore } from '../items-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { execute } from './shared'

export interface ImportSvgLayersParams {
  source: string
  name: string
  from: number
  durationInFrames: number
  canvasWidth: number
  canvasHeight: number
  fitRatio?: number
  x?: number
  y?: number
  /** Deterministic override for tests and headless callers. */
  idPrefix?: string
}

export interface ImportSvgLayersResult {
  itemIds: string[]
  trackIds: string[]
  groupTrackId: string
  warnings: SvgImportWarning[]
  viewBox: { minX: number; minY: number; width: number; height: number }
}

function safeIdStem(name: string): string {
  const stem = name
    .replace(/\.svg$/i, '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return stem || 'svg'
}

function nextTopOrder(trackCount: number): number {
  const orders = useItemsStore.getState().tracks.map((track) => track.order)
  return Math.min(0, ...orders) - trackCount - 1
}

/**
 * Import SVG artwork as editable path layers in one undoable transaction.
 *
 * Parsing and complexity checks finish before `execute`, so a malformed or
 * impractically detailed file leaves the timeline completely untouched.
 */
export function importSvgLayers(params: ImportSvgLayersParams): ImportSvgLayersResult {
  if (params.durationInFrames <= 0) throw new Error('SVG layer duration must be positive.')
  if (params.canvasWidth <= 0 || params.canvasHeight <= 0) {
    throw new Error('SVG import needs a positive canvas size.')
  }

  const idPrefix =
    params.idPrefix ?? `${safeIdStem(params.name)}-${crypto.randomUUID().slice(0, 8)}`
  const document = importSvgSource(params.source, { idPrefix })
  const instantiated = instantiateSvgLayers(document, {
    name: params.name.replace(/\.svg$/i, '') || 'Imported SVG',
    idPrefix,
    from: Math.max(0, Math.round(params.from)),
    durationInFrames: Math.max(1, Math.round(params.durationInFrames)),
    baseTrackOrder: nextTopOrder(document.paths.length),
    canvasWidth: params.canvasWidth,
    canvasHeight: params.canvasHeight,
    ...(params.fitRatio !== undefined && { fitRatio: params.fitRatio }),
    ...(params.x !== undefined && { x: params.x }),
    ...(params.y !== undefined && { y: params.y }),
  })

  const itemIds = instantiated.items.map((item) => item.id)
  const trackIds = instantiated.tracks.map((track) => track.id)
  const current = useItemsStore.getState()
  const occupiedIds = new Set([
    ...current.items.map((item) => item.id),
    ...current.tracks.map((track) => track.id),
  ])
  const collision = [...itemIds, ...trackIds].find((id) => occupiedIds.has(id))
  if (collision) throw new Error(`SVG import id collision: ${collision}`)

  return execute(
    'IMPORT_SVG_LAYERS',
    () => {
      const itemsState = useItemsStore.getState()
      itemsState.setTracks([...itemsState.tracks, ...instantiated.tracks])
      itemsState._addItems(instantiated.items)
      useTimelineSettingsStore.getState().markDirty()
      return {
        itemIds,
        trackIds,
        groupTrackId: instantiated.groupTrackId,
        warnings: instantiated.warnings,
        viewBox: document.viewBox,
      }
    },
    { paths: itemIds.length, warnings: instantiated.warnings.length },
  )
}
