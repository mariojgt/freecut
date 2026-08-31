import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { WorkspaceGateSplash } from './workspace-gate-splash'

vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({
    t: (key: string, values?: { current?: number; total?: number }) => {
      const messages: Record<string, string> = {
        'projects.workspaceGate.browserStorageTitle': 'Use browser storage',
        'projects.workspaceGate.browserStorageDescription': 'Choose how to begin.',
        'projects.workspaceGate.useBrowserStorage': 'Start empty workspace',
        'projects.workspaceGate.importFolder': 'Import workspace folder',
        'projects.workspaceGate.importingFolder': `Importing ${values?.current}/${values?.total} files…`,
        'projects.workspaceGate.workspaceGuide': 'Workspace guide',
        'projects.workspaceGate.browserStorageTip': 'Imported folders are copied.',
      }
      return messages[key] ?? key
    },
  }),
}))

const baseProps = {
  status: { kind: 'browser-storage' } as const,
  error: null,
  onPickFolder: vi.fn(),
  onUseBrowserStorage: vi.fn(),
  canImportFolder: true,
  folderImportProgress: null,
  onImportFolder: vi.fn(),
  onReconnect: vi.fn(),
}

describe('WorkspaceGateSplash Firefox folder import', () => {
  it('offers an empty workspace and a folder import', () => {
    render(<WorkspaceGateSplash {...baseProps} />)

    expect(screen.getByRole('button', { name: 'Start empty workspace' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Import workspace folder' })).toBeTruthy()
    expect(screen.getByLabelText('Import workspace folder').getAttribute('webkitdirectory')).toBe(
      '',
    )
    expect(screen.getByRole('link', { name: 'editor.agent.mcp.openSetup' })).toHaveAttribute(
      'href',
      '/mcp',
    )
  })

  it('passes every selected folder file to the importer and reports progress', () => {
    const onImportFolder = vi.fn()
    const { rerender } = render(
      <WorkspaceGateSplash {...baseProps} onImportFolder={onImportFolder} />,
    )
    const file = new File(['project'], 'project.json')

    fireEvent.change(screen.getByLabelText('Import workspace folder'), {
      target: { files: [file] },
    })
    expect(onImportFolder).toHaveBeenCalledWith([file])

    rerender(
      <WorkspaceGateSplash
        {...baseProps}
        onImportFolder={onImportFolder}
        folderImportProgress={{
          completedFiles: 1,
          totalFiles: 3,
          completedBytes: 7,
          totalBytes: 21,
        }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Importing 1/3 files…' })).toBeDisabled()
  })
})
