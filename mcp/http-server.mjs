#!/usr/bin/env node

// FreeCut MCP server over Streamable HTTP.
//
// The stdio entry (mcp/server.mjs) is for a client on the same machine: it is
// spawned as a child process and has no network surface. This entry is for
// hosting FreeCut on ANOTHER machine, where the client connects by URL.
//
// Usage:
//   FREECUT_WORKSPACE=/path node mcp/http-server.mjs
//   FREECUT_MCP_TOKEN=<secret> FREECUT_WORKSPACE=/path node mcp/http-server.mjs
//
// Under Docker this runs as the supervised `mcp` service, which restarts it
// after a crash or a host reboot; there it points at the API container with
// FREECUT_API_URL and FREECUT_MCP_AUTOSTART=0.
//
// Options:
//   --port <n>     Listen port (default 8788, or FREECUT_MCP_PORT)
//   --host <addr>  Bind address (default 127.0.0.1, or FREECUT_MCP_HOST)
//   --path <p>     Endpoint path (default /mcp)
//
// Auth is OPTIONAL. Set FREECUT_MCP_TOKEN to require a bearer token; leave it
// unset and the endpoint serves anyone who can reach the port. Unauthenticated
// is reasonable on loopback or a trusted network, or behind a proxy that
// authenticates for you — but this endpoint can read and write every project in
// the workspace and render files from it, so an open port on an untrusted
// network hands all of that to whoever finds it. The server says which mode it
// started in, and says it louder when bound past loopback.
//
// Still on by default regardless of auth:
//   * binds to loopback unless a host is passed explicitly
//   * Origin is validated, so a browser on a victim's machine cannot reach a
//     loopback instance by rebinding DNS
//
// It speaks plain HTTP. Terminate TLS at a reverse proxy before this crosses
// any network you do not fully control; a bearer token over cleartext is
// readable by anything on the path.
import http from 'node:http'
import process from 'node:process'
import { Readable } from 'node:stream'
import { timingSafeEqual } from 'node:crypto'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { createFreeCutMcpServer } from './server.mjs'
import { ApiSupervisor } from './api-autostart.mjs'

const DEFAULT_PORT = 8788
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PATH = '/mcp'

function parseOptions(argv) {
  const options = {
    port: Number(process.env.FREECUT_MCP_PORT || DEFAULT_PORT),
    host: process.env.FREECUT_MCP_HOST || DEFAULT_HOST,
    path: process.env.FREECUT_MCP_PATH || DEFAULT_PATH,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--port') {
      options.port = Number(value)
      index += 1
    } else if (flag === '--host') {
      options.host = String(value)
      index += 1
    } else if (flag === '--path') {
      options.path = String(value)
      index += 1
    } else throw new Error(`Unknown option: ${flag}`)
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error('--port must be a valid TCP port')
  }
  if (!options.path.startsWith('/')) throw new Error('--path must start with /')
  return options
}

/**
 * Constant-time bearer check, so a wrong token cannot be recovered by timing.
 *
 * An empty `expected` means auth is disabled and every request is allowed —
 * the caller decides that by whether it sets a token, never by accident here.
 */
export function isAuthorized(header, expected) {
  if (!expected) return true
  const match = /^Bearer (.+)$/.exec(header ?? '')
  if (!match) return false
  const provided = Buffer.from(match[1], 'utf8')
  const secret = Buffer.from(expected, 'utf8')
  if (provided.length !== secret.length) return false
  return timingSafeEqual(provided, secret)
}

/**
 * Reject cross-site requests aimed at this endpoint.
 *
 * A page in someone's browser can resolve a hostname to 127.0.0.1 and POST to a
 * loopback service. Requiring a same-origin or absent Origin keeps a browser
 * from driving an MCP endpoint the user never intended to expose.
 */
export function isOriginAllowed(origin, host) {
  if (!origin) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function toWebRequest(req, host) {
  const url = new URL(req.url ?? '/', `http://${host}`)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const entry of value) headers.append(key, entry)
    else if (value !== undefined) headers.set(key, value)
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  return new Request(url, {
    method: req.method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
  })
}

async function sendWebResponse(res, response) {
  const headers = {}
  for (const [key, value] of response.headers) headers[key] = value
  res.writeHead(response.status, headers)
  if (!response.body) {
    res.end()
    return
  }
  // Streamed rather than buffered: an MCP exchange may upgrade to SSE, and
  // buffering would hold notifications until the call completed.
  for await (const chunk of response.body) res.write(Buffer.from(chunk))
  res.end()
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

export function createRequestListener({ handler, token, path, log = () => {} }) {
  return async (req, res) => {
    const host = req.headers.host ?? ''
    const url = new URL(req.url ?? '/', `http://${host || 'localhost'}`)

    if (url.pathname === '/health') {
      sendJson(res, 200, { ok: true, transport: 'streamable-http', path })
      return
    }
    if (url.pathname !== path) {
      sendJson(res, 404, { ok: false, error: 'Not found' })
      return
    }
    if (!isOriginAllowed(req.headers.origin, host)) {
      log(`rejected cross-origin request from ${req.headers.origin}`)
      sendJson(res, 403, { ok: false, error: 'Origin not allowed' })
      return
    }
    if (!isAuthorized(req.headers.authorization, token)) {
      res.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer realm="freecut-mcp"',
      })
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }))
      return
    }

    try {
      // createMcpHandler returns { fetch, notify, bus, close }, not a bare
      // function — the endpoint dispatches through its fetch member.
      await sendWebResponse(res, await handler.fetch(toWebRequest(req, host)))
    } catch (error) {
      log(`request failed: ${error instanceof Error ? error.message : String(error)}`)
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Internal error' })
      else res.end()
    }
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const token = process.env.FREECUT_MCP_TOKEN || ''
  const log = (message) => console.error('[freecut-mcp-http]', message)
  const supervisor = new ApiSupervisor({ log })
  await supervisor.ensure()

  const handler = createMcpHandler(() => createFreeCutMcpServer(), {
    onerror: (error) => log(error.message),
  })
  const server = http.createServer(
    createRequestListener({ handler, token, path: options.path, log }),
  )

  const isLoopback = options.host === '127.0.0.1' || options.host === 'localhost'
  server.listen(options.port, options.host, () => {
    log(`listening on http://${options.host}:${options.port}${options.path}`)
    log(token ? 'auth: bearer token required' : 'auth: DISABLED (no FREECUT_MCP_TOKEN set)')
    if (!isLoopback) {
      log('bound beyond loopback — put TLS in front of this before it leaves the host')
      if (!token) {
        log(
          'WARNING: reachable on the network with no auth. Anyone who can reach this port can ' +
            'read and write every project in the workspace. Set FREECUT_MCP_TOKEN to require one.',
        )
      }
    }
  })

  const shutdown = (status) => () => {
    server.close()
    void handler.close?.()
    void supervisor.stop()
    process.exit(status)
  }
  process.once('SIGINT', shutdown(130))
  process.once('SIGTERM', shutdown(143))
}

const isEntrypoint = process.argv[1]?.endsWith('http-server.mjs')
if (isEntrypoint) {
  main().catch((error) => {
    console.error('[freecut-mcp-http]', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
