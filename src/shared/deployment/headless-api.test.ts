import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@/types/project'
import {
  detectHeadlessApi,
  pushProjectToHeadlessWorkspace,
  toPortableProject,
} from './headless-api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const storedProject = {
  id: 'proj1',
  name: 'Project',
  description: '',
  createdAt: 1,
  updatedAt: 2,
  duration: 3,
  schemaVersion: 16,
  thumbnail: 'data:image/jpeg;base64,x',
  thumbnailId: 'thumb-1',
  rootFolderName: 'Footage',
  rootFolderHandle: {} as FileSystemDirectoryHandle,
  blocks: [{ definition: { id: 'local-rig' } }],
  metadata: { width: 1280, height: 720, fps: 30, backgroundColor: '#101010' },
  timeline: { tracks: [], items: [] },
} as unknown as Project

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('toPortableProject', () => {
  it('keeps only the fields the strict lifecycle schema accepts', () => {
    const portable = toPortableProject(storedProject)
    expect(Object.keys(portable).sort()).toEqual([
      'createdAt',
      'description',
      'duration',
      'id',
      'metadata',
      'name',
      'schemaVersion',
      'timeline',
      'updatedAt',
    ])
  })
})

describe('detectHeadlessApi', () => {
  it('returns false when the route does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
    expect(await detectHeadlessApi()).toBe(false)
  })

  it('returns false when the route answers with non-JSON content', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
        ),
    )
    expect(await detectHeadlessApi()).toBe(false)
  })

  it('returns true for a JSON health response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })))
    expect(await detectHeadlessApi()).toBe(true)
  })
})

describe('pushProjectToHeadlessWorkspace', () => {
  it('saves in place when the server copy already exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, revision: 'sha256:aa' }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await pushProjectToHeadlessWorkspace(storedProject)).toBe('sha256:aa')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/headless/v1/projects/proj1')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(String(init.body)) as {
      force: boolean
      project: Record<string, unknown>
    }
    expect(body.force).toBe(true)
    expect(body.project.blocks).toBeUndefined()
    expect(body.project.rootFolderHandle).toBeUndefined()
  })

  it('creates the project first when the PUT reports it missing', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        if (init.method === 'PUT' && calls.length === 1) {
          return jsonResponse({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } }, 404)
        }
        if (init.method === 'POST') return jsonResponse({ ok: true }, 201)
        return jsonResponse({ ok: true, revision: 'sha256:bb' })
      }),
    )

    expect(await pushProjectToHeadlessWorkspace(storedProject)).toBe('sha256:bb')
    expect(calls.map((call) => call.init.method)).toEqual(['PUT', 'POST', 'PUT'])
    const createCall = calls.at(1)
    expect(createCall?.url).toBe('/api/headless/v1/projects')
    const headers = (createCall?.init.headers ?? {}) as Record<string, string>
    expect(headers['Idempotency-Key']).toMatch(/\S/)
    const created = JSON.parse(String(createCall?.init.body)) as Record<string, unknown>
    expect(created).toMatchObject({ id: 'proj1', width: 1280, height: 720, fps: 30 })
  })

  it('rejects ids the server would refuse instead of dialing out', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      pushProjectToHeadlessWorkspace({ ...storedProject, id: '-leading-dash' }),
    ).rejects.toThrow(/not portable/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
