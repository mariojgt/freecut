import { useEffect, useState } from 'react'
import {
  getHeadlessProject,
  HeadlessApiError,
  listHeadlessProjects,
} from '@/shared/deployment/headless-api'
import { migrateProject } from '@/shared/projects/migrations'
import { usePlaybackStore } from '@/shared/state/playback'
import { ensureFontsLoaded } from '@/shared/typography/fonts'
import type { Project } from '@/types/project'
import { hydrateTimelineStoresFromProject, useItemsStore } from '../deps/timeline-contract'

const POLL_INTERVAL_MS = 1500

export type LiveFollowStatus = 'loading' | 'live' | 'not-found' | 'error'

export interface LiveFollowProjectMeta {
  name: string
  width: number
  height: number
  fps: number
  backgroundColor?: string
}

export interface LiveFollowState {
  status: LiveFollowStatus
  revision: string | null
  project: LiveFollowProjectMeta | null
}

/** Warm the font cache for every family the timeline's text items use. */
async function preloadProjectFonts(project: Project): Promise<void> {
  const families = (project.timeline?.items ?? [])
    .map((item) => ('fontFamily' in item ? item.fontFamily : undefined))
    .filter((family): family is string => typeof family === 'string' && family.length > 0)
  await ensureFontsLoaded([...new Set(families)])
}

async function hydrateFromServer(raw: Project): Promise<LiveFollowProjectMeta> {
  const { project } = migrateProject(raw)
  await preloadProjectFonts(project)

  // Hydration resets the playhead to the project's saved frame; a follower
  // cares about continuity, so put it back where the viewer left it.
  const savedFrame = usePlaybackStore.getState().currentFrame
  await hydrateTimelineStoresFromProject(project)
  const maxEnd = useItemsStore.getState().maxItemEndFrame
  usePlaybackStore.getState().setCurrentFrame(Math.max(0, Math.min(savedFrame, maxEnd)))

  return {
    name: project.name,
    width: project.metadata.width,
    height: project.metadata.height,
    fps: project.metadata.fps,
    backgroundColor: project.metadata.backgroundColor,
  }
}

/**
 * Follow a server-workspace project: hydrate the timeline stores from the
 * headless API, then poll the listing and re-hydrate whenever its revision
 * moves — which is how MCP edits appear here moments after they happen.
 */
export function useLiveProjectFollow(projectId: string): LiveFollowState {
  const [state, setState] = useState<LiveFollowState>({
    status: 'loading',
    revision: null,
    project: null,
  })

  useEffect(() => {
    const controller = new AbortController()
    let currentRevision: string | null = null
    let busy = false

    const load = async () => {
      const resource = await getHeadlessProject(projectId, controller.signal)
      const meta = await hydrateFromServer(resource.project)
      currentRevision = resource.revision
      if (!controller.signal.aborted) {
        setState({ status: 'live', revision: resource.revision, project: meta })
      }
    }

    const sync = async () => {
      if (busy || controller.signal.aborted) return
      busy = true
      try {
        if (currentRevision === null) {
          await load()
          return
        }
        const projects = await listHeadlessProjects(controller.signal)
        const summary = projects.find((entry) => entry.id === projectId)
        if (summary && summary.revision !== currentRevision) await load()
      } catch (error) {
        if (controller.signal.aborted) return
        // A missing project is a state ("push it, or ask the agent to create
        // it") and the poll keeps watching for it to appear; anything else is
        // transient and the next tick retries.
        if (error instanceof HeadlessApiError && error.status === 404) {
          setState({ status: 'not-found', revision: null, project: null })
        } else if (currentRevision === null) {
          setState({ status: 'error', revision: null, project: null })
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
      usePlaybackStore.getState().pause()
    }
  }, [projectId])

  return state
}
