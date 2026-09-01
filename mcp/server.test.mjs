import assert from 'node:assert/strict'
import test from 'node:test'
import { InMemoryTransport, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server'
import { createFreeCutMcpServer } from './server.mjs'
import { FreeCutApiClient } from './freecut-api-client.mjs'

async function connect(server) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const pending = new Map()
  let nextId = 1
  clientTransport.onmessage = (message) => {
    if ('id' in message && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  }
  await clientTransport.start()
  await server.connect(serverTransport)

  const request = (method, params = {}) => {
    const id = nextId++
    return new Promise((resolve) => {
      pending.set(id, resolve)
      void clientTransport.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  const initialized = await request('initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'freecut-test', version: '1.0.0' },
  })
  assert.ok(initialized.result)
  await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return { clientTransport, request }
}

test('MCP server lists the full editing tool surface and calls the headless API', async (t) => {
  const calls = []
  const apiClient = {
    async requestJson(pathname, options) {
      calls.push({ pathname, options })
      return { ok: true, projects: [{ id: 'project-1', revision: 'sha256:' + 'a'.repeat(64) }] }
    },
    async requestFile() {
      throw new Error('not used')
    },
  }
  const server = createFreeCutMcpServer({ apiClient })
  const { clientTransport, request } = await connect(server)
  t.after(async () => {
    await clientTransport.close()
    await server.close()
  })

  const listed = await request('tools/list')
  const names = listed.result.tools.map((tool) => tool.name)
  assert.deepEqual(names, [
    'get_capabilities',
    'list_blocks',
    'export_block',
    'copy_block',
    'list_projects',
    'get_project',
    'create_project',
    'update_project',
    'edit_project',
    'list_media',
    'get_media',
    'probe_media',
    'dump_layout',
    'grab_frame',
    'sample_motion',
    'check_scene',
    'contact_sheet',
    'render_project',
  ])

  const called = await request('tools/call', {
    name: 'list_projects',
    arguments: {},
  })
  assert.equal(called.result.isError, undefined)
  assert.equal(called.result.structuredContent.projects[0].id, 'project-1')
  assert.equal(calls[0].pathname, '/v1/projects?limit=100')
})

test('MCP edit_project is a dry run by default and forwards revision controls', async (t) => {
  const calls = []
  const apiClient = {
    async requestJson(pathname, options) {
      calls.push({ pathname, options })
      return { ok: true, persisted: false, results: [{ ok: true, op: 'split' }] }
    },
    async requestFile() {
      throw new Error('not used')
    },
  }
  const server = createFreeCutMcpServer({ apiClient })
  const { clientTransport, request } = await connect(server)
  t.after(async () => {
    await clientTransport.close()
    await server.close()
  })

  const called = await request('tools/call', {
    name: 'edit_project',
    arguments: {
      projectId: 'project-1',
      operations: [{ op: 'split', id: 'clip-1', frame: 30 }],
    },
  })

  assert.equal(called.result.isError, undefined)
  assert.equal(called.result.content[0].text, 'Dry run complete; the workspace was not changed.')
  assert.deepEqual(calls[0], {
    pathname: '/v1/projects/project-1/edit',
    options: {
      method: 'POST',
      body: {
        ops: [{ op: 'split', id: 'clip-1', frame: 30, callerId: 'op1' }],
        persist: false,
        expectedRevision: undefined,
        force: false,
      },
    },
  })
})

test('API client sends bearer auth and surfaces structured API errors', async () => {
  const requests = []
  const client = new FreeCutApiClient({
    baseUrl: 'http://127.0.0.1:8787',
    token: 'secret-token',
    fetchImpl: async (url, init) => {
      requests.push({ url, init })
      return new Response(
        JSON.stringify({ error: { code: 'REVISION_CONFLICT', message: 'Revision changed' } }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      )
    },
  })

  await assert.rejects(
    () => client.requestJson('/v1/projects/project-1'),
    (error) => error.code === 'REVISION_CONFLICT' && error.status === 409,
  )
  assert.equal(requests[0].init.headers.Authorization, 'Bearer secret-token')
})

test('edit_project fills in missing callerIds without disturbing explicit ones', async (t) => {
  const calls = []
  const apiClient = {
    async requestJson(pathname, options) {
      calls.push({ pathname, options })
      return { ok: true, persisted: false, results: [] }
    },
    async requestFile() {
      throw new Error('not used')
    },
  }
  const server = createFreeCutMcpServer({ apiClient })
  const { clientTransport, request } = await connect(server)
  t.after(async () => {
    await clientTransport.close()
    await server.close()
  })

  await request('tools/call', {
    name: 'edit_project',
    arguments: {
      projectId: 'project-1',
      operations: [
        { op: 'addTrack' },
        { op: 'addTrack', callerId: 'op2' },
        { op: 'addText', text: 'hello' },
      ],
    },
  })

  assert.deepEqual(
    calls[0].options.body.ops.map((op) => op.callerId),
    ['op1', 'op2', 'op3'],
  )
})

test('tool failures surface structured validation fields', async (t) => {
  const apiClient = {
    async requestJson() {
      throw Object.assign(new Error('Request validation failed'), {
        details: {
          error: {
            fields: [{ path: 'ops.0.frame', message: 'must be a non-negative integer' }],
          },
        },
      })
    },
    async requestFile() {
      throw new Error('not used')
    },
  }
  const server = createFreeCutMcpServer({ apiClient })
  const { clientTransport, request } = await connect(server)
  t.after(async () => {
    await clientTransport.close()
    await server.close()
  })

  const called = await request('tools/call', {
    name: 'edit_project',
    arguments: { projectId: 'project-1', operations: [{ op: 'split' }] },
  })

  assert.equal(called.result.isError, true)
  assert.match(called.result.content[0].text, /Request validation failed/)
  assert.match(called.result.content[0].text, /ops\.0\.frame: must be a non-negative integer/)
})

test('API client sends an Idempotency-Key on mutating requests only', async () => {
  const requests = []
  const client = new FreeCutApiClient({
    baseUrl: 'http://127.0.0.1:8787',
    fetchImpl: async (url, init) => {
      requests.push({ url, init })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  await client.requestJson('/v1/projects')
  await client.requestJson('/v1/projects', { method: 'POST', body: { name: 'Project' } })
  await client.requestJson('/v1/projects', { method: 'POST', body: { name: 'Project' } })

  assert.equal(requests[0].init.headers['Idempotency-Key'], undefined)
  const [first, second] = [requests[1], requests[2]].map(
    (entry) => entry.init.headers['Idempotency-Key'],
  )
  assert.match(first, /^[\x20-\x7e]{1,128}$/)
  assert.match(second, /^[\x20-\x7e]{1,128}$/)
  assert.notEqual(first, second)
})
