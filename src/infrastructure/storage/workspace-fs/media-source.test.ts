// @vitest-environment node

import { afterEach, describe, expect, it } from 'vite-plus/test'
import '../test-utils/logger-test-mocks'
import { writeBlob } from './fs-primitives'
import { hasMediaSource, readMediaSource, writeMediaSource } from './media-source'
import { setWorkspaceRoot } from './root'
import { asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'

afterEach(() => {
  setWorkspaceRoot(null)
})

describe('workspace-fs media sources', () => {
  it('ignores macOS sidecars and still writes the real source', async () => {
    const root = createRoot()
    const handle = asHandle(root)
    setWorkspaceRoot(handle)
    await writeBlob(handle, ['media', 'm1', '._clip.svg'], new Blob(['apple-double']))
    await writeBlob(handle, ['media', 'm1', '.DS_Store'], new Blob(['finder-metadata']))

    expect(await hasMediaSource('m1')).toBe(false)
    expect(await readMediaSource('m1')).toBeNull()

    await writeMediaSource('m1', new Blob(['<svg/>']), 'clip.svg', {
      strict: true,
    })
    expect(await hasMediaSource('m1')).toBe(true)
    expect(await readFileText(root, 'media', 'm1', 'clip.svg')).toBe('<svg/>')
    expect(await readFileText(root, 'media', 'm1', '.clip.svg.freecut-tmp')).toBeNull()
    expect(await (await readMediaSource('m1'))?.text()).toBe('<svg/>')
  })

  it('ignores an interrupted atomic-write temporary file', async () => {
    const root = createRoot()
    const handle = asHandle(root)
    setWorkspaceRoot(handle)
    await writeBlob(handle, ['media', 'm1', '.clip.svg.freecut-tmp'], new Blob(['partial']))

    expect(await hasMediaSource('m1')).toBe(false)
    expect(await readMediaSource('m1')).toBeNull()
  })

  it('commits source bytes when the selected filesystem cannot rename files', async () => {
    const root = createRoot('workspace', 'NotSupportedError')
    const handle = asHandle(root)
    setWorkspaceRoot(handle)

    await writeMediaSource('m1', new Blob(['durable']), 'clip.svg', { strict: true })

    expect(await readFileText(root, 'media', 'm1', 'clip.svg')).toBe('durable')
    expect(await readFileText(root, 'media', 'm1', '.clip.svg.freecut-tmp')).toBeNull()
  })
})
