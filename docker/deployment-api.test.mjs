import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createUpdateRequest, getDeploymentInfo, getUpdateRequestFile } from './deployment-api.mjs'

function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'freecut-deployment-api-'))
  const requestDirectory = path.join(root, 'run')
  const requestFile = path.join(requestDirectory, 'update-request')
  mkdirSync(requestDirectory)
  return { root, requestDirectory, requestFile }
}

test('reports a writable managed Docker deployment without exposing its host path', async (t) => {
  const fixture = createFixture()
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }))

  const info = await getDeploymentInfo({
    FREECUT_RUNTIME: 'docker',
    FREECUT_RELEASE_TAG: 'v1.2.3',
    FREECUT_UPDATE_REQUEST_FILE: fixture.requestFile,
  })

  assert.deepEqual(info, { runtime: 'docker', releaseTag: 'v1.2.3', updateEnabled: true })
  assert.equal('requestFile' in info, false)
})

test('does not enable the control outside a writable managed Docker deployment', async (t) => {
  const fixture = createFixture()
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }))

  assert.equal(
    (
      await getDeploymentInfo({
        FREECUT_RUNTIME: 'standalone',
        FREECUT_UPDATE_REQUEST_FILE: fixture.requestFile,
      })
    ).updateEnabled,
    false,
  )
  assert.equal(
    (
      await getDeploymentInfo({
        FREECUT_RUNTIME: 'docker',
        FREECUT_UPDATE_REQUEST_FILE: path.join(fixture.root, 'missing', 'update-request'),
      })
    ).updateEnabled,
    false,
  )
})

test('writes an atomic host update request', async (t) => {
  const fixture = createFixture()
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }))
  const requestedAt = new Date('2026-08-31T17:00:00.000Z')

  const result = await createUpdateRequest(fixture.requestFile, requestedAt)

  assert.deepEqual(result, { requestedAt: requestedAt.toISOString() })
  assert.deepEqual(JSON.parse(readFileSync(fixture.requestFile, 'utf8')), result)
})

test('rejects a relative update request path', async () => {
  assert.equal(getUpdateRequestFile({ FREECUT_UPDATE_REQUEST_FILE: 'run/update-request' }), null)
  await assert.rejects(createUpdateRequest('run/update-request'), /must be absolute/)
})
