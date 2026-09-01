import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createFreeCutWebServer } from './web-server.mjs'

async function createFixture(t, environment = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'freecut-web-server-'))
  const dist = path.join(root, 'dist')
  const run = path.join(root, 'run')
  const requestFile = path.join(run, 'update-request')
  mkdirSync(dist)
  mkdirSync(run)
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>FreeCut test</title>')

  const server = createFreeCutWebServer({
    rootDirectory: dist,
    environment: {
      FREECUT_RUNTIME: 'docker',
      FREECUT_RELEASE_TAG: 'v1.2.3',
      FREECUT_UPDATE_REQUEST_FILE: requestFile,
      ...environment,
    },
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address === 'object')

  t.after(async () => {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    rmSync(root, { recursive: true, force: true })
  })

  return { baseUrl: `http://127.0.0.1:${address.port}`, requestFile }
}

test('serves health, static files, and SPA routes', async (t) => {
  const fixture = await createFixture(t)

  const health = await fetch(`${fixture.baseUrl}/health`)
  assert.deepEqual(await health.json(), { ok: true })

  const route = await fetch(`${fixture.baseUrl}/projects`)
  assert.equal(route.status, 200)
  assert.match(await route.text(), /FreeCut test/)

  const missingAsset = await fetch(`${fixture.baseUrl}/assets/missing.js`)
  assert.equal(missingAsset.status, 404)
})

test('exposes managed Docker deployment information without the request path', async (t) => {
  const fixture = await createFixture(t)

  const response = await fetch(`${fixture.baseUrl}/api/deployment`)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    runtime: 'docker',
    releaseTag: 'v1.2.3',
    updateEnabled: true,
    mcp: { port: 8788, reachableFromNetwork: false },
  })
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('accepts a same-origin update request and writes the host signal', async (t) => {
  const fixture = await createFixture(t)

  const response = await fetch(`${fixture.baseUrl}/api/deployment/update`, { method: 'POST' })

  assert.equal(response.status, 202)
  assert.equal((await response.json()).accepted, true)
  assert.equal(existsSync(fixture.requestFile), true)
  assert.equal(typeof JSON.parse(readFileSync(fixture.requestFile, 'utf8')).requestedAt, 'string')
})

test('rejects a cross-origin browser update request', async (t) => {
  const fixture = await createFixture(t)

  const response = await fetch(`${fixture.baseUrl}/api/deployment/update`, {
    method: 'POST',
    headers: { 'Sec-Fetch-Site': 'cross-site' },
  })

  assert.equal(response.status, 403)
  assert.equal(existsSync(fixture.requestFile), false)
})
