import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LiveFollowState } from '../hooks/use-live-project-follow'
import { LiveFollowPage } from './live-follow-page'

const followState: LiveFollowState = {
  status: 'live',
  revision: 'sha256:abcdef1234567890',
  project: { name: 'Rocket Launch', width: 1280, height: 720, fps: 30 },
}

vi.mock('../hooks/use-live-project-follow', () => ({
  useLiveProjectFollow: () => followState,
}))

vi.mock('../deps/preview-contract', () => ({
  VideoPreview: () => <div data-testid="video-preview" />,
  PlaybackControls: () => <div data-testid="playback-controls" />,
  TimecodeDisplay: () => <div data-testid="timecode-display" />,
}))

vi.mock('../deps/timeline-contract', () => ({
  hydrateTimelineStoresFromProject: vi.fn(),
  useItemsStore: (selector: (state: { maxItemEndFrame: number }) => unknown) =>
    selector({ maxItemEndFrame: 90 }),
}))

describe('LiveFollowPage', () => {
  it('renders the banner, preview, and transport for a live project', () => {
    render(<LiveFollowPage projectId="proj1" />)

    expect(screen.getByText(/LIVE/)).toBeInTheDocument()
    expect(screen.getByText('Rocket Launch')).toBeInTheDocument()
    expect(screen.getByTestId('video-preview')).toBeInTheDocument()
    expect(screen.getByTestId('playback-controls')).toBeInTheDocument()
    expect(screen.getByTestId('timecode-display')).toBeInTheDocument()
    expect(screen.getByRole('slider')).toBeInTheDocument()
  })

  it('renders the waiting state when the project is not on the server yet', () => {
    followState.status = 'not-found'
    followState.project = null
    followState.revision = null
    render(<LiveFollowPage projectId="proj1" />)

    expect(screen.getByText('proj1')).toBeInTheDocument()
    expect(screen.queryByTestId('video-preview')).not.toBeInTheDocument()
  })
})
