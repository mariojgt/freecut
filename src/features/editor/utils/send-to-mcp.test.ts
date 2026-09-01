import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HeadlessApiError, UNSEEN_SERVER_COPY } from '@/shared/deployment/headless-api'
import { sendProjectToMcpWorkspace } from './send-to-mcp'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  getProject: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mocks.success(...args),
    warning: (...args: unknown[]) => mocks.warning(...args),
    error: (...args: unknown[]) => mocks.error(...args),
  },
}))

vi.mock('@/i18n', () => ({ i18n: { t: (key: string) => key } }))

vi.mock('@/shared/deployment/headless-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/deployment/headless-api')>()),
  pushProjectToHeadlessWorkspace: (...args: unknown[]) => mocks.push(...args) as never,
}))

vi.mock('@/infrastructure/storage', () => ({
  getProject: (...args: unknown[]) => mocks.getProject(...args) as never,
}))

const unseenCopy = () => new HeadlessApiError('already there', 409, UNSEEN_SERVER_COPY)

describe('sendProjectToMcpWorkspace', () => {
  const save = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getProject.mockResolvedValue({ id: 'proj1' })
  })

  it('reports the pushed revision through the callback', async () => {
    mocks.push.mockResolvedValue('sha256:new')
    const onPushed = vi.fn()

    await expect(sendProjectToMcpWorkspace('proj1', save, 'sha256:base', onPushed)).resolves.toBe(
      'sha256:new',
    )
    expect(mocks.push).toHaveBeenCalledWith({ id: 'proj1' }, 'sha256:base')
    expect(onPushed).toHaveBeenCalledWith('sha256:new')
    expect(mocks.success).toHaveBeenCalledTimes(1)
  })

  it('offers an explicit overwrite instead of failing on an unseen server copy', async () => {
    mocks.push.mockRejectedValueOnce(unseenCopy())
    const onPushed = vi.fn()

    await expect(sendProjectToMcpWorkspace('proj1', save, null, onPushed)).resolves.toBeNull()
    expect(mocks.error).not.toHaveBeenCalled()
    expect(mocks.warning).toHaveBeenCalledTimes(1)
    expect(onPushed).not.toHaveBeenCalled()

    // Taking the offered action pushes again with discover-or-create semantics.
    mocks.push.mockResolvedValue('sha256:forced')
    const options = mocks.warning.mock.calls[0]?.[1] as { action: { onClick: () => void } }
    options.action.onClick()
    await vi.waitFor(() => expect(onPushed).toHaveBeenCalledWith('sha256:forced'))
    expect(mocks.push).toHaveBeenLastCalledWith({ id: 'proj1' }, undefined)
  })

  it('still surfaces unexpected failures as errors', async () => {
    mocks.push.mockRejectedValue(new Error('network down'))

    await expect(sendProjectToMcpWorkspace('proj1', save, null)).resolves.toBeNull()
    expect(mocks.error).toHaveBeenCalledTimes(1)
    expect(mocks.warning).not.toHaveBeenCalled()
  })
})
