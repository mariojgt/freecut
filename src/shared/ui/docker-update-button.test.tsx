import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from 'sonner'
import { DOCKER_UPDATE_REQUESTED_EVENT } from '@/shared/deployment/docker-update-session'
import { DockerUpdateButton } from './docker-update-button'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('DockerUpdateButton', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    sessionStorage.clear()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  it('stays hidden when the managed Docker updater is unavailable', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ runtime: 'standalone', releaseTag: null, updateEnabled: false }),
    )

    render(<DockerUpdateButton />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('docker-update-button')).not.toBeInTheDocument()
  })

  it('requests an update with one click and arms automatic save-and-reload', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ runtime: 'docker', releaseTag: 'v1.2.3', updateEnabled: true }),
      )
      .mockResolvedValueOnce(jsonResponse({ accepted: true }, 202))
    const updateRequested = vi.fn()
    window.addEventListener(DOCKER_UPDATE_REQUESTED_EVENT, updateRequested, { once: true })

    render(<DockerUpdateButton />)
    const button = await screen.findByRole('button', { name: 'Check for a Docker update' })
    fireEvent.click(button)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/deployment/update',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(updateRequested).toHaveBeenCalledTimes(1)
    expect(sessionStorage.length).toBe(1)
    expect(toast.success).toHaveBeenCalledWith(
      'Update check started',
      expect.objectContaining({ description: expect.any(String) }),
    )
  })
})
