import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createMediaServer } from './media-server.mjs'

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-media-server-'))

test('serves each supported image type with a renderable Content-Type', async (t) => {
  const files = new Map()
  for (const [id, name, body] of [
    ['svg-1', 'art.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>'],
    ['png-1', 'art.png', 'not-really-a-png'],
  ]) {
    const file = path.join(workspace, name)
    fs.writeFileSync(file, body)
    files.set(id, file)
  }
  const server = await createMediaServer(files)
  t.after(() => server.close())

  // An <img> refuses SVG served without image/svg+xml, which renders the frame
  // empty rather than failing loudly.
  const svg = await fetch(server.url('svg-1'))
  assert.equal(svg.status, 200)
  assert.equal(svg.headers.get('content-type'), 'image/svg+xml')

  const png = await fetch(server.url('png-1'))
  assert.equal(png.headers.get('content-type'), 'image/png')
})
