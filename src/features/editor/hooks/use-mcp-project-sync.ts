import { useCallback, useEffect, useRef, useState } from 'react'
import {
  collectHeadlessProjectMediaIds,
  getHeadlessProject,
  headlessMediaSourceUrl,
  HeadlessApiError,
  listHeadlessMedia,
  listHeadlessProjects,
  publishActiveMcpSession,
  uploadMediaToHeadlessWorkspace,
  type HeadlessMediaResource,
  type HeadlessProjectResource,
} from '@/shared/deployment/headless-api'
import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { createLogger } from '@/shared/logging/logger'
import { migrateProject } from '@/shared/projects/migrations'
import { usePlaybackStore } from '@/shared/state/playback'
import type { Project } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'
import { useProjectStore } from '../deps/projects'
import { importServerMediaBridge } from '../deps/server-media-contract'
import { updateProject } from '../deps/storage-contract'
import {
  hydrateTimelineStoresFromProject,
  refreshLoadedProjectMediaValidation,
} from '../deps/timeline-persistence-contract'
import { useItemsStore, useTimelineSettingsStore } from '../deps/timeline-store'

const POLL_INTERVAL_MS = 1500
/**
 * How long local editing must settle before the browser copy is published.
 * Short enough that an agent reading the project sees current work, long
 * enough that a drag does not push on every frame.
 */
const AUTO_PUBLISH_QUIET_MS = 1800
/** Backoff between attempts to seed a project the workspace has never seen. */
const SEED_RETRY_MS = 10_000
const LOCAL_DIVERGENCE_KEY_PREFIX = 'freecut:mcp-local-diverged:'
const APPLIED_REVISION_KEY_PREFIX = 'freecut:mcp-applied-revision:'
const logger = createLogger('McpProjectSync')

type EditorMutationRunner = <T>(operation: () => Promise<T>) => Promise<T>

interface UseMcpProjectSyncOptions {
  /**
   * Save the open project into the server workspace and return its revision.
   * Supplying this turns the link bidirectional: local edits stop blocking
   * incoming agent work and instead become the new shared base.
   */
  publishLocal?: (expectedRevision: string | null) => Promise<string | null>
  projectId: string
  enabled: boolean
  runExclusive: EditorMutationRunner
}

interface McpProjectSyncControl {
  notePushedRevision: (revision: string | null) => void
  getPushExpectedRevision: () => string | null
  /** When an agent edit last landed, so the UI can show the link is working. */
  lastRemoteAppliedAt: number | null
}

type ServerMediaBridge = Awaited<ReturnType<typeof importServerMediaBridge>>

function localDivergenceKey(projectId: string): string {
  return `${LOCAL_DIVERGENCE_KEY_PREFIX}${projectId}`
}

function appliedRevisionKey(projectId: string): string {
  return `${APPLIED_REVISION_KEY_PREFIX}${projectId}`
}

function readPersistedAppliedRevision(projectId: string): string | null {
  try {
    const revision = window.localStorage.getItem(appliedRevisionKey(projectId))
    return revision && revision.length > 0 ? revision : null
  } catch {
    return null
  }
}

function persistAppliedRevision(projectId: string, revision: string): void {
  try {
    window.localStorage.setItem(appliedRevisionKey(projectId), revision)
  } catch {
    // The in-memory base still protects this editor session.
  }
}

function readPersistedDivergence(projectId: string): boolean {
  try {
    return window.localStorage.getItem(localDivergenceKey(projectId)) === '1'
  } catch {
    return false
  }
}

function persistDivergence(projectId: string, diverged: boolean): void {
  try {
    if (diverged) {
      window.localStorage.setItem(localDivergenceKey(projectId), '1')
    } else {
      window.localStorage.removeItem(localDivergenceKey(projectId))
    }
  } catch {
    // Storage can be unavailable in private/restricted browser contexts. The
    // in-memory latch still protects the current editor session.
  }
}

async function materializeReferencedMedia(
  mediaId: string,
  projectId: string,
  resource: HeadlessMediaResource | undefined,
  signal: AbortSignal,
  bridge: ServerMediaBridge,
): Promise<MediaMetadata | null> {
  if (resource?.sourceAvailable && resource.metadata) {
    return bridge.mediaLibraryService.materializeMediaFromUrl(
      headlessMediaSourceUrl(mediaId),
      projectId,
      resource.metadata,
      { signal },
    )
  }

  // Browser-origin media sent with the original project may intentionally
  // have no server copy. It is safe only when this selected workspace still
  // has a usable local source for the same immutable id.
  const local = await bridge.mediaLibraryService.getMedia(mediaId)
  const localSource = local ? await bridge.mediaLibraryService.getMediaFile(local) : null
  if (local && localSource) return null
  throw new HeadlessApiError(
    `MCP project references media ${mediaId}, but neither workspace has its source.`,
    422,
    'MISSING_MEDIA',
  )
}

/**
 * Media the MCP tool uploaded into this project but has not placed on the
 * timeline yet. Dropping these would silently lose an upload from the open
 * scene's library, so they are pulled in too.
 */
function collectProjectLinkedMedia(
  projectId: string,
  resources: readonly HeadlessMediaResource[],
  referenced: ReadonlySet<string>,
): HeadlessMediaResource[] {
  return resources.filter(
    (resource) =>
      resource.sourceAvailable &&
      resource.metadata !== undefined &&
      !referenced.has(resource.id) &&
      (resource.projectIds?.includes(projectId) ?? false),
  )
}

async function materializeLinkedMedia(
  resource: HeadlessMediaResource,
  projectId: string,
  signal: AbortSignal,
  bridge: ServerMediaBridge,
): Promise<MediaMetadata | null> {
  if (!resource.metadata) return null
  try {
    return await bridge.mediaLibraryService.materializeMediaFromUrl(
      headlessMediaSourceUrl(resource.id),
      projectId,
      resource.metadata,
      { signal },
    )
  } catch (error) {
    if (signal.aborted) throw error
    // No timeline item depends on this asset, so a failed copy must never
    // block the revision the user is waiting for.
    logger.warn(`Could not import project-linked media ${resource.id}:`, error)
    return null
  }
}

/**
 * Deliberately sequential: source files may be large, and accepting the
 * project waits for every required byte. This bounds browser memory while
 * still making the operation abortable between and during downloads.
 */
async function materializeSequentially<T>(
  entries: readonly T[],
  signal: AbortSignal,
  materialize: (entry: T) => Promise<MediaMetadata | null>,
): Promise<MediaMetadata[]> {
  const materialized: MediaMetadata[] = []
  for (const entry of entries) {
    signal.throwIfAborted()
    const media = await materialize(entry)
    if (media) materialized.push(media)
  }
  return materialized
}

/**
 * Push local-only media up so the workspace can render the user's scene.
 *
 * The follower pulls server media down; without the reverse an agent renders
 * the timeline with the user's own imports missing. Best effort and sequential:
 * a failed upload must never block the project edit the user is waiting on.
 */
async function uploadLocalOnlyMedia(
  projectId: string,
  referencedIds: readonly string[],
  resourcesById: ReadonlyMap<string, HeadlessMediaResource>,
  signal: AbortSignal,
  bridge: ServerMediaBridge,
): Promise<void> {
  for (const mediaId of referencedIds) {
    if (resourcesById.get(mediaId)?.sourceAvailable) continue
    signal.throwIfAborted()
    const local = await bridge.mediaLibraryService.getMedia(mediaId)
    if (!local) continue
    const file = await bridge.mediaLibraryService.getMediaFile(local)
    if (!file) continue
    const uploaded = await uploadMediaToHeadlessWorkspace(
      mediaId,
      projectId,
      local.fileName,
      file,
      signal,
    )
    if (!uploaded) logger.warn(`Could not hand media ${mediaId} to the MCP workspace`)
  }
}

async function syncMaterializedMediaStore(
  projectId: string,
  materialized: MediaMetadata[],
  bridge: ServerMediaBridge,
): Promise<void> {
  const mediaStore = bridge.useMediaLibraryStore.getState()
  if (mediaStore.currentProjectId !== projectId) return

  // Finish any editor-start load before upserting the just-materialized
  // records, so an older in-flight read cannot replace them afterwards.
  await mediaStore.loadMediaItems()
  for (const media of materialized) {
    bridge.useMediaLibraryStore.getState().prependMediaItem(media)
  }
}

async function materializeServerMedia(
  projectId: string,
  project: Project,
  signal: AbortSignal,
): Promise<void> {
  const referencedIds = collectHeadlessProjectMediaIds(project)
  const resources = await listHeadlessMedia(signal)
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]))
  const bridge = await importServerMediaBridge()

  // Hand local-only media over first, so the workspace can render this scene.
  await uploadLocalOnlyMedia(projectId, referencedIds, resourcesById, signal, bridge)

  const required = await materializeSequentially(referencedIds, signal, (mediaId) =>
    materializeReferencedMedia(mediaId, projectId, resourcesById.get(mediaId), signal, bridge),
  )
  const linked = await materializeSequentially(
    collectProjectLinkedMedia(projectId, resources, new Set(referencedIds)),
    signal,
    (resource) => materializeLinkedMedia(resource, projectId, signal, bridge),
  )
  await syncMaterializedMediaStore(projectId, [...required, ...linked], bridge)
}

/**
 * After local work reaches the workspace, make sure its media did too —
 * otherwise an agent renders the user's scene with their own imports missing.
 */
async function handOverLocalMedia(projectId: string, signal: AbortSignal): Promise<void> {
  const referencedIds = useItemsStore.getState().mediaDependencyIds
  if (referencedIds.length === 0) return
  const resources = await listHeadlessMedia(signal)
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]))
  if (referencedIds.every((id) => resourcesById.get(id)?.sourceAvailable)) return
  const bridge = await importServerMediaBridge()
  await uploadLocalOnlyMedia(projectId, referencedIds, resourcesById, signal, bridge)
}

async function persistAndHydrateRemoteProject(
  projectId: string,
  rawProject: Project,
  signal: AbortSignal,
  shouldCommit: () => boolean,
  onHydrated: () => void,
): Promise<boolean> {
  const { project } = migrateProject(rawProject)
  await materializeServerMedia(projectId, project, signal)

  let savedFrame = usePlaybackStore.getState().currentFrame
  const hydrated = await hydrateTimelineStoresFromProject(project, {
    shouldCommit: () => {
      if (!shouldCommit()) return false
      savedFrame = usePlaybackStore.getState().currentFrame
      return true
    },
  })
  if (!hydrated) return false

  // Hydration itself marks timeline stores dirty while swapping their data.
  // Clear that internal signal immediately after the atomic store commit; any
  // later user edit will latch divergence again while persistence is queued.
  onHydrated()
  const maxEnd = useItemsStore.getState().maxItemEndFrame
  usePlaybackStore.getState().setCurrentFrame(Math.max(0, Math.min(savedFrame, maxEnd)))

  const persisted = await updateProject(projectId, {
    ...project,
    id: projectId,
  })
  useProjectStore.getState().setCurrentProject(persisted)
  await refreshLoadedProjectMediaValidation(projectId)
  return true
}

function canApplyRemote(localDiverged: boolean): boolean {
  const settings = useTimelineSettingsStore.getState()
  return !localDiverged && !settings.isDirty && !settings.isTimelineLoading
}

/**
 * Follow the MCP copy inside the normal editor.
 *
 * A local edit latches the follower off until the user explicitly sends that
 * version back to the workspace. This makes remote hydration automatic for a
 * clean editor without allowing a poll to overwrite unsent browser work.
 */
export function useMcpProjectSync({
  projectId,
  enabled,
  runExclusive,
  publishLocal,
}: UseMcpProjectSyncOptions): McpProjectSyncControl {
  const publishLocalRef = useRef(publishLocal)
  publishLocalRef.current = publishLocal
  const [lastRemoteAppliedAt, setLastRemoteAppliedAt] = useState<number | null>(null)
  const observedRevisionRef = useRef<string | null>(null)
  const appliedRevisionRef = useRef<string | null>(null)
  const localDivergedRef = useRef(false)

  const notePushedRevision = useCallback(
    (revision: string | null) => {
      if (!revision) return
      observedRevisionRef.current = revision
      appliedRevisionRef.current = revision
      persistAppliedRevision(projectId, revision)
      localDivergedRef.current = false
      persistDivergence(projectId, false)
    },
    [projectId],
  )

  const getPushExpectedRevision = useCallback(() => appliedRevisionRef.current, [])

  useEffect(() => {
    observedRevisionRef.current = null
    appliedRevisionRef.current = readPersistedAppliedRevision(projectId)
    localDivergedRef.current =
      useTimelineSettingsStore.getState().isDirty || readPersistedDivergence(projectId)
    if (!enabled) return

    const controller = new AbortController()
    let busy = false
    let lastLocalChangeAt = 0
    let lastSeedAt = 0

    const unsubscribe = useTimelineSettingsStore.subscribe((state, previous) => {
      if (state.isDirty && !previous.isDirty) {
        localDivergedRef.current = true
        persistDivergence(projectId, true)
      }
      if (state.isDirty) lastLocalChangeAt = Date.now()
    })

    const applyResource = async (resource: HeadlessProjectResource) => {
      if (!canApplyRemote(localDivergedRef.current)) {
        observedRevisionRef.current = resource.revision
        return
      }

      const applied = await runExclusive(async () => {
        if (!canApplyRemote(localDivergedRef.current)) return false
        return persistAndHydrateRemoteProject(
          projectId,
          resource.project,
          controller.signal,
          () => canApplyRemote(localDivergedRef.current),
          () => {
            localDivergedRef.current = false
            persistDivergence(projectId, false)
          },
        )
      })
      if (applied) {
        observedRevisionRef.current = resource.revision
        appliedRevisionRef.current = resource.revision
        persistAppliedRevision(projectId, resource.revision)
        // Silent edits are untrustworthy: say so when the scene changes under
        // the user's cursor.
        setLastRemoteAppliedAt(Date.now())
        toast.info(i18n.t('toolbar.mcpApplied'))
      }
    }

    const load = async () => {
      const resource = await getHeadlessProject(projectId, controller.signal)
      await applyResource(resource)
    }

    const pollOnce = async () => {
      if (useTimelineSettingsStore.getState().isTimelineLoading) return
      const observedRevision = observedRevisionRef.current
      if (observedRevision === null) {
        await load()
        return
      }

      const projects = await listHeadlessProjects(controller.signal)
      const summary = projects.find((entry) => entry.id === projectId)
      if (!summary || summary.revision === observedRevision) return
      if (!canApplyRemote(localDivergedRef.current)) {
        observedRevisionRef.current = summary.revision
        return
      }
      await load()
    }

    /**
     * Hand local work to the workspace once editing settles. Without this the
     * divergence guard is a one-way latch: the moment the user touches the
     * timeline the agent's edits stop arriving and its reads go stale.
     */
    const publishLocalWork = async (): Promise<boolean> => {
      const publish = publishLocalRef.current
      if (!publish || !localDivergedRef.current) return false
      if (useTimelineSettingsStore.getState().isTimelineLoading) return false
      if (lastLocalChangeAt === 0 || Date.now() - lastLocalChangeAt < AUTO_PUBLISH_QUIET_MS) {
        return false
      }
      const revision = await publish(appliedRevisionRef.current)
      if (!revision) return false
      await handOverLocalMedia(projectId, controller.signal)
      observedRevisionRef.current = revision
      appliedRevisionRef.current = revision
      persistAppliedRevision(projectId, revision)
      localDivergedRef.current = false
      persistDivergence(projectId, false)
      lastLocalChangeAt = 0
      return true
    }

    const announce = () =>
      publishActiveMcpSession(
        projectId,
        useProjectStore.getState().currentProject?.name ?? '',
        appliedRevisionRef.current,
        controller.signal,
      )

    /**
     * The workspace has never seen this project. Seed it so an agent can act on
     * what the user just opened instead of waiting for a manual push.
     */
    const seedRemoteProject = async () => {
      const publish = publishLocalRef.current
      if (!publish || Date.now() - lastSeedAt < SEED_RETRY_MS) return
      lastSeedAt = Date.now()
      const revision = await publish(null)
      if (!revision) return
      await handOverLocalMedia(projectId, controller.signal)
      observedRevisionRef.current = revision
      appliedRevisionRef.current = revision
      persistAppliedRevision(projectId, revision)
    }

    const sync = async () => {
      if (busy || controller.signal.aborted) return
      busy = true
      try {
        // Announce first and unconditionally: a project the workspace has not
        // seen yet is exactly the one an agent most needs pointing at, and the
        // poll below throws 404 for it.
        await announce()
        // Publishing wins the tick: the poll would only read back what we are
        // about to overwrite.
        if (!(await publishLocalWork())) await pollOnce()
      } catch (error) {
        if (error instanceof HeadlessApiError && error.status === 404) {
          await seedRemoteProject()
        } else if (!controller.signal.aborted) {
          logger.warn('Failed to follow the MCP project revision', error)
        }
      } finally {
        busy = false
      }
    }

    void sync()
    const interval = setInterval(() => void sync(), POLL_INTERVAL_MS)
    return () => {
      controller.abort()
      clearInterval(interval)
      unsubscribe()
    }
  }, [enabled, projectId, runExclusive])

  return { notePushedRevision, getPushExpectedRevision, lastRemoteAppliedAt }
}
