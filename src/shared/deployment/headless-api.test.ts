import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@/types/project'
import {
  collectHeadlessProjectMediaIds,
  detectHeadlessApi,
  headlessMediaSourceUrl,
  listHeadlessMedia,
  pushProjectToHeadlessWorkspace,
  toPortableProject,
} from './headless-api'
import { HeadlessApiError, UNSEEN_SERVER_COPY } from './headless-api'

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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ project: storedProject, revision: 'sha256:before' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, revision: 'sha256:aa' }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await pushProjectToHeadlessWorkspace(storedProject)).toBe('sha256:aa')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/headless/v1/projects/proj1')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(String(init.body)) as {
      expectedRevision: string
      force: boolean
      project: Record<string, unknown>
    }
    expect(body.expectedRevision).toBe('sha256:before')
    expect(body.force).toBe(false)
    expect(body.project.blocks).toBeUndefined()
    expect(body.project.rootFolderHandle).toBeUndefined()
  })

  it('creates the project first when the initial read reports it missing', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        if (init.method === undefined && calls.length === 1) {
          return jsonResponse({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } }, 404)
        }
        if (init.method === 'POST') {
          return jsonResponse({ ok: true, revision: 'sha256:created' }, 201)
        }
        return jsonResponse({ ok: true, revision: 'sha256:bb' })
      }),
    )

    expect(await pushProjectToHeadlessWorkspace(storedProject)).toBe('sha256:bb')
    expect(calls.map((call) => call.init.method)).toEqual([undefined, 'POST', 'PUT'])
    const createCall = calls.at(1)
    expect(createCall?.url).toBe('/api/headless/v1/projects')
    const headers = (createCall?.init.headers ?? {}) as Record<string, string>
    expect(headers['Idempotency-Key']).toMatch(/\S/)
    const created = JSON.parse(String(createCall?.init.body)) as Record<string, unknown>
    expect(created).toMatchObject({ id: 'proj1', width: 1280, height: 720, fps: 30 })
    const saved = JSON.parse(String(calls.at(2)?.init.body)) as Record<string, unknown>
    expect(saved).toMatchObject({ expectedRevision: 'sha256:created', force: false })
  })

  it('uses a caller-known revision without an extra read', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ revision: 'sha256:after' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(pushProjectToHeadlessWorkspace(storedProject, 'sha256:known')).resolves.toBe(
      'sha256:after',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({ expectedRevision: 'sha256:known', force: false })
  })

  it('uses create-only semantics when the caller has no applied server base', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ revision: 'sha256:created' }, 201))
      .mockResolvedValueOnce(jsonResponse({ revision: 'sha256:saved' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(pushProjectToHeadlessWorkspace(storedProject, null)).resolves.toBe('sha256:saved')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/headless/v1/projects')
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/headless/v1/projects/proj1')
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      expectedRevision: 'sha256:created',
    })
  })

  it('refuses to overwrite a server copy this browser has never applied', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { code: 'ALREADY_EXISTS', message: 'Project already exists' } }, 409),
      )
    vi.stubGlobal('fetch', fetchMock)

    const failure = await pushProjectToHeadlessWorkspace(storedProject, null).catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(HeadlessApiError)
    expect((failure as HeadlessApiError).code).toBe(UNSEEN_SERVER_COPY)
    // Only the create was attempted: no PUT may reach an unseen project.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
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

describe('headless media helpers', () => {
  it('filters the media listing and builds a same-origin source URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          media: [
            {
              id: 'card-1',
              revision: 'sha256:media',
              sourceAvailable: true,
              projectIds: ['proj1'],
              metadata: {
                id: 'card-1',
                storageType: 'workspace',
                fileName: 'card.svg',
                fileSize: 42,
                mimeType: 'image/svg+xml',
              },
            },
            { id: 42, sourceAvailable: true },
          ],
        }),
      ),
    )

    await expect(listHeadlessMedia()).resolves.toEqual([
      expect.objectContaining({
        id: 'card-1',
        revision: 'sha256:media',
        sourceAvailable: true,
        projectIds: ['proj1'],
        metadata: expect.objectContaining({
          id: 'card-1',
          fileName: 'card.svg',
          mimeType: 'image/svg+xml',
        }),
      }),
    ])
    expect(headlessMediaSourceUrl('card-1')).toBe('/api/headless/v1/media/card-1/source')
    expect(() => headlessMediaSourceUrl('../escape')).toThrow(/not portable/)
  })

  it('collects and de-duplicates root and composition media ids', () => {
    const project = {
      ...storedProject,
      timeline: {
        tracks: [],
        items: [
          { id: 'a', mediaId: 'card-1' },
          { id: 'b', mediaId: '../bad' },
        ],
        compositions: [
          {
            id: 'nested',
            items: [
              { id: 'c', mediaId: 'card-1' },
              { id: 'd', mediaId: 'moon-1' },
            ],
          },
        ],
      },
    } as unknown as Project

    expect(collectHeadlessProjectMediaIds(project)).toEqual(['card-1', 'moon-1'])
  })
})
