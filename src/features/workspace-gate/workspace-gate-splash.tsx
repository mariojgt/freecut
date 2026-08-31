import { useRef, type ChangeEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  FolderOpen,
  FolderX,
  Loader2,
  RefreshCw,
  AlertTriangle,
  BookOpen,
  Cable,
  HardDrive,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FreeCutLogo } from '@/components/brand/freecut-logo'
import type { WorkspaceFolderImportProgress } from '@/infrastructure/storage/folder-workspace-import'

type Status =
  | { kind: 'initializing' }
  | { kind: 'unavailable' }
  | { kind: 'browser-storage' }
  | { kind: 'pick' }
  | { kind: 'reconnect'; handleName: string }

interface Props {
  status: Status
  error?: string | null
  onPickFolder: () => void
  onUseBrowserStorage: () => void
  canImportFolder: boolean
  folderImportProgress: WorkspaceFolderImportProgress | null
  onImportFolder: (files: File[]) => void
  onReconnect: () => void
}

export function WorkspaceGateSplash({
  status,
  error,
  onPickFolder,
  onUseBrowserStorage,
  canImportFolder,
  folderImportProgress,
  onImportFolder,
  onReconnect,
}: Props) {
  const { t } = useTranslation()
  const folderInputRef = useRef<HTMLInputElement>(null)
  const folderInputAttributes = { webkitdirectory: '' }

  const handleFolderSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    onImportFolder(files)
  }

  const isImportingFolder = folderImportProgress !== null
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-lg w-full text-center">
        <FreeCutLogo variant="full" size="lg" className="justify-center mb-8" />

        {error && (
          <div className="mb-5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-left text-sm text-destructive flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {status.kind === 'initializing' && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
          </div>
        )}

        {status.kind === 'unavailable' && (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2 text-destructive">
              <FolderX className="h-5 w-5" />
              <span className="font-medium">{t('projects.workspaceGate.unsupportedBrowser')}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('projects.workspaceGate.unsupportedBrowserDescription')}
            </p>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <a href="/docs/workspaces">
                <BookOpen className="h-4 w-4" />
                {t('projects.workspaceGate.workspaceGuide')}
              </a>
            </Button>
          </div>
        )}

        {status.kind === 'browser-storage' && (
          <div className="space-y-5">
            <div>
              <div className="mb-3 flex items-center justify-center gap-2 text-foreground">
                <HardDrive className="h-5 w-5" />
                <h1 className="text-2xl font-semibold">
                  {t('projects.workspaceGate.browserStorageTitle')}
                </h1>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('projects.workspaceGate.browserStorageDescription')}
              </p>
            </div>
            <div className="flex flex-col items-center justify-center gap-2 sm:flex-row sm:flex-wrap">
              <Button
                size="lg"
                className="gap-2"
                onClick={onUseBrowserStorage}
                disabled={isImportingFolder}
              >
                <HardDrive className="h-4 w-4" />
                {t('projects.workspaceGate.useBrowserStorage')}
              </Button>
              {canImportFolder && (
                <Button
                  variant="outline"
                  size="lg"
                  className="gap-2"
                  onClick={() => folderInputRef.current?.click()}
                  disabled={isImportingFolder}
                >
                  {isImportingFolder ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {folderImportProgress
                    ? t('projects.workspaceGate.importingFolder', {
                        current: folderImportProgress.completedFiles,
                        total: folderImportProgress.totalFiles,
                      })
                    : t('projects.workspaceGate.importFolder')}
                </Button>
              )}
              <Button asChild variant="outline" size="lg" className="gap-2">
                <a href="/docs/workspaces">
                  <BookOpen className="h-4 w-4" />
                  {t('projects.workspaceGate.workspaceGuide')}
                </a>
              </Button>
            </div>
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
            <p className="text-xs text-muted-foreground">
              {t('projects.workspaceGate.browserStorageTip')}
            </p>
          </div>
        )}

        {status.kind === 'pick' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-semibold mb-2">
                {t('projects.workspaceGate.pickTitle')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('projects.workspaceGate.pickDescription')}
              </p>
            </div>
            <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Button size="lg" className="gap-2" onClick={onPickFolder}>
                <FolderOpen className="h-4 w-4" />
                {t('projects.workspaceGate.chooseFolder')}
              </Button>
              <Button asChild variant="outline" size="lg" className="gap-2">
                <a href="/docs/workspaces">
                  <BookOpen className="h-4 w-4" />
                  {t('projects.workspaceGate.workspaceGuide')}
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('projects.workspaceGate.pickTip')}</p>
          </div>
        )}

        {status.kind === 'reconnect' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-semibold mb-2">
                {t('projects.workspaceGate.reconnectTitle')}
              </h1>
              <p className="text-sm text-muted-foreground">
                <Trans
                  i18nKey="projects.workspaceGate.reconnectDescription"
                  values={{ name: status.handleName }}
                  components={{ code: <span className="font-mono" /> }}
                />
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="lg" className="gap-2" onClick={onPickFolder}>
                <FolderOpen className="h-4 w-4" />
                {t('projects.workspaceGate.chooseDifferentFolder')}
              </Button>
              <Button size="lg" className="gap-2" onClick={onReconnect}>
                <RefreshCw className="h-4 w-4" />
                {t('projects.workspaceGate.reconnect')}
              </Button>
            </div>
            <Button asChild variant="ghost" size="sm" className="gap-2">
              <a href="/docs/workspaces">
                <BookOpen className="h-4 w-4" />
                {t('projects.workspaceGate.workspaceGuide')}
              </a>
            </Button>
          </div>
        )}

        <Button asChild variant="ghost" size="sm" className="mt-6 gap-2">
          <a href="/mcp">
            <Cable className="h-4 w-4" />
            {t('editor.agent.mcp.openSetup')}
          </a>
        </Button>
      </div>
    </div>
  )
}
