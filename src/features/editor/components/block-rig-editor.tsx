import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Crosshair, TriangleAlert } from 'lucide-react'
import type { ProjectBlock } from '@/types/project'
import type { BlockDefinition, BlockPart, PaletteRole } from '@/shared/graphics/blocks/types'
import { validateBlock } from '@/shared/graphics/blocks/registry'
import { DEEP_SPACE_PALETTE, resolvePaletteRole } from '@/shared/graphics/blocks/scene-palette'
import { cn } from '@/shared/ui/cn'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Rig editor for a project's own blocks.
 *
 * The two things that decide whether artwork behaves like a puppet are the
 * parent chain and the joints, and neither is guessable from the drawing — an
 * arm has to know it hangs off a torso, and it has to turn at the shoulder
 * rather than at the middle of its own bounding box.
 *
 * So the editor is built around exactly those: pick a part, pick its parent,
 * click where its joint is. Everything else is renaming and colour.
 */

const PALETTE_ROLES: PaletteRole[] = [
  'ink',
  'inkMuted',
  'surface',
  'surfaceDeep',
  'primary',
  'secondary',
  'accent',
  'highlight',
  'glow',
  'shadow',
]

interface BlockRigEditorProps {
  entry: ProjectBlock | null
  onClose: () => void
  onSave: (definition: BlockDefinition) => void
}

/** Parts that may parent `partId` without closing a loop. */
function legalParents(parts: readonly BlockPart[], partId: string): BlockPart[] {
  const childrenOf = (id: string): string[] =>
    parts.filter((part) => part.parent === id).map((part) => part.id)

  const descendants = new Set<string>()
  const walk = (id: string): void => {
    for (const child of childrenOf(id)) {
      if (descendants.has(child)) continue
      descendants.add(child)
      walk(child)
    }
  }
  walk(partId)
  return parts.filter((part) => part.id !== partId && !descendants.has(part.id))
}

export function BlockRigEditor({ entry, onClose, onSave }: BlockRigEditorProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<BlockDefinition | null>(null)
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null)
  const [placingPivot, setPlacingPivot] = useState(false)

  // Re-seeded whenever a different block is opened, so an abandoned edit never
  // leaks into the next one.
  useEffect(() => {
    setDraft(entry ? structuredClone(entry.definition) : null)
    setSelectedPartId(entry?.definition.parts[0]?.id ?? null)
    setPlacingPivot(false)
  }, [entry])

  const issues = useMemo(() => (draft ? validateBlock(draft) : []), [draft])
  const selected = draft?.parts.find((part) => part.id === selectedPartId) ?? null

  const patchPart = useCallback(
    (partId: string, patch: Partial<BlockPart>) => {
      setDraft((current) =>
        current
          ? {
              ...current,
              parts: current.parts.map((part) =>
                part.id === partId ? { ...part, ...patch } : part,
              ),
            }
          : current,
      )
    },
    [setDraft],
  )

  /** Click-to-place, in the block's own coordinates rather than screen pixels. */
  const placePivotAt = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (!placingPivot || !draft || !selectedPartId) return
      const rect = event.currentTarget.getBoundingClientRect()
      // The preview letterboxes, so the drawn area is the smaller of the two fits.
      const scale = Math.min(rect.width / draft.width, rect.height / draft.height)
      const offsetX = (rect.width - draft.width * scale) / 2
      const offsetY = (rect.height - draft.height * scale) / 2
      const x = (event.clientX - rect.left - offsetX) / scale
      const y = (event.clientY - rect.top - offsetY) / scale
      patchPart(selectedPartId, {
        pivot: [Math.round(x * 10) / 10, Math.round(y * 10) / 10],
      })
      setPlacingPivot(false)
    },
    [placingPivot, draft, selectedPartId, patchPart],
  )

  if (!entry || !draft) return null

  const ordered = [...draft.parts].sort((a, b) => a.z - b.z)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('editor.rigEditor.title', { name: entry.definition.name })}</DialogTitle>
          <DialogDescription>{t('editor.rigEditor.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-4">
          <div className="space-y-2">
            <div
              className={cn(
                'relative aspect-square overflow-hidden rounded-md border border-border bg-background/60',
                placingPivot && 'cursor-crosshair ring-2 ring-primary',
              )}
            >
              <svg
                viewBox={`0 0 ${draft.width} ${draft.height}`}
                className="h-full w-full"
                preserveAspectRatio="xMidYMid meet"
                onClick={placePivotAt}
                role="presentation"
                data-rig-preview="true"
              >
                {ordered.map((part) => (
                  <path
                    key={part.id}
                    d={part.d}
                    fill={part.fill ? resolvePaletteRole(DEEP_SPACE_PALETTE, part.fill) : 'none'}
                    stroke={
                      part.id === selectedPartId
                        ? 'oklch(0.72 0.18 45)'
                        : part.stroke
                          ? resolvePaletteRole(DEEP_SPACE_PALETTE, part.stroke)
                          : undefined
                    }
                    strokeWidth={
                      part.id === selectedPartId
                        ? Math.max(draft.width, draft.height) / 180
                        : part.stroke
                          ? (part.strokeWidth ?? 1)
                          : undefined
                    }
                    opacity={part.opacity ?? 1}
                  />
                ))}
                {selected?.pivot && (
                  <g>
                    <circle
                      cx={selected.pivot[0]}
                      cy={selected.pivot[1]}
                      r={Math.max(draft.width, draft.height) / 90}
                      fill="oklch(0.72 0.18 45)"
                    />
                    <circle
                      cx={selected.pivot[0]}
                      cy={selected.pivot[1]}
                      r={Math.max(draft.width, draft.height) / 45}
                      fill="none"
                      stroke="oklch(0.72 0.18 45)"
                      strokeWidth={Math.max(draft.width, draft.height) / 300}
                    />
                  </g>
                )}
              </svg>
            </div>

            <div className="flex flex-wrap gap-1">
              {ordered.map((part) => (
                <button
                  key={part.id}
                  type="button"
                  onClick={() => setSelectedPartId(part.id)}
                  className={cn(
                    'rounded border px-1.5 py-0.5 text-[10px] transition-colors',
                    part.id === selectedPartId
                      ? 'border-primary bg-primary/15 text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {part.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 overflow-y-auto">
            <div className="space-y-1">
              <Label className="text-[10px]">{t('editor.rigEditor.blockName')}</Label>
              <Input
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
                className="h-7 text-xs"
              />
            </div>

            {selected && (
              <>
                <div className="space-y-1">
                  <Label className="text-[10px]">{t('editor.rigEditor.partLabel')}</Label>
                  <Input
                    value={selected.label}
                    onChange={(event) => patchPart(selected.id, { label: event.target.value })}
                    className="h-7 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px]">{t('editor.rigEditor.parent')}</Label>
                  <select
                    value={selected.parent ?? ''}
                    onChange={(event) =>
                      patchPart(selected.id, {
                        ...(event.target.value
                          ? { parent: event.target.value }
                          : { parent: undefined }),
                      })
                    }
                    className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs"
                  >
                    <option value="">{t('editor.rigEditor.noParent')}</option>
                    {legalParents(draft.parts, selected.id).map((part) => (
                      <option key={part.id} value={part.id}>
                        {part.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px]">{t('editor.rigEditor.fill')}</Label>
                  <select
                    value={selected.fill ?? ''}
                    onChange={(event) =>
                      patchPart(selected.id, {
                        ...(event.target.value
                          ? { fill: event.target.value as PaletteRole }
                          : { fill: undefined }),
                      })
                    }
                    className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs"
                  >
                    <option value="">{t('editor.rigEditor.noFill')}</option>
                    {PALETTE_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px]">{t('editor.rigEditor.pivot')}</Label>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={placingPivot ? 'default' : 'outline'}
                      onClick={() => setPlacingPivot((current) => !current)}
                      className="h-7 flex-1 gap-1 text-[11px]"
                    >
                      <Crosshair className="h-3 w-3" />
                      {placingPivot
                        ? t('editor.rigEditor.clickPreview')
                        : t('editor.rigEditor.setPivot')}
                    </Button>
                    {selected.pivot && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => patchPart(selected.id, { pivot: undefined })}
                        className="h-7 text-[11px]"
                      >
                        {t('editor.rigEditor.clearPivot')}
                      </Button>
                    )}
                  </div>
                  <p className="text-[9px] leading-tight text-muted-foreground">
                    {selected.pivot
                      ? `${selected.pivot[0]}, ${selected.pivot[1]}`
                      : t('editor.rigEditor.pivotHint')}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {issues.length > 0 && (
          <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-2">
            {issues.map((issue) => (
              <div
                key={`${issue.partId ?? ''}-${issue.message}`}
                className="flex items-start gap-1.5 text-[10px] text-destructive"
              >
                <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
                <span>
                  {issue.partId ? `${issue.partId}: ` : ''}
                  {issue.message}
                </span>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            // A rig that does not hold together cannot be saved: the same rule
            // the API applies, enforced where the mistake is being made.
            disabled={issues.length > 0}
            onClick={() => onSave(draft)}
          >
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
