// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import './test-utils/logger-test-mocks'

type StoredRecord = Record<string, unknown> & {
  key: string
  kind: string
}

const storedRecords = vi.hoisted(() => new Map<string, StoredRecord>())

vi.mock('idb', () => ({
  openDB: vi.fn(async () => ({
    get: async (_store: string, key: string) => storedRecords.get(key),
    put: async (_store: string, record: StoredRecord) => {
      if (
        record.kind === 'workspace' &&
        record.workspaceStorageKind === 'opfs' &&
        'handle' in record
      ) {
        throw new DOMException('The object can not be cloned.', 'DataCloneError')
      }
      storedRecords.set(record.key, record)
      return record.key
    },
    delete: async (_store: string, key: string) => storedRecords.delete(key),
    getAllFromIndex: async (_store: string, _index: string, kind: string) =>
      [...storedRecords.values()].filter((record) => record.kind === kind),
  })),
}))

import {
  activateWorkspaceHandle,
  getWorkspaceHandleRecord,
  listKnownWorkspaces,
  saveWorkspaceHandleRecord,
} from './handles-db'

function createDirectoryHandle(name: string): FileSystemDirectoryHandle {
  const handle = {
    kind: 'directory',
    name,
    isSameEntry: vi.fn(async (other: FileSystemHandle) => other === handle),
  }
  return handle as unknown as FileSystemDirectoryHandle
}

function installOpfs(handles: FileSystemDirectoryHandle[]) {
  const byName = new Map(handles.map((handle) => [handle.name, handle]))
  const getDirectoryHandle = vi.fn(
    async (name: string, options?: FileSystemGetDirectoryOptions) => {
      const handle = byName.get(name)
      if (handle) return handle
      if (!options?.create) throw new DOMException('Not found', 'NotFoundError')
      const created = createDirectoryHandle(name)
      byName.set(name, created)
      return created
    },
  )
  const root = createDirectoryHandle('opfs-root') as FileSystemDirectoryHandle & {
    getDirectoryHandle: typeof getDirectoryHandle
  }
  root.getDirectoryHandle = getDirectoryHandle

  vi.stubGlobal('navigator', {
    storage: {
      persist: vi.fn(async () => true),
      getDirectory: vi.fn(async () => root),
    },
  })

  return { getDirectoryHandle }
}

beforeEach(() => {
  storedRecords.clear()
  vi.unstubAllGlobals()
  let uuid = 0
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => `workspace-${++uuid}`),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OPFS workspace handle persistence', () => {
  it('stores descriptors without handles and rehydrates live handles on read', async () => {
    const handle = createDirectoryHandle('FreeCut Workspace')
    const { getDirectoryHandle } = installOpfs([handle])

    await saveWorkspaceHandleRecord(handle, 'opfs')

    expect([...storedRecords.values()]).toHaveLength(2)
    for (const record of storedRecords.values()) {
      expect(record).not.toHaveProperty('handle')
      expect(record).toMatchObject({
        workspaceStorageKind: 'opfs',
        opfsDirectoryName: 'FreeCut Workspace',
      })
    }

    await expect(getWorkspaceHandleRecord()).resolves.toMatchObject({
      handle,
      opfsDirectoryName: 'FreeCut Workspace',
    })
    await expect(listKnownWorkspaces()).resolves.toMatchObject([
      { handle, opfsDirectoryName: 'FreeCut Workspace' },
    ])
    expect(getDirectoryHandle).toHaveBeenCalledWith('FreeCut Workspace', { create: false })
  })

  it('keeps an imported workspace display name separate from its OPFS locator', async () => {
    const handle = createDirectoryHandle('FreeCut Imported Workspace 123')
    installOpfs([handle])

    await saveWorkspaceHandleRecord(handle, 'opfs', 'My Documentary')

    const current = storedRecords.get('workspace:current')
    expect(current).toMatchObject({
      name: 'My Documentary',
      opfsDirectoryName: 'FreeCut Imported Workspace 123',
    })
    await expect(getWorkspaceHandleRecord()).resolves.toMatchObject({
      handle,
      name: 'My Documentary',
    })
  })

  it('keeps the active OPFS pointer serializable', async () => {
    const first = createDirectoryHandle('FreeCut Imported Workspace first')
    const second = createDirectoryHandle('FreeCut Imported Workspace second')
    installOpfs([first, second])
    await saveWorkspaceHandleRecord(first, 'opfs', 'First')
    await saveWorkspaceHandleRecord(second, 'opfs', 'Second')
    const known = await listKnownWorkspaces()
    const firstRecord = known.find((record) => record.name === 'First')
    const secondRecord = known.find((record) => record.name === 'Second')

    expect(firstRecord).toBeDefined()

    await expect(activateWorkspaceHandle(firstRecord!.id)).resolves.toMatchObject({ handle: first })

    expect(storedRecords.get('workspace:current')).toMatchObject({
      activeWorkspaceId: firstRecord!.id,
      name: 'First',
      opfsDirectoryName: first.name,
    })
    expect(storedRecords.get('workspace:current')).not.toHaveProperty('handle')
    expect(secondRecord?.name).toBe('Second')
  })

  it('continues storing user-picked directory handles', async () => {
    installOpfs([])
    const handle = createDirectoryHandle('Movies')

    await saveWorkspaceHandleRecord(handle, 'directory')

    expect(storedRecords.get('workspace:current')).toMatchObject({
      handle,
      workspaceStorageKind: 'directory',
    })
    await expect(getWorkspaceHandleRecord()).resolves.toMatchObject({ handle })
  })
})
