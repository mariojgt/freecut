import { constants } from 'node:fs'
import { access, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const DOCKER_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** Matches the compose default, so an unset port still describes the stack. */
const DEFAULT_MCP_PORT = 8788

function normalizeMcpPort(value) {
  // Number() trims and rejects trailing garbage, both of which parseInt would
  // have accepted as a port.
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_MCP_PORT
}

/**
 * A loopback bind answers only on the Docker host. A client on another machine
 * then fails to connect no matter how correct its config is, so the editor
 * needs to know this to say so rather than hand out an address that cannot work.
 */
function isNetworkReachableBind(value) {
  const bind = value?.trim() || '127.0.0.1'
  return bind === '0.0.0.0' || bind === '::'
}

export function getUpdateRequestFile(environment = process.env) {
  const value = environment.FREECUT_UPDATE_REQUEST_FILE?.trim()
  return value && path.isAbsolute(value) ? path.resolve(value) : null
}

function normalizeReleaseTag(value) {
  const tag = value?.trim()
  return tag && DOCKER_TAG_PATTERN.test(tag) ? tag : null
}

async function canWriteUpdateRequest(requestFile) {
  if (!requestFile) return false
  try {
    const directory = path.dirname(requestFile)
    const info = await stat(directory)
    if (!info.isDirectory()) return false
    await access(directory, constants.W_OK)
    return true
  } catch {
    return false
  }
}

export async function getDeploymentInfo(environment = process.env) {
  const runtime = environment.FREECUT_RUNTIME === 'docker' ? 'docker' : 'standalone'
  const requestFile = getUpdateRequestFile(environment)
  return {
    runtime,
    releaseTag: normalizeReleaseTag(environment.FREECUT_RELEASE_TAG),
    updateEnabled: runtime === 'docker' && (await canWriteUpdateRequest(requestFile)),
    mcp: {
      port: normalizeMcpPort(environment.FREECUT_MCP_PORT),
      reachableFromNetwork: isNetworkReachableBind(environment.FREECUT_MCP_BIND),
    },
  }
}

export async function createUpdateRequest(requestFile, requestedAt = new Date()) {
  if (!requestFile || !path.isAbsolute(requestFile)) {
    throw new Error('The Docker update request path must be absolute.')
  }

  const directory = path.dirname(requestFile)
  const info = await stat(directory)
  if (!info.isDirectory()) throw new Error('The Docker update request directory is unavailable.')
  await access(directory, constants.W_OK)

  const payload = { requestedAt: requestedAt.toISOString() }
  const temporaryFile = path.join(directory, `.update-request.${process.pid}.${randomUUID()}`)
  try {
    await writeFile(temporaryFile, `${JSON.stringify(payload)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(temporaryFile, requestFile)
  } finally {
    await unlink(temporaryFile).catch((error) => {
      if (error?.code !== 'ENOENT') throw error
    })
  }
  return payload
}
