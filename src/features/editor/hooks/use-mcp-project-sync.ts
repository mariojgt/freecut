import { useCallback, useEffect, useRef } from 'react'
import {
  collectHeadlessProjectMediaIds,
  getHeadlessProject,
  headlessMediaSourceUrl,
  HeadlessApiError,
  listHeadlessMedia,
  listHeadlessProjects,
  type HeadlessMediaResource,
  type HeadlessProjectResource,
} from '@/shared/deployment/headless-api'
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
const LOCAL_DIVERGENCE_KEY_PREFIX = 'freecut:mcp-local-diverged:'
const APPLIED_REVISION_KEY_PREFIX = 'freecut:mcp-applied-revision:'
const logger = createLogger('McpProjectSync')

type EditorMutationRunner = <T>(operation: () => Promise<T>) => Promise<T>

interface UseMcpProjectSyncOptions {
  projectId: string
  enabled: boolean
  runExclusive: EditorMutationRunner
}

interface McpProjectSyncControl {
  notePushedRevision: (revision: string | null) => void
  getPushExpectedRevision: () => string | null
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
  const mediaIds = collectHeadlessProjectMediaIds(project)
  if (mediaIds.length === 0) return

  const resources = await listHeadlessMedia(signal)
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]))
  const bridge = await importServerMediaBridge()
  const materialized: MediaMetadata[] = []

  // Deliberately sequential: source files may be large, and accepting the
  // project waits for every required byte. This bounds browser memory while
  // still making the operation abortable between and during downloads.
  for (const mediaId of mediaIds) {
    signal.throwIfAborted()
    const media = await materializeReferencedMedia(
      mediaId,
      projectId,
      resourcesById.get(mediaId),
      signal,
      bridge,
    )
    if (media) materialized.push(media)
  }
  await syncMaterializedMediaStore(projectId, materialized, bridge)
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
}: UseMcpProjectSyncOptions): McpProjectSyncControl {
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

    const unsubscribe = useTimelineSettingsStore.subscribe((state, previous) => {
      if (state.isDirty && !previous.isDirty) {
        localDivergedRef.current = true
        persistDivergence(projectId, true)
      }
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

    const sync = async () => {
      if (busy || controller.signal.aborted) return
      busy = true
      try {
        await pollOnce()
      } catch (error) {
        if (
          !controller.signal.aborted &&
          !(error instanceof HeadlessApiError && error.status === 404)
        ) {
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

  return { notePushedRevision, getPushExpectedRevision }
}
