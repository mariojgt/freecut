import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useProjectStore } from '@/features/editor/deps/projects'
import {
  importSvgLayers,
  useCompositionNavigationStore,
  useCompositionsStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import { getDefaultGeneratedLayerDurationInFrames } from '@/features/editor/deps/timeline-utils'
import { resolveGeneratedLayerCanvasSize } from '../utils/generated-layer-canvas-size'

/**
 * Imports vector artwork as real shape layers rather than as a flat image.
 * The hand-off to Motion is deliberate: the newly selected contours are ready
 * for staggered presets, path animation and dopesheet editing immediately.
 */
export function SvgLayerImportButton() {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const importFile = useCallback(
    async (file: File) => {
      setBusy(true)
      try {
        const source = await file.text()
        const { fps } = useTimelineStore.getState()
        const currentProject = useProjectStore.getState().currentProject
        const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId
        const activeComposition = activeCompositionId
          ? useCompositionsStore.getState().getComposition(activeCompositionId)
          : undefined
        const { width, height } = resolveGeneratedLayerCanvasSize(
          activeComposition,
          currentProject?.metadata,
        )

        const result = importSvgLayers({
          source,
          name: file.name,
          from: Math.max(0, usePlaybackStore.getState().currentFrame),
          durationInFrames: getDefaultGeneratedLayerDurationInFrames(fps),
          canvasWidth: width,
          canvasHeight: height,
        })

        const firstChildTrackId = result.trackIds.find((id) => id !== result.groupTrackId)
        const selection = useSelectionStore.getState()
        if (firstChildTrackId) selection.setActiveTrack(firstChildTrackId)
        selection.selectItems(result.itemIds)
        useEditorStore.getState().setClipInspectorTab('motion')

        if (result.warnings.length > 0) {
          toast.warning(
            t('editor.shapeSection.importSvgImportedWithWarnings', {
              count: result.itemIds.length,
              warnings: result.warnings.length,
            }),
            { description: result.warnings[0]?.reason },
          )
        } else {
          toast.success(
            t('editor.shapeSection.importSvgImported', { count: result.itemIds.length }),
          )
        }
      } catch (error) {
        toast.error(t('editor.shapeSection.importSvgError'), {
          description: error instanceof Error ? error.message : undefined,
        })
      } finally {
        setBusy(false)
      }
    },
    [t],
  )

  return (
    <div className="mb-3 rounded-lg border border-border bg-secondary/20 p-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/svg+xml,.svg"
        className="hidden"
        aria-label={t('editor.shapeSection.importSvgLayers')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Re-selecting the same file should still start a fresh import.
          event.target.value = ''
          if (file) void importFile(file)
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full justify-start gap-2 text-xs"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileUp className="h-3.5 w-3.5" />
        )}
        {t('editor.shapeSection.importSvgLayers')}
      </Button>
      <p className="mt-1.5 px-0.5 text-[9px] leading-snug text-muted-foreground">
        {t('editor.shapeSection.importSvgLayersHint')}
      </p>
    </div>
  )
}
