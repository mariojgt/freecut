import assert from 'node:assert/strict'
import http from 'node:http'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { createFreeCutMcpServer } from './server.mjs'
import { createRequestListener, isAuthorized, isOriginAllowed } from './http-server.mjs'

const TOKEN = 'test-token-123'

async function withServer(run, { token = TOKEN } = {}) {
  const handler = createMcpHandler(
    () => createFreeCutMcpServer({ baseUrl: 'http://127.0.0.1:1/' }),
    { onerror: () => {} },
  )
  const server = http.createServer(createRequestListener({ handler, token, path: '/mcp' }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await run(base)
  } finally {
    server.close()
    await handler.close?.()
  }
}

const post = (base, body, headers = {}) =>
  fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${TOKEN}`,
      ...headers,
    },
    body: JSON.stringify(body),
  })

test('isAuthorized only accepts an exact bearer token', () => {
  assert.equal(isAuthorized(`Bearer ${TOKEN}`, TOKEN), true)
  assert.equal(isAuthorized('Bearer wrong-length', TOKEN), false)
  assert.equal(isAuthorized(`Bearer ${TOKEN}x`, TOKEN), false)
  assert.equal(isAuthorized(TOKEN, TOKEN), false, 'the Bearer scheme is required')
  assert.equal(isAuthorized(undefined, TOKEN), false)
})

test('an unset token disables auth entirely', () => {
  // Opt-in auth: no configured secret means every caller is allowed, including
  // one sending no Authorization header at all.
  assert.equal(isAuthorized(undefined, ''), true)
  assert.equal(isAuthorized('Bearer anything', ''), true)
})

test('an unauthenticated endpoint serves requests without a token', async () => {
  await withServer(
    async (base) => {
      const response = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' },
          },
        }),
      })
      assert.equal(response.status, 200)
      assert.match(await response.text(), /freecut/)
    },
    { token: '' },
  )
})

test('an unauthenticated endpoint still blocks cross-origin browsers', async () => {
  // Dropping auth must not drop DNS-rebinding protection.
  await withServer(
    async (base) => {
      const response = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
        body: '{}',
      })
      assert.equal(response.status, 403)
    },
    { token: '' },
  )
})

test('isOriginAllowed blocks cross-site browsers but allows non-browser clients', () => {
  assert.equal(isOriginAllowed(undefined, '127.0.0.1:8788'), true, 'MCP clients send no Origin')
  assert.equal(isOriginAllowed('http://127.0.0.1:8788', '127.0.0.1:8788'), true)
  assert.equal(isOriginAllowed('http://evil.example', '127.0.0.1:8788'), false)
  assert.equal(isOriginAllowed('not a url', '127.0.0.1:8788'), false)
})

test('the endpoint refuses unauthenticated and cross-origin traffic', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200)
    assert.equal((await fetch(`${base}/mcp`, { method: 'POST' })).status, 401)
    assert.equal((await post(base, {}, { authorization: 'Bearer nope' })).status, 401)
    assert.equal((await post(base, {}, { origin: 'http://evil.example' })).status, 403)
    assert.equal((await fetch(`${base}/nope`)).status, 404)
  })
})

test('a 401 advertises the bearer scheme', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/mcp`, { method: 'POST' })
    assert.match(response.headers.get('www-authenticate') ?? '', /Bearer/)
  })
})

test('an authorized client completes the MCP handshake', async () => {
  await withServer(async (base) => {
    const response = await post(base, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    })
    assert.equal(response.status, 200)
    assert.match(await response.text(), /freecut/)
  })
})

test('an authorized client can list the tool surface over HTTP', async () => {
  await withServer(async (base) => {
    await post(base, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    })
    const response = await post(base, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const body = await response.text()
    assert.equal(response.status, 200)
    for (const tool of ['list_blocks', 'edit_project', 'render_project']) {
      assert.ok(body.includes(tool), `expected ${tool} in the HTTP tool surface`)
    }
  })
})

test('the server process starts with no token and no API to autostart', async () => {
  // A regression guard for the startup path: the request-layer tests above all
  // construct the listener directly, so a `main()` that refused to boot without
  // a token passed every one of them while the container could not start.
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./http-server.mjs', import.meta.url)), '--port', '8791'],
    {
      env: {
        ...process.env,
        FREECUT_MCP_AUTOSTART: '0',
        FREECUT_MCP_TOKEN: '',
        FREECUT_API_URL: 'http://127.0.0.1:9/',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  )
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })

  try {
    let status = 0
    for (let attempt = 0; attempt < 40 && status !== 200; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (child.exitCode !== null) break
      status = await fetch('http://127.0.0.1:8791/health')
        .then((response) => response.status)
        .catch(() => 0)
    }
    assert.equal(status, 200, `server never became healthy. stderr:\n${stderr}`)
    assert.match(stderr, /auth: DISABLED/)
  } finally {
    child.kill('SIGTERM')
  }
})
