// @vitest-environment node

import { File as NodeFile } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import './test-utils/logger-test-mocks'
import {
  importWorkspaceFolderToOpfs,
  WorkspaceFolderImportError,
  type WorkspaceFolderImportProgress,
} from './folder-workspace-import'
import {
  asHandle,
  createRoot,
  readFileText,
  type MemDir,
} from './workspace-fs/__tests__/in-memory-handle'

function workspaceFile(path: string, contents: string): File {
  const name = path.split('/').at(-1) ?? 'file.bin'
  const file = new NodeFile([contents], name, { type: 'application/octet-stream' })
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file as unknown as File
}

function installOpfs(root: ReturnType<typeof createRoot>): void {
  vi.stubGlobal('navigator', {
    storage: {
      persist: vi.fn(async () => true),
      getDirectory: vi.fn(async () => asHandle(root)),
    },
  })
}

async function listEntries(root: ReturnType<typeof createRoot>) {
  const entries: Array<{ name: string; kind: 'file' | 'directory' }> = []
  for await (const entry of root.values()) entries.push(entry)
  return entries
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('folder workspace import', () => {
  it('copies a selected directory tree into a new private workspace', async () => {
    const opfsRoot = createRoot('opfs')
    installOpfs(opfsRoot)
    const progress: WorkspaceFolderImportProgress[] = []

    const result = await importWorkspaceFolderToOpfs(
      [
        workspaceFile('My Edit/index.json', '{"projects":[]}'),
        workspaceFile('My Edit/projects/project-1/project.json', '{"name":"Demo"}'),
      ],
      (next) => progress.push(next),
    )

    const importedRoot = result.handle as unknown as MemDir
    expect(result.sourceFolderName).toBe('My Edit')
    expect(result.filesCopied).toBe(2)
    expect(await readFileText(importedRoot, 'index.json')).toBe('{"projects":[]}')
    expect(await readFileText(importedRoot, 'projects', 'project-1', 'project.json')).toBe(
      '{"name":"Demo"}',
    )
    expect(progress.at(-1)).toMatchObject({ completedFiles: 2, totalFiles: 2 })
  })

  it('rejects an empty or unsafe selection before creating a workspace', async () => {
    const opfsRoot = createRoot('opfs')
    installOpfs(opfsRoot)

    await expect(importWorkspaceFolderToOpfs([])).rejects.toMatchObject({
      code: 'empty-selection',
    })
    await expect(
      importWorkspaceFolderToOpfs([workspaceFile('My Edit/../outside.json', 'nope')]),
    ).rejects.toMatchObject({ code: 'invalid-selection' })

    await expect(listEntries(opfsRoot)).resolves.toEqual([])
  })

  it('removes a partial private copy when writing fails', async () => {
    const opfsRoot = createRoot('opfs')
    installOpfs(opfsRoot)
    const broken = {
      name: 'broken.bin',
      size: 1,
      webkitRelativePath: 'My Edit/broken.bin',
      arrayBuffer: async () => {
        throw new Error('read failed')
      },
    } as unknown as File

    await expect(importWorkspaceFolderToOpfs([broken])).rejects.toBeInstanceOf(
      WorkspaceFolderImportError,
    )
    await expect(listEntries(opfsRoot)).resolves.toEqual([])
  })
})
