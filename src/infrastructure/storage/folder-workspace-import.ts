import { writeBlob } from './workspace-fs/fs-primitives'

const IMPORT_DIRECTORY_PREFIX = 'FreeCut Imported Workspace'

export type WorkspaceFolderImportErrorCode =
  | 'unavailable'
  | 'empty-selection'
  | 'invalid-selection'
  | 'copy-failed'

export class WorkspaceFolderImportError extends Error {
  constructor(
    public readonly code: WorkspaceFolderImportErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message)
    this.name = 'WorkspaceFolderImportError'
    this.cause = cause
  }
}

export interface WorkspaceFolderImportProgress {
  completedFiles: number
  totalFiles: number
  completedBytes: number
  totalBytes: number
}

export interface ImportedWorkspaceFolder {
  handle: FileSystemDirectoryHandle
  sourceFolderName: string
  filesCopied: number
  bytesCopied: number
}

interface SelectedWorkspaceFile {
  file: File
  folderName: string
  path: string[]
}

interface NormalizedWorkspaceSelection {
  folderName: string
  files: SelectedWorkspaceFile[]
  totalBytes: number
}

function validPathSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== '.' &&
    segment !== '..' &&
    !segment.includes('/') &&
    !segment.includes('\\') &&
    !segment.includes('\0')
  )
}

function invalidSelection(message: string): never {
  throw new WorkspaceFolderImportError('invalid-selection', message)
}

function assertValidPath(segments: string[], relativePath: string): void {
  if (segments.some((segment) => !validPathSegment(segment))) {
    invalidSelection(`The selected folder contains an invalid path: ${relativePath}`)
  }
}

function selectedFilePath(file: File): { browserRelativePath: string; relativePath: string } {
  const browserRelativePath = file.webkitRelativePath ?? ''
  return {
    browserRelativePath,
    relativePath: browserRelativePath.length > 0 ? browserRelativePath : file.name,
  }
}

function splitFolderPrefix(
  browserRelativePath: string,
  segments: string[],
): { folderName: string; path: string[] } {
  if (browserRelativePath.length === 0 || segments.length === 1) {
    return { folderName: 'Imported workspace', path: segments }
  }
  return { folderName: segments[0]!, path: segments.slice(1) }
}

function parseSelectedFile(file: File): SelectedWorkspaceFile {
  const { browserRelativePath, relativePath } = selectedFilePath(file)
  const segments = relativePath.split('/')
  assertValidPath(segments, relativePath)
  const { folderName, path } = splitFolderPrefix(browserRelativePath, segments)
  assertValidPath(path, relativePath)

  return { file, folderName, path }
}

function validateSingleFolder(files: SelectedWorkspaceFile[]): string {
  const folderName = files[0]!.folderName
  for (const entry of files) {
    if (entry.folderName !== folderName) {
      invalidSelection('Select one workspace folder at a time.')
    }
  }
  return folderName
}

function validateUniquePaths(files: SelectedWorkspaceFile[]): void {
  const seenPaths = new Set<string>()
  for (const entry of files) {
    const pathKey = entry.path.join('/')
    if (seenPaths.has(pathKey)) {
      invalidSelection(`The selected folder contains a duplicate path: ${pathKey}`)
    }
    seenPaths.add(pathKey)
  }
}

function normalizeSelection(files: File[]): NormalizedWorkspaceSelection {
  if (files.length === 0) {
    throw new WorkspaceFolderImportError(
      'empty-selection',
      'The selected folder does not contain any files.',
    )
  }

  const normalized = files.map(parseSelectedFile)
  const folderName = validateSingleFolder(normalized)
  validateUniquePaths(normalized)

  return {
    folderName,
    files: normalized,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  }
}

export function isFolderInputSupported(): boolean {
  if (typeof document === 'undefined') return false
  return 'webkitdirectory' in document.createElement('input')
}

/**
 * Copy a folder-input selection into a brand-new OPFS directory.
 *
 * Folder inputs expose read-only File objects, not a durable writable handle.
 * Creating a unique destination makes the import safe: an interrupted or
 * failed copy is removed, and no existing browser workspace is overwritten.
 */
export async function importWorkspaceFolderToOpfs(
  files: File[],
  onProgress?: (progress: WorkspaceFolderImportProgress) => void,
): Promise<ImportedWorkspaceFolder> {
  const selection = normalizeSelection(files)
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
    throw new WorkspaceFolderImportError(
      'unavailable',
      'Browser-private file system storage is unavailable.',
    )
  }

  await navigator.storage.persist?.().catch(() => false)
  const opfsRoot = await navigator.storage.getDirectory()
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  const destinationName = `${IMPORT_DIRECTORY_PREFIX} ${suffix}`
  const destination = await opfsRoot.getDirectoryHandle(destinationName, { create: true })

  let completedFiles = 0
  let completedBytes = 0
  onProgress?.({
    completedFiles,
    totalFiles: selection.files.length,
    completedBytes,
    totalBytes: selection.totalBytes,
  })

  try {
    for (const entry of selection.files) {
      await writeBlob(destination, entry.path, entry.file)
      completedFiles++
      completedBytes += entry.file.size
      onProgress?.({
        completedFiles,
        totalFiles: selection.files.length,
        completedBytes,
        totalBytes: selection.totalBytes,
      })
    }
  } catch (error) {
    await opfsRoot.removeEntry(destinationName, { recursive: true }).catch(() => undefined)
    throw new WorkspaceFolderImportError(
      'copy-failed',
      'FreeCut could not copy the selected workspace into browser storage.',
      error,
    )
  }

  return {
    handle: destination,
    sourceFolderName: selection.folderName,
    filesCopied: completedFiles,
    bytesCopied: completedBytes,
  }
}
