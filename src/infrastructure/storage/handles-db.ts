/**
 * Tiny dedicated IndexedDB for FileSystemHandle storage.
 *
 * The ONLY IndexedDB the app still uses after the workspace-fs refactor.
 * It exists because FileSystem*Handle can't serialize to disk files and
 * must live somewhere browser-native to survive reloads.
 *
 * Single store: `handles`, keyed by a compound id `{kind}:{id}`.
 * - Workspace root handle: kind='workspace', id='current'
 * - Media file handles (for storageType='handle' media): kind='media', id=mediaId
 *
 * Schema is v1 forever. Any future evolution creates a parallel DB, not
 * a version bump on this one — avoids the HMR corruption class entirely.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('HandlesDB')

const HANDLES_DB_NAME = 'freecut-handles-db'
const HANDLES_DB_VERSION = 1
const HANDLES_STORE = 'handles'

export type HandleKind = 'workspace' | 'media' | 'project-folder'
export type WorkspaceStorageKind = 'directory' | 'opfs'

export interface HandleRecord {
  /** Compound id: `${kind}:${id}`. */
  key: string
  kind: HandleKind
  id: string
  handle: FileSystemDirectoryHandle | FileSystemFileHandle
  name: string
  pickedAt: number
  /** For media handles only — drives the "missing file" re-link UX. */
  lastSeenPath?: string
  lastSeenSize?: number
  lastSeenMtime?: number
  /**
   * For the sentinel `workspace:current` record only — the stable id of the
   * known-workspace entry (`workspace:{uuid}`) that is currently active.
   * Lets the UI display the known-workspace list and mark the active one.
   */
  activeWorkspaceId?: string
  /**
   * `directory` is a user-visible folder selected with showDirectoryPicker.
   * `opfs` is the browser-private workspace used when that picker is absent
   * (notably Firefox). Older records omit this field and are directories.
   */
  workspaceStorageKind?: WorkspaceStorageKind
}

interface HandlesDBSchema extends DBSchema {
  handles: {
    key: string
    value: HandleRecord
    indexes: { kind: HandleKind }
  }
}

type HandlesDBInstance = IDBPDatabase<HandlesDBSchema>

let dbPromise: Promise<HandlesDBInstance> | null = null

function getHandlesDB(): Promise<HandlesDBInstance> {
  if (!dbPromise) {
    dbPromise = openDB<HandlesDBSchema>(HANDLES_DB_NAME, HANDLES_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(HANDLES_STORE)) {
          const store = db.createObjectStore(HANDLES_STORE, { keyPath: 'key' })
          store.createIndex('kind', 'kind', { unique: false })
        }
      },
      blocked() {
        logger.warn('Handles DB upgrade blocked — close other tabs.')
      },
      blocking() {
        logger.warn('This connection is blocking a handles DB upgrade.')
      },
    })
  }
  return dbPromise
}

function compoundKey(kind: HandleKind, id: string): string {
  return `${kind}:${id}`
}

export async function getHandle(kind: HandleKind, id: string): Promise<HandleRecord | null> {
  try {
    const db = await getHandlesDB()
    const record = await db.get(HANDLES_STORE, compoundKey(kind, id))
    return record ?? null
  } catch (error) {
    logger.error(`getHandle(${kind}, ${id}) failed`, error)
    return null
  }
}

export async function saveHandle(record: Omit<HandleRecord, 'key'>): Promise<void> {
  const db = await getHandlesDB()
  const full: HandleRecord = {
    ...record,
    key: compoundKey(record.kind, record.id),
  }
  await db.put(HANDLES_STORE, full)
}

export async function deleteHandle(kind: HandleKind, id: string): Promise<void> {
  const db = await getHandlesDB()
  await db.delete(HANDLES_STORE, compoundKey(kind, id))
}

async function listHandlesByKind(kind: HandleKind): Promise<HandleRecord[]> {
  const db = await getHandlesDB()
  return db.getAllFromIndex(HANDLES_STORE, 'kind', kind)
}

/* ───────────────────────────── Workspace shortcut ─────────────────────── */

/**
 * Workspaces are stored in two layers inside the `handles` store:
 *
 *  - `workspace:{uuid}` — one record per known workspace. Stable id across
 *    activations, survives remove/re-add. These are listed in the UI.
 *  - `workspace:current` — sentinel pointer to the active workspace. Its
 *    `activeWorkspaceId` references the real record above, and its
 *    `handle` / `name` mirror that record so existing consumers
 *    (`getWorkspaceHandleRecord`) keep working without changes.
 */
const WORKSPACE_ID = 'current'

export async function getWorkspaceHandleRecord(): Promise<HandleRecord | null> {
  return getHandle('workspace', WORKSPACE_ID)
}

/**
 * List the known workspaces (everything except the `current` sentinel),
 * most-recently-used first.
 */
export async function listKnownWorkspaces(): Promise<HandleRecord[]> {
  const all = await listHandlesByKind('workspace')
  return all.filter((r) => r.id !== WORKSPACE_ID).sort((a, b) => b.pickedAt - a.pickedAt)
}

async function findKnownWorkspaceByHandle(
  handle: FileSystemDirectoryHandle,
): Promise<HandleRecord | null> {
  const known = await listKnownWorkspaces()
  for (const record of known) {
    try {
      const candidate = record.handle as FileSystemDirectoryHandle
      if (await candidate.isSameEntry(handle)) return record
    } catch {
      // Stale handle — ignore.
    }
  }
  return null
}

/**
 * Save (or reuse) a known-workspace record for the picked folder, then
 * point `workspace:current` at it. Picking a folder already in the list
 * just refreshes its `pickedAt` and activates it.
 */
export async function saveWorkspaceHandleRecord(
  handle: FileSystemDirectoryHandle,
  workspaceStorageKind: WorkspaceStorageKind = 'directory',
  displayName: string = handle.name,
): Promise<void> {
  const existing = await findKnownWorkspaceByHandle(handle)
  const workspaceId = existing?.id ?? crypto.randomUUID()
  const pickedAt = Date.now()

  await saveHandle({
    kind: 'workspace',
    id: workspaceId,
    handle,
    name: displayName,
    pickedAt,
    workspaceStorageKind,
  })

  await saveHandle({
    kind: 'workspace',
    id: WORKSPACE_ID,
    handle,
    name: displayName,
    pickedAt,
    activeWorkspaceId: workspaceId,
    workspaceStorageKind,
  })
}

/**
 * Activate an already-known workspace. Caller is responsible for
 * verifying permission on the returned handle before using it.
 */
export async function activateWorkspaceHandle(workspaceId: string): Promise<HandleRecord | null> {
  const record = await getHandle('workspace', workspaceId)
  if (!record) return null

  await saveHandle({
    kind: 'workspace',
    id: WORKSPACE_ID,
    handle: record.handle,
    name: record.name,
    pickedAt: Date.now(),
    activeWorkspaceId: workspaceId,
    workspaceStorageKind: record.workspaceStorageKind,
  })
  return record
}

/**
 * Delete a known-workspace record. If it's the active one, also clear
 * the `current` pointer so `WorkspaceGate` reverts to pick-folder state.
 */
export async function removeKnownWorkspace(workspaceId: string): Promise<void> {
  await deleteHandle('workspace', workspaceId)
  const current = await getWorkspaceHandleRecord()
  if (current?.activeWorkspaceId === workspaceId) {
    await clearWorkspaceHandleRecord()
  }
}

async function clearWorkspaceHandleRecord(): Promise<void> {
  await deleteHandle('workspace', WORKSPACE_ID)
}

/**
 * One-shot migration for users whose `workspace:current` was written by
 * an older version of the app that didn't track known workspaces.
 *
 * If `current` exists with no `activeWorkspaceId`, create a backing
 * `workspace:{uuid}` record and rewrite `current` to reference it.
 * No-op once migrated or when no workspace is set.
 */
export async function ensureKnownWorkspaceForCurrent(): Promise<void> {
  const current = await getWorkspaceHandleRecord()
  if (!current || current.activeWorkspaceId) return

  const workspaceId = crypto.randomUUID()
  await saveHandle({
    kind: 'workspace',
    id: workspaceId,
    handle: current.handle,
    name: current.name,
    pickedAt: current.pickedAt,
  })
  await saveHandle({
    ...current,
    activeWorkspaceId: workspaceId,
  })
}

/* ───────────────────────────── Permission helpers ─────────────────────── */

export type HandlePermissionState = 'granted' | 'prompt' | 'denied'

export async function queryHandlePermission(
  handle: FileSystemHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<HandlePermissionState> {
  try {
    const queryPermission = (
      handle as FileSystemDirectoryHandle & {
        queryPermission?: (options: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
      }
    ).queryPermission
    // OPFS handles do not need an OS permission grant, and Firefox does not
    // expose queryPermission/requestPermission on them.
    if (typeof queryPermission !== 'function') return 'granted'
    const state = await queryPermission.call(handle, { mode })
    return state as HandlePermissionState
  } catch (error) {
    logger.warn('queryPermission failed', error)
    return 'denied'
  }
}

export async function requestHandlePermission(
  handle: FileSystemHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<HandlePermissionState> {
  try {
    const requestPermission = (
      handle as FileSystemDirectoryHandle & {
        requestPermission?: (options: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
      }
    ).requestPermission
    if (typeof requestPermission !== 'function') return 'granted'
    const state = await requestPermission.call(handle, { mode })
    return state as HandlePermissionState
  } catch (error) {
    logger.warn('requestPermission failed', error)
    return 'denied'
  }
}

export function isFileSystemAccessSupported(): boolean {
  return isDirectoryPickerSupported() || isOpfsWorkspaceSupported()
}

export function isDirectoryPickerSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

function isOpfsWorkspaceSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
}

/**
 * Return a stable browser-private workspace directory. This is the Firefox
 * fallback: it uses the same FileSystemDirectoryHandle storage stack as a
 * picked folder, but the files are private to this browser origin.
 */
export async function getOrCreateOpfsWorkspaceHandle(): Promise<FileSystemDirectoryHandle> {
  if (!isOpfsWorkspaceSupported()) {
    throw new Error('Origin-private file system storage is unavailable in this browser.')
  }

  // Best effort: persistent storage makes eviction less likely. A browser may
  // decline without making OPFS unusable, so the result is deliberately not a
  // hard gate.
  await navigator.storage.persist?.().catch(() => false)
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('FreeCut Workspace', { create: true })
}
