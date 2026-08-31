#!/usr/bin/env node

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createUpdateRequest, getDeploymentInfo, getUpdateRequestFile } from './deployment-api.mjs'

const defaultRoot = path.resolve(process.env.FREECUT_WEB_ROOT || path.join(process.cwd(), 'dist'))

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.onnx', 'application/octet-stream'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
])

const securityHeaders = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

function send(res, status, headers, body) {
  res.writeHead(status, { ...securityHeaders, ...headers })
  res.end(body)
}

function sendJson(res, status, value, includeBody = true) {
  const body = JSON.stringify(value)
  send(
    res,
    status,
    {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
    includeBody ? body : '',
  )
}

async function existingFile(candidate) {
  try {
    const info = await stat(candidate)
    return info.isFile() ? candidate : null
  } catch {
    return null
  }
}

// Resolves containment, SPA fallback, and missing assets as one security boundary.
// fallow-ignore-next-line complexity
async function resolveFile(rootDirectory, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }

  if (decoded.includes('\0')) return null
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const candidate = path.resolve(rootDirectory, relative)
  if (candidate !== rootDirectory && !candidate.startsWith(`${rootDirectory}${path.sep}`)) {
    return null
  }

  const direct = await existingFile(candidate)
  if (direct) return direct

  // Client-side routes are served by index.html, but missing asset requests
  // remain 404s so stale service-worker chunks cannot masquerade as HTML.
  if (!path.extname(relative)) return existingFile(path.join(rootDirectory, 'index.html'))
  return null
}

function isSameOriginUpdateRequest(req) {
  const fetchSite = req.headers['sec-fetch-site']
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none'
}

// The branch surface is the complete, deliberately small HTTP routing table.
// fallow-ignore-next-line complexity
async function handleRequest(req, res, rootDirectory, environment) {
  const url = new URL(req.url || '/', 'http://localhost')

  if (url.pathname === '/api/deployment') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, { Allow: 'GET, HEAD' }, 'Method Not Allowed')
      return
    }
    sendJson(res, 200, await getDeploymentInfo(environment), req.method !== 'HEAD')
    return
  }

  if (url.pathname === '/api/deployment/update') {
    if (req.method !== 'POST') {
      send(res, 405, { Allow: 'POST' }, 'Method Not Allowed')
      return
    }
    if (!isSameOriginUpdateRequest(req)) {
      sendJson(res, 403, { error: 'Cross-origin update requests are not allowed.' })
      return
    }
    const deployment = await getDeploymentInfo(environment)
    const requestFile = getUpdateRequestFile(environment)
    if (!deployment.updateEnabled || !requestFile) {
      sendJson(res, 503, { error: 'The managed Docker updater is unavailable.' })
      return
    }
    req.resume()
    const request = await createUpdateRequest(requestFile)
    sendJson(res, 202, { accepted: true, ...request })
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { Allow: 'GET, HEAD' }, 'Method Not Allowed')
    return
  }

  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true }, req.method !== 'HEAD')
    return
  }

  const filePath = await resolveFile(rootDirectory, url.pathname)
  if (!filePath) {
    send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found')
    return
  }

  const info = await stat(filePath)
  const extension = path.extname(filePath).toLowerCase()
  const cacheControl =
    path.basename(filePath) === 'index.html' || path.basename(filePath) === 'sw.js'
      ? 'no-cache'
      : 'public, max-age=31536000, immutable'
  const headers = {
    'Cache-Control': cacheControl,
    'Content-Length': String(info.size),
    'Content-Type': MIME_TYPES.get(extension) || 'application/octet-stream',
  }

  res.writeHead(200, { ...securityHeaders, ...headers })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}

export function createFreeCutWebServer({
  rootDirectory = defaultRoot,
  environment = process.env,
} = {}) {
  const resolvedRoot = path.resolve(rootDirectory)
  return http.createServer((req, res) => {
    void handleRequest(req, res, resolvedRoot, environment).catch((error) => {
      console.error(error)
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Internal Server Error' })
      } else {
        res.destroy(error)
      }
    })
  })
}

function isMainModule() {
  return (
    Boolean(process.argv[1]) &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  )
}

if (isMainModule()) {
  const host = process.env.FREECUT_WEB_HOST || '127.0.0.1'
  const port = Number(process.env.FREECUT_WEB_PORT || 8080)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('FREECUT_WEB_PORT must be an integer between 1 and 65535')
  }

  const server = createFreeCutWebServer()

  server.listen(port, host, () => {
    process.stdout.write(`FreeCut web app listening on http://${host}:${port}\n`)
  })

  function shutdown(signal) {
    server.close((error) => {
      if (error) {
        console.error(error)
        process.exitCode = 1
      }
    })
    process.stdout.write(`Received ${signal}; stopping FreeCut web app\n`)
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}
