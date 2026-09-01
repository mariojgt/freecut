import { useCallback, useEffect, useRef } from 'react'
import {
  collectHeadlessProjectMediaIds,
  getHeadlessProject,
  headlessMediaSourceUrl,
  HeadlessApiError,
  listHeadlessMedia,
  listHeadlessProjects,
  type HeadlessProjectResource,
} from '@/shared/deployment/headless-api'
import { createLogger } from '@/shared/logging/logger'
import { migrateProject } from '@/shared/projects/migrations'
import { usePlaybackStore } from '@/shared/state/playback'
import type { Project } from '@/types/project'
import { useProjectStore } from '../deps/projects'
import { registerExternalMediaUrl } from '../deps/server-media-contract'
import { updateProject } from '../deps/storage-contract'
import { hydrateTimelineStoresFromProject } from '../deps/timeline-persistence-contract'
import { useItemsStore, useTimelineSettingsStore } from '../deps/timeline-store'

const POLL_INTERVAL_MS = 1500
const logger = createLogger('McpProjectSync')

type EditorMutationRunner = <T>(operation: () => Promise<T>) => Promise<T>

interface UseMcpProjectSyncOptions {
  projectId: string
  enabled: boolean
  runExclusive: EditorMutationRunner
}

interface McpProjectSyncControl {
  notePushedRevision: (revision: string | null) => void
}

async function registerServerMedia(project: Project, signal: AbortSignal): Promise<void> {
  const available = new Set(
    (await listHeadlessMedia(signal))
      .filter((resource) => resource.sourceAvailable)
      .map((resource) => resource.id),
  )
  for (const mediaId of collectHeadlessProjectMediaIds(project)) {
    if (available.has(mediaId)) {
      registerExternalMediaUrl(mediaId, headlessMediaSourceUrl(mediaId))
    }
  }
}

async function persistAndHydrateRemoteProject(
  projectId: string,
  rawProject: Project,
  signal: AbortSignal,
): Promise<void> {
  const { project } = migrateProject(rawProject)
  await registerServerMedia(project, signal)

  const savedFrame = usePlaybackStore.getState().currentFrame
  const persisted = await updateProject(projectId, {
    ...project,
    id: projectId,
  })
  await hydrateTimelineStoresFromProject(project)
  const maxEnd = useItemsStore.getState().maxItemEndFrame
  usePlaybackStore.getState().setCurrentFrame(Math.max(0, Math.min(savedFrame, maxEnd)))
  useProjectStore.getState().setCurrentProject(persisted)
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
  const localDivergedRef = useRef(false)
  const applyingRemoteRef = useRef(false)

  const notePushedRevision = useCallback((revision: string | null) => {
    if (!revision) return
    observedRevisionRef.current = revision
    localDivergedRef.current = false
  }, [])

  useEffect(() => {
    observedRevisionRef.current = null
    localDivergedRef.current = useTimelineSettingsStore.getState().isDirty
    applyingRemoteRef.current = false
    if (!enabled) return

    const controller = new AbortController()
    let busy = false

    const unsubscribe = useTimelineSettingsStore.subscribe((state, previous) => {
      if (state.isDirty && !previous.isDirty) {
        localDivergedRef.current = true
      }
    })

    const applyResource = async (resource: HeadlessProjectResource) => {
      if (!canApplyRemote(localDivergedRef.current)) {
        observedRevisionRef.current = resource.revision
        return
      }

      const applied = await runExclusive(async () => {
        if (!canApplyRemote(localDivergedRef.current)) return false
        applyingRemoteRef.current = true
        try {
          await persistAndHydrateRemoteProject(projectId, resource.project, controller.signal)
          return true
        } finally {
          applyingRemoteRef.current = false
        }
      })
      if (applied) observedRevisionRef.current = resource.revision
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

  return { notePushedRevision }
}
