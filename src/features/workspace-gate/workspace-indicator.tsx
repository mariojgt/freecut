/**
 * WorkspaceIndicator
 *
 * Lists every known workspace in a popover, marks the active one, and
 * exposes inline controls per workspace:
 *   - Switch       activate a different known workspace
 *   - Remove       forget the workspace (with inline Yes/Cancel confirm)
 *   - Add new…     pick another folder and set it as active
 *
 * All mutating actions reload the page so `WorkspaceGate` re-runs with
 * the new state. Reload is a sledgehammer but keeps the UX simple and
 * avoids plumbing a workspace-changed signal through every cached store.
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, FolderOpen, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/shared/ui/cn'
import { createLogger } from '@/shared/logging/logger'
import {
  activateWorkspaceHandle,
  getWorkspaceHandleRecord,
  isDirectoryPickerSupported,
  listKnownWorkspaces,
  queryHandlePermission,
  removeKnownWorkspace,
  requestHandlePermission,
  saveWorkspaceHandleRecord,
  type HandleRecord,
} from '@/infrastructure/storage/handles-db'
import {
  importWorkspaceFolderToOpfs,
  isFolderInputSupported,
  WorkspaceFolderImportError,
  type WorkspaceFolderImportProgress,
} from '@/infrastructure/storage/folder-workspace-import'

const logger = createLogger('WorkspaceIndicator')

interface WorkspaceEntry {
  record: HandleRecord
  isActive: boolean
}

function createFolderImportProgress(files: File[]): WorkspaceFolderImportProgress {
  return {
    completedFiles: 0,
    totalFiles: files.length,
    completedBytes: 0,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  }
}

function folderImportErrorKey(error: unknown): string {
  return error instanceof WorkspaceFolderImportError && error.code === 'empty-selection'
    ? 'projects.workspaceGate.folderImportEmpty'
    : 'projects.workspaceGate.folderImportFailed'
}

// Existing workspace lifecycle component; browser capability only gates its optional add control.
// fallow-ignore-next-line complexity
export function WorkspaceIndicator() {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null)
  const [activeName, setActiveName] = useState<string | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [folderImportProgress, setFolderImportProgress] =
    useState<WorkspaceFolderImportProgress | null>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const folderInputAttributes = { webkitdirectory: '' }
  const canPickDirectory = isDirectoryPickerSupported()
  const canImportFolder = !canPickDirectory && isFolderInputSupported()

  const loadEntries = useCallback(async () => {
    try {
      const [known, current] = await Promise.all([
        listKnownWorkspaces(),
        getWorkspaceHandleRecord(),
      ])
      const activeId = current?.activeWorkspaceId ?? null
      setActiveName(current?.name ?? null)
      setEntries(
        known.map((record) => ({
          record,
          isActive: record.id === activeId,
        })),
      )
    } catch (error) {
      logger.warn('Failed to load workspaces', error)
      setEntries([])
    }
  }, [])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  // Reset the per-row remove-confirm whenever the popover closes, so a
  // subsequent open always starts from the list view.
  useEffect(() => {
    if (!popoverOpen) setConfirmRemoveId(null)
  }, [popoverOpen])

  const handleAdd = useCallback(async () => {
    if (!isDirectoryPickerSupported()) return
    try {
      const handle = await window.showDirectoryPicker({
        id: 'freecut-workspace',
        mode: 'readwrite',
        startIn: 'documents',
      })
      const existing = await queryHandlePermission(handle)
      const granted = existing === 'granted' ? existing : await requestHandlePermission(handle)
      if (granted !== 'granted') return
      await saveWorkspaceHandleRecord(handle)
      window.location.reload()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      logger.error('Add workspace failed', error)
    }
  }, [])

  const handleSwitch = useCallback(async (workspaceId: string) => {
    try {
      const record = await activateWorkspaceHandle(workspaceId)
      if (!record) return
      // A previously-granted handle may have lost permission between sessions;
      // request again before reloading.
      const handle = record.handle as FileSystemDirectoryHandle
      const existing = await queryHandlePermission(handle)
      const granted = existing === 'granted' ? existing : await requestHandlePermission(handle)
      if (granted !== 'granted') {
        // Reload anyway so WorkspaceGate surfaces the reconnect splash.
      }
      window.location.reload()
    } catch (error) {
      logger.error(`Switch workspace failed (${workspaceId})`, error)
    }
  }, [])

  const importFolder = useCallback(
    async (files: File[]) => {
      setFolderImportProgress(createFolderImportProgress(files))
      try {
        const imported = await importWorkspaceFolderToOpfs(files, setFolderImportProgress)
        await saveWorkspaceHandleRecord(imported.handle, 'opfs', imported.sourceFolderName)
        window.location.reload()
      } catch (error) {
        logger.error('Import workspace folder failed', error)
        setFolderImportProgress(null)
        toast.error(t(folderImportErrorKey(error)))
      }
    },
    [t],
  )

  const handleFolderSelection = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? [])
      event.currentTarget.value = ''
      void importFolder(files)
    },
    [importFolder],
  )

  const handleRemove = useCallback(
    async (workspaceId: string, wasActive: boolean) => {
      try {
        await removeKnownWorkspace(workspaceId)
        if (wasActive) {
          window.location.reload()
          return
        }
        await loadEntries()
        setConfirmRemoveId(null)
      } catch (error) {
        logger.error(`Remove workspace failed (${workspaceId})`, error)
      }
    },
    [loadEntries],
  )

  // Don't render anything until we've finished loading.
  if (entries === null) return null
  // When there's no active workspace, the gate is on-screen instead.
  if (!activeName) return null

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="lg"
            className="gap-2 px-4 max-w-[220px]"
            data-tooltip={t('projects.workspaceIndicator.workspaceFolder')}
            data-tooltip-side="bottom"
            aria-haspopup="menu"
            aria-expanded={popoverOpen}
          >
            <FolderOpen className="w-4 h-4 shrink-0" />
            <span className="truncate">{activeName}</span>
            <ChevronDown
              className={cn(
                'w-4 h-4 shrink-0 text-muted-foreground transition-transform',
                popoverOpen && 'rotate-180',
              )}
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-2" align="end">
          <div className="text-xs font-medium text-muted-foreground px-2 py-1">
            {t('projects.workspaceIndicator.workspaces')}
          </div>

          <div className="flex flex-col">
            {entries.map(({ record, isActive }) => {
              const isConfirming = confirmRemoveId === record.id
              return (
                <div
                  key={record.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent"
                >
                  <FolderOpen className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-sm" title={record.name}>
                    {record.name}
                  </span>
                  {isActive && (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                      <Check className="w-3 h-3" /> {t('projects.workspaceIndicator.active')}
                    </span>
                  )}
                  {isConfirming ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setConfirmRemoveId(null)}
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => void handleRemove(record.id, isActive)}
                      >
                        {t('projects.workspaceIndicator.remove')}
                      </Button>
                    </>
                  ) : (
                    <>
                      {!isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => void handleSwitch(record.id)}
                        >
                          {t('projects.workspaceIndicator.switch')}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        aria-label={t('projects.workspaceIndicator.removeWorkspace')}
                        onClick={() => setConfirmRemoveId(record.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {(canPickDirectory || canImportFolder) && (
            <>
              <div className="h-px bg-border my-1" />
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() =>
                  canPickDirectory ? void handleAdd() : folderInputRef.current?.click()
                }
                disabled={folderImportProgress !== null}
              >
                {folderImportProgress ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : canPickDirectory ? (
                  <Plus className="w-4 h-4" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {folderImportProgress
                  ? t('projects.workspaceGate.importingFolder', {
                      current: folderImportProgress.completedFiles,
                      total: folderImportProgress.totalFiles,
                    })
                  : canPickDirectory
                    ? t('projects.workspaceIndicator.addWorkspace')
                    : t('projects.workspaceGate.importFolder')}
              </Button>
            </>
          )}
        </PopoverContent>
      </Popover>
      {canImportFolder && (
        <input
          {...folderInputAttributes}
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          aria-label={t('projects.workspaceGate.importFolder')}
          onChange={handleFolderSelection}
        />
      )}
    </>
  )
}
