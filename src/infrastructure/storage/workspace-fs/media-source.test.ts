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
    expect(await (await readMediaSource('m1'))?.text()).toBe('<svg/>')
  })
})
