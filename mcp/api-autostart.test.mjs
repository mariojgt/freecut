import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiSupervisor } from './api-autostart.mjs'

function harness(overrides = {}) {
  const logs = []
  return {
    logs,
    supervisor: new ApiSupervisor({
      baseUrl: 'http://127.0.0.1:8787',
      workspace: '',
      log: (message) => logs.push(message),
      sleep: async () => {},
      ...overrides,
    }),
  }
}

const healthy = async () => ({ ok: true })
const dead = async () => {
  throw new Error('ECONNREFUSED')
}

test('attaches to an API that is already answering', async () => {
  const { supervisor, logs } = harness({ fetchImpl: healthy })
  assert.equal(await supervisor.ensure(), 'attached')
  assert.match(logs.join('\n'), /attached/)
})

test('never starts a competing server when one is already up', async () => {
  // A Docker deployment or a second client must not get a rival process
  // fighting for the same port and workspace.
  let spawned = false
  const { supervisor } = harness({
    fetchImpl: healthy,
    workspace: '/tmp',
    now: () => {
      spawned = true
      return Date.now()
    },
  })
  assert.equal(await supervisor.ensure(), 'attached')
  assert.equal(spawned, false)
})

test('reports unavailable when no workspace is configured', async () => {
  const { supervisor, logs } = harness({ fetchImpl: dead })
  assert.equal(await supervisor.ensure(), 'unavailable')
  assert.match(logs.join('\n'), /FREECUT_WORKSPACE is unset/)
})

test('reports unavailable when the workspace path does not exist', async () => {
  const { supervisor, logs } = harness({
    fetchImpl: dead,
    workspace: '/definitely/not/a/real/workspace',
  })
  assert.equal(await supervisor.ensure(), 'unavailable')
  assert.match(logs.join('\n'), /does not exist/)
})

test('honours an explicit opt-out', async () => {
  const { supervisor } = harness({ fetchImpl: dead, workspace: '/tmp', autostart: false })
  assert.equal(await supervisor.ensure(), 'unavailable')
})

test('stopping without having started anything is a no-op', async () => {
  const { supervisor } = harness({ fetchImpl: healthy })
  await supervisor.ensure()
  await supervisor.stop()
})

test('a non-ok health response counts as down', async () => {
  const { supervisor } = harness({ fetchImpl: async () => ({ ok: false }) })
  assert.equal(await supervisor.ensure(), 'unavailable')
})

test('trailing slashes in the API url do not double up on /health', async () => {
  const seen = []
  const { supervisor } = harness({
    baseUrl: 'http://127.0.0.1:9999/',
    fetchImpl: async (url) => {
      seen.push(url)
      return { ok: true }
    },
  })
  await supervisor.ensure()
  assert.deepEqual(seen, ['http://127.0.0.1:9999/health'])
})

test('a signal reaps the child AND terminates this process', async () => {
  // Registering a handler replaces Node's default terminate behaviour, so a
  // supervisor that only reaps its child would survive SIGTERM and become
  // unkillable by an ordinary shutdown.
  const exits = []
  const supervisor = new ApiSupervisor({
    workspace: '/tmp',
    fetchImpl: async () => ({ ok: true }),
    log: () => {},
    exitProcess: (status) => exits.push(status),
  })
  await supervisor.ensure()

  const before = process.listenerCount('SIGTERM')
  supervisor._installCleanupForTest()
  process.emit('SIGTERM')
  assert.deepEqual(exits, [143])

  process.emit('SIGINT')
  supervisor._installCleanupForTest()
  process.emit('SIGINT')
  assert.ok(exits.includes(130), 'SIGINT should exit with 130')

  await supervisor.stop()
  assert.equal(process.listenerCount('SIGTERM'), before, 'handlers must be removed on stop')
})
