import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Download, Pencil, Trash2, Upload } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { createLogger } from '@/shared/logging/logger'
import { usePlaybackStore } from '@/shared/state/playback'
import { useProjectStore } from '@/features/editor/deps/projects'
import {
  useCompositionNavigationStore,
  useCompositionsStore,
  useTimelineStore,
  insertBlock,
} from '@/features/editor/deps/timeline-store'
import { getDefaultGeneratedLayerDurationInFrames } from '@/features/editor/deps/timeline-utils'
import { resolveGeneratedLayerCanvasSize } from '../utils/generated-layer-canvas-size'
import { getGesture, listBlocks } from '@/shared/graphics/blocks/registry'
import { DEEP_SPACE_PALETTE, resolvePaletteRole } from '@/shared/graphics/blocks/scene-palette'
import type { BlockDefinition } from '@/shared/graphics/blocks/types'
import type { ProjectBlock } from '@/types/project'
import {
  availableBlockId,
  blockFileName,
  parseBlockFile,
  serializeBlockFile,
} from '@/shared/graphics/blocks/block-file'
import { BlockRigEditor } from './block-rig-editor'

const logger = createLogger('BlockLibraryPanel')

/**
 * Rigged block browser.
 *
 * Thumbnails are drawn from each block's own committed path data rather than
 * shipped images, so a preview can never drift from the artwork it advertises.
 */

interface BlockThumbnailProps {
  block: BlockDefinition
  partIds?: readonly string[]
}

function BlockThumbnail({ block, partIds }: BlockThumbnailProps) {
  const parts = useMemo(() => {
    const visible = partIds?.length
      ? block.parts.filter((part) => partIds.includes(part.id))
      : block.parts
    return [...visible].sort((a, b) => a.z - b.z)
  }, [block, partIds])

  return (
    <svg
      viewBox={`0 0 ${block.width} ${block.height}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {parts.map((part) => (
        <path
          key={part.id}
          d={part.d}
          fill={part.fill ? resolvePaletteRole(DEEP_SPACE_PALETTE, part.fill) : 'none'}
          stroke={part.stroke ? resolvePaletteRole(DEEP_SPACE_PALETTE, part.stroke) : undefined}
          strokeWidth={part.stroke ? (part.strokeWidth ?? 1) : undefined}
        />
      ))}
    </svg>
  )
}

export function BlockLibraryPanel() {
  const { t } = useTranslation()
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null)
  const blocks = useMemo(() => listBlocks(), [])
  // Subscribed, unlike the stores read inside the insert handler: this list
  // changes while the panel is open, when a rig is defined or removed.
  const projectBlocks = useProjectStore((state) => state.currentProject?.blocks)
  const projectId = useProjectStore((state) => state.currentProject?.id)

  const [editing, setEditing] = useState<ProjectBlock | null>(null)

  const writeBlocks = useCallback(
    async (next: ProjectBlock[]) => {
      if (!projectId) return
      try {
        await useProjectStore.getState().setProjectBlocks(projectId, next)
      } catch (error) {
        logger.warn('Could not save project blocks', { error })
      }
    },
    [projectId],
  )

  const exportBlock = useCallback((entry: ProjectBlock) => {
    const blob = new Blob([serializeBlockFile(entry)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = blockFileName(entry.definition)
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }, [])

  const importBlock = useCallback(
    async (file: File) => {
      const owned = useProjectStore.getState().currentProject?.blocks ?? []
      try {
        const parsed = parseBlockFile(await file.text())
        // Importing the same rig twice is normal — a variant built from the
        // first — so a collision takes a new id rather than replacing.
        const id = availableBlockId(
          parsed.definition.id,
          new Set(owned.map((entry) => entry.definition.id)),
        )
        await writeBlocks([...owned, { ...parsed, definition: { ...parsed.definition, id } }])
      } catch (error) {
        logger.warn('Could not import block', {
          fileName: file.name,
          error: error instanceof Error ? error.message : error,
        })
      }
    },
    [writeBlocks],
  )

  const saveEditedBlock = useCallback(
    async (definition: BlockDefinition) => {
      const owned = useProjectStore.getState().currentProject?.blocks ?? []
      await writeBlocks(
        owned.map((entry) =>
          entry.definition.id === definition.id
            ? { ...entry, definition, updatedAt: Date.now() }
            : entry,
        ),
      )
      setEditing(null)
    },
    [writeBlocks],
  )

  const removeProjectBlock = useCallback(
    async (blockId: string) => {
      if (!projectId) return
      const remaining = (useProjectStore.getState().currentProject?.blocks ?? []).filter(
        (entry) => entry.definition.id !== blockId,
      )
      try {
        await useProjectStore.getState().setProjectBlocks(projectId, remaining)
      } catch (error) {
        logger.warn('Could not remove project block', { blockId, error })
      }
    },
    [projectId],
  )

  const addBlock = useCallback((block: BlockDefinition, partIds?: readonly string[]) => {
    // Read from stores directly rather than subscribing: this panel re-renders
    // on hover and does not need to track playback or composition state.
    const { fps } = useTimelineStore.getState()
    const currentProject = useProjectStore.getState().currentProject
    const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId
    const activeComposition = activeCompositionId
      ? useCompositionsStore.getState().getComposition(activeCompositionId)
      : undefined
    const { width: canvasWidth, height: canvasHeight } = resolveGeneratedLayerCanvasSize(
      activeComposition,
      currentProject?.metadata,
    )
    const durationInFrames = getDefaultGeneratedLayerDurationInFrames(fps)

    // A whole block arrives already performing; a hand-picked subset does not,
    // because its gesture may drive parts the user chose to leave out.
    const gestures = partIds?.length
      ? []
      : (block.gestures ?? [])
          .map((id) => getGesture(id))
          .filter((gesture) => gesture !== undefined)
          .filter((gesture) => gesture.loop)
          .map((gesture) => ({
            gesture,
            // One walk cycle per second reads naturally at any frame rate.
            ...(gesture.id === 'walk' && {
              cycles: Math.max(1, Math.round(durationInFrames / fps)),
            }),
          }))

    const result = insertBlock({
      block,
      palette: DEEP_SPACE_PALETTE,
      from: Math.max(0, usePlaybackStore.getState().currentFrame),
      durationInFrames,
      canvasWidth,
      canvasHeight,
      fps,
      gestures,
      ...(partIds?.length ? { partIds } : {}),
    })

    if (!result) {
      logger.warn('Block produced no items', { blockId: block.id })
      return
    }
    if (result.skipped.length > 0) {
      logger.warn('Some block parts were skipped', {
        blockId: block.id,
        skipped: result.skipped,
      })
    }
  }, [])

  return (
    <div className="space-y-2">
      {projectId && (
        <div className="flex items-center justify-between gap-2 px-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('editor.blockLibrary.projectTitle')}
          </span>
          <label className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground">
            <Upload className="h-3 w-3" />
            {t('editor.blockLibrary.import')}
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                // Cleared so choosing the same file twice still fires a change.
                event.target.value = ''
                if (file) void importBlock(file)
              }}
            />
          </label>
        </div>
      )}

      {projectBlocks && projectBlocks.length > 0 && (
        <>
          {projectBlocks.map((entry) => (
            <div
              key={entry.definition.id}
              className="rounded-lg border border-primary/30 bg-secondary/20"
            >
              <div className="flex items-stretch gap-2 p-2">
                <button
                  type="button"
                  onClick={() => addBlock(entry.definition)}
                  title={t('editor.blockLibrary.insert', { name: entry.definition.name })}
                  className="flex flex-1 items-center gap-2 rounded-md p-1 text-left transition-[transform,background-color] duration-150 hover:bg-secondary/60 active:scale-[0.98]"
                >
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-border bg-background/60">
                    <BlockThumbnail block={entry.definition} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[11px] text-foreground">
                      {entry.definition.name}
                    </div>
                    <div className="truncate text-[9px] text-muted-foreground">
                      {t('editor.blockLibrary.partCount', {
                        count: entry.definition.parts.length,
                      })}
                    </div>
                  </div>
                </button>

                <div className="flex shrink-0 flex-col justify-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setEditing(entry)}
                    aria-label={t('editor.blockLibrary.edit', { name: entry.definition.name })}
                    title={t('editor.blockLibrary.edit', { name: entry.definition.name })}
                    className="flex h-6 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => exportBlock(entry)}
                    aria-label={t('editor.blockLibrary.export', { name: entry.definition.name })}
                    title={t('editor.blockLibrary.export', { name: entry.definition.name })}
                    className="flex h-6 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                  >
                    <Download className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeProjectBlock(entry.definition.id)}
                    aria-label={t('editor.blockLibrary.remove', { name: entry.definition.name })}
                    title={t('editor.blockLibrary.remove', { name: entry.definition.name })}
                    className="flex h-6 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      <div className="px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('editor.blockLibrary.title')}
      </div>

      <BlockRigEditor
        entry={editing}
        onClose={() => setEditing(null)}
        onSave={(definition) => void saveEditedBlock(definition)}
      />

      {blocks.map((block) => {
        const expanded = expandedBlockId === block.id
        return (
          <div key={block.id} className="rounded-lg border border-border bg-secondary/20">
            <div className="flex items-stretch gap-2 p-2">
              <button
                type="button"
                onClick={() => addBlock(block)}
                title={t('editor.blockLibrary.insert', { name: block.name })}
                className="flex flex-1 items-center gap-2 rounded-md p-1 text-left transition-[transform,background-color] duration-150 hover:bg-secondary/60 active:scale-[0.98]"
              >
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-border bg-background/60">
                  <BlockThumbnail block={block} />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[11px] text-foreground">{block.name}</div>
                  <div className="truncate text-[9px] text-muted-foreground">
                    {t('editor.blockLibrary.partCount', { count: block.parts.length })}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setExpandedBlockId(expanded ? null : block.id)}
                aria-expanded={expanded}
                aria-label={t('editor.blockLibrary.showParts', { name: block.name })}
                className="flex w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    'h-3.5 w-3.5 transition-transform duration-150',
                    expanded && 'rotate-90',
                  )}
                />
              </button>
            </div>

            {expanded && (
              <div className="grid grid-cols-4 gap-1 border-t border-border p-2">
                {[...block.parts]
                  .sort((a, b) => a.z - b.z)
                  .map((part) => (
                    <button
                      key={part.id}
                      type="button"
                      onClick={() => addBlock(block, [part.id])}
                      title={t('editor.blockLibrary.insert', { name: part.label })}
                      className="flex flex-col items-center gap-0.5 rounded border border-border bg-background/40 p-1 transition-[transform,border-color] duration-150 hover:border-primary/50 active:scale-[0.98]"
                    >
                      <div className="h-7 w-7">
                        <BlockThumbnail block={block} partIds={[part.id]} />
                      </div>
                      <span className="w-full truncate text-center text-[8px] text-muted-foreground">
                        {part.label}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
