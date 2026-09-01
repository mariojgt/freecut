/**
 * Same-origin client for the headless API behind the HTTPS front door.
 *
 * A Docker deployment's proxy forwards /api/headless/* to the API container
 * (docker/Caddyfile), which is what lets the editor read and write
 * server-workspace projects without CORS or a second exposed port. Outside
 * that deployment the route does not exist, so a failed probe means "no MCP
 * workspace here", never an error worth surfacing.
 */

import type { Project } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'

const HEADLESS_API_BASE = '/api/headless'
const PORTABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const BACKGROUND_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/

/** The exact top-level fields the API's strict project schema accepts. */
export interface PortableProject {
  id: string
  name: string
  description: string
  createdAt: number
  updatedAt: number
  duration: number
  schemaVersion?: number
  metadata: Project['metadata']
  timeline?: Project['timeline']
}

export class HeadlessApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'HeadlessApiError'
    this.status = status
    this.code = code
  }
}

/**
 * Reduce a stored project to the fields the API will accept.
 *
 * The lifecycle schema is strict: browser-only fields (rootFolderHandle,
 * thumbnails) and project-local block definitions are rejected outright.
 * Block instances already live in timeline items, so dropping the
 * definitions never changes what renders — only the reusable rigs stay
 * behind.
 */
export function toPortableProject(project: Project): PortableProject {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    duration: project.duration,
    ...(project.schemaVersion === undefined ? {} : { schemaVersion: project.schemaVersion }),
    metadata: project.metadata,
    ...(project.timeline === undefined ? {} : { timeline: project.timeline }),
  }
}

interface ApiErrorEnvelope {
  error?: { code?: string; message?: string }
}

async function requestJson(pathname: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${HEADLESS_API_BASE}${pathname}`, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = (payload as ApiErrorEnvelope | null)?.error
    throw new HeadlessApiError(
      error?.message ?? `Headless API returned HTTP ${response.status}`,
      response.status,
      error?.code,
    )
  }
  return payload
}

/** True when this deployment fronts the headless API at /api/headless. */
export async function detectHeadlessApi(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${HEADLESS_API_BASE}/health`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal,
    })
    return (
      response.ok && Boolean(response.headers.get('content-type')?.includes('application/json'))
    )
  } catch {
    return false
  }
}

export interface HeadlessProjectSummary {
  id: string
  revision: string
}

function isHeadlessProjectSummary(value: unknown): value is HeadlessProjectSummary {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && typeof candidate.revision === 'string'
}

/** Lightweight listing used to watch for revision changes without a body fetch. */
export async function listHeadlessProjects(
  signal?: AbortSignal,
): Promise<HeadlessProjectSummary[]> {
  const payload = await requestJson('/v1/projects', { signal })
  const projects = (payload as { projects?: unknown } | null)?.projects
  if (!Array.isArray(projects)) return []
  return projects.filter(isHeadlessProjectSummary)
}

export interface HeadlessProjectResource {
  project: Project
  revision: string
}

export interface HeadlessMediaResource {
  id: string
  revision?: string
  metadata?: MediaMetadata
  sourceAvailable: boolean
  projectIds?: string[]
}

function isHeadlessMediaMetadata(value: unknown, mediaId: string): value is MediaMetadata {
  if (!value || typeof value !== 'object') return false
  const metadata = value as Record<string, unknown>
  return (
    metadata.id === mediaId &&
    typeof metadata.fileName === 'string' &&
    typeof metadata.fileSize === 'number' &&
    typeof metadata.mimeType === 'string'
  )
}

function isHeadlessMediaResource(value: unknown): value is HeadlessMediaResource {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || typeof candidate.sourceAvailable !== 'boolean') {
    return false
  }
  return (
    candidate.metadata === undefined || isHeadlessMediaMetadata(candidate.metadata, candidate.id)
  )
}

export async function listHeadlessMedia(signal?: AbortSignal): Promise<HeadlessMediaResource[]> {
  const payload = await requestJson('/v1/media', { signal })
  const media = (payload as { media?: unknown } | null)?.media
  if (!Array.isArray(media)) return []
  return media.filter(isHeadlessMediaResource)
}

/** Same-origin URL for source bytes stored in the server workspace. */
export function headlessMediaSourceUrl(mediaId: string): string {
  if (!PORTABLE_ID_PATTERN.test(mediaId)) {
    throw new HeadlessApiError(`Media id "${mediaId}" is not portable`, 400)
  }
  return `${HEADLESS_API_BASE}/v1/media/${encodeURIComponent(mediaId)}/source`
}

/** Media ids referenced anywhere in a portable project's timeline. */
export function collectHeadlessProjectMediaIds(project: Project): string[] {
  const ids = new Set<string>()
  const add = (items: readonly unknown[]) => {
    for (const raw of items) {
      const item = raw as { mediaId?: unknown }
      if (typeof item.mediaId === 'string' && PORTABLE_ID_PATTERN.test(item.mediaId)) {
        ids.add(item.mediaId)
      }
    }
  }
  add((project.timeline?.items ?? []) as unknown[])
  for (const composition of project.timeline?.compositions ?? []) {
    add((composition.items ?? []) as unknown[])
  }
  return [...ids]
}

export async function getHeadlessProject(
  id: string,
  signal?: AbortSignal,
): Promise<HeadlessProjectResource> {
  const payload = await requestJson(`/v1/projects/${encodeURIComponent(id)}`, { signal })
  const candidate = payload as { project?: unknown; revision?: unknown } | null
  if (!candidate || typeof candidate.revision !== 'string' || !candidate.project) {
    throw new HeadlessApiError('Headless API returned an unexpected project payload', 502)
  }
  return { project: candidate.project as Project, revision: candidate.revision }
}

/**
 * Create or overwrite the server-workspace copy of a project.
 *
 * PUT never creates, so a missing id falls back to POST (which demands an
 * Idempotency-Key) followed by the same PUT. Returns the saved revision.
 */
function isMissingProjectError(error: unknown): boolean {
  return (
    error instanceof HeadlessApiError &&
    (error.status === 404 || error.code === 'PROJECT_NOT_FOUND')
  )
}

function requireRevision(payload: unknown, context: string): string {
  const revision = (payload as { revision?: unknown } | null)?.revision
  if (typeof revision !== 'string') {
    throw new HeadlessApiError(`Headless API did not return ${context} revision`, 502)
  }
  return revision
}

async function createPortableProject(project: PortableProject): Promise<string> {
  const { width, height, fps, backgroundColor } = project.metadata
  const payload = await requestJson('/v1/projects', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({
      id: project.id,
      name: project.name,
      width,
      height,
      fps,
      ...(backgroundColor && BACKGROUND_COLOR_PATTERN.test(backgroundColor)
        ? { backgroundColor }
        : {}),
    }),
  })
  return requireRevision(payload, 'the created')
}

/**
 * The server already holds this project, but this browser has never applied
 * that copy — pushing would discard whatever the MCP wrote. Callers surface
 * this as an explicit overwrite choice rather than a dead end.
 */
export const UNSEEN_SERVER_COPY = 'UNSEEN_SERVER_COPY'

async function createUnseenOrFail(project: PortableProject): Promise<string> {
  try {
    return await createPortableProject(project)
  } catch (error) {
    if (!(error instanceof HeadlessApiError) || error.code !== 'ALREADY_EXISTS') throw error
    throw new HeadlessApiError(
      `The MCP workspace already holds "${project.id}", and this browser has never applied that copy.`,
      409,
      UNSEEN_SERVER_COPY,
    )
  }
}

async function resolveExpectedRevision(
  project: PortableProject,
  knownRevision: string | undefined,
): Promise<string> {
  if (knownRevision !== undefined) return knownRevision
  try {
    return (await getHeadlessProject(project.id)).revision
  } catch (error) {
    if (!isMissingProjectError(error)) throw error
    return createPortableProject(project)
  }
}

/**
 * Tell the workspace which project a human currently has open.
 *
 * Agents read this to act on the open scene rather than an id the user had to
 * copy out of the URL. Best effort by design: a deployment without the
 * headless API must not surface errors for a heartbeat nobody asked for.
 */
export async function publishActiveMcpSession(
  projectId: string,
  projectName: string,
  revision: string | null,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!PORTABLE_ID_PATTERN.test(projectId)) return false
  try {
    await requestJson('/v1/session/active', {
      method: 'PUT',
      body: JSON.stringify({ projectId, projectName, revision }),
      signal,
    })
    return true
  } catch {
    return false
  }
}

export async function pushProjectToHeadlessWorkspace(
  project: Project,
  knownRevision?: string | null,
): Promise<string | null> {
  const portable = toPortableProject(project)
  if (!PORTABLE_ID_PATTERN.test(portable.id)) {
    throw new HeadlessApiError(`Project id "${portable.id}" is not portable`, 400)
  }

  // null is an explicit "this browser has never applied a server copy" base:
  // create-only semantics prevent an unknown existing project from being
  // overwritten with a freshly fetched revision. undefined retains the
  // legacy discover-or-create behavior for non-editor callers.
  const expectedRevision =
    knownRevision === null
      ? await createUnseenOrFail(portable)
      : await resolveExpectedRevision(portable, knownRevision)
  const payload = await requestJson(`/v1/projects/${encodeURIComponent(portable.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ project: portable, expectedRevision, force: false }),
  })
  const revision = (payload as { revision?: unknown } | null)?.revision
  return typeof revision === 'string' ? revision : null
}
