import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePlaybackStore } from '@/shared/state/playback'
import { PlaybackControls, TimecodeDisplay, VideoPreview } from '../deps/preview-contract'
import { useItemsStore } from '../deps/timeline-contract'
import {
  useLiveProjectFollow,
  type LiveFollowProjectMeta,
  type LiveFollowStatus,
} from '../hooks/use-live-project-follow'

const DEFAULT_EMPTY_TIMELINE_SECONDS = 5

interface LiveFollowPageProps {
  projectId: string
}

function useMeasuredContainer(remeasureKey: unknown) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const updateSize = () => {
      const rect = element.getBoundingClientRect()
      const next = { width: Math.floor(rect.width), height: Math.floor(rect.height) }
      setContainerSize((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next,
      )
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [remeasureKey])

  return { containerRef, containerSize }
}

function LiveBanner({
  project,
  revision,
}: {
  project: LiveFollowProjectMeta | null
  revision: string | null
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
      </span>
      <span className="font-medium">{t('live.banner')}</span>
      {project && <span className="text-muted-foreground truncate">{project.name}</span>}
      <span className="ml-auto text-xs text-muted-foreground">
        {revision ? revision.slice(0, 19) : t('live.readOnly')}
      </span>
    </div>
  )
}

function LiveTransport({ fps }: { fps: number }) {
  const { t } = useTranslation()
  const maxItemEndFrame = useItemsStore((s) => s.maxItemEndFrame)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const totalFrames = maxItemEndFrame > 0 ? maxItemEndFrame : fps * DEFAULT_EMPTY_TIMELINE_SECONDS
  const lastFrame = Math.max(0, totalFrames - 1)

  return (
    <div className="border-t border-border px-4 py-2 flex flex-col gap-2">
      <input
        type="range"
        min={0}
        max={lastFrame}
        value={Math.min(currentFrame, lastFrame)}
        onChange={(event) =>
          usePlaybackStore.getState().setCurrentFrame(Number(event.target.value))
        }
        aria-label={t('live.scrubberAria')}
        className="w-full accent-primary"
      />
      <div className="relative flex items-center">
        <TimecodeDisplay fps={fps} totalFrames={totalFrames} />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto">
            <PlaybackControls totalFrames={totalFrames} fps={fps} />
          </div>
        </div>
      </div>
    </div>
  )
}

function LiveStatusMessage({ status, projectId }: { status: LiveFollowStatus; projectId: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
      {status === 'loading' && <p className="text-muted-foreground">{t('live.loading')}</p>}
      {status === 'not-found' && (
        <>
          <p className="font-medium">{t('live.notFound')}</p>
          <code className="text-sm text-muted-foreground">{projectId}</code>
        </>
      )}
      {status === 'error' && <p className="text-muted-foreground">{t('live.error')}</p>}
    </div>
  )
}

/**
 * Read-only follower for a server-workspace project. Nothing here persists:
 * the stores are hydrated straight from the headless API and replaced when
 * its revision moves, so whatever an MCP agent does shows up moments later.
 */
export function LiveFollowPage({ projectId }: LiveFollowPageProps) {
  const { status, revision, project } = useLiveProjectFollow(projectId)
  const { containerRef, containerSize } = useMeasuredContainer(status)

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <LiveBanner project={project} revision={revision} />
      {status === 'live' && project ? (
        <>
          <div ref={containerRef} className="relative flex-1 min-h-0">
            <VideoPreview
              project={{
                width: project.width,
                height: project.height,
                backgroundColor: project.backgroundColor,
              }}
              containerSize={containerSize}
            />
          </div>
          <LiveTransport fps={project.fps} />
        </>
      ) : (
        <LiveStatusMessage status={status} projectId={projectId} />
      )}
    </div>
  )
}
