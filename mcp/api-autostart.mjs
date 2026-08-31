import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Bring the FreeCut HTTP API up on demand.
 *
 * An MCP client already spawns the stdio server for you, so the only thing
 * standing between "configure once" and "it just works" is the API process that
 * server talks to. This supervises it: if the API answers, we attach to it and
 * touch nothing; if it does not and a workspace is configured, we start one and
 * own its lifetime.
 *
 * Attaching to an already-running API matters — a Docker deployment, a shared
 * team instance, or a second editor window must not get a competing server
 * fighting for the same port and workspace lock.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HEALTH_TIMEOUT_MS = 1500
/** First run may build `dist/`, which is far slower than a warm start. */
const READY_TIMEOUT_MS = 240_000
const POLL_INTERVAL_MS = 500

async function isApiHealthy(baseUrl, fetchImpl = globalThis.fetch) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(`${baseUrl}/health`, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function portOf(baseUrl) {
  const url = new URL(baseUrl)
  return url.port || (url.protocol === 'https:' ? '443' : '80')
}

/**
 * Start the API and wait for it to answer.
 *
 * stdout is routed to stderr on purpose: this process speaks MCP over stdout,
 * and one stray log line from the child would corrupt the protocol stream.
 */
function spawnApi({ workspace, baseUrl, log }) {
  const child = spawn(
    process.execPath,
    [
      path.join(REPO_ROOT, 'headless', 'serve.mjs'),
      '--workspace',
      workspace,
      '--port',
      portOf(baseUrl),
      '--build',
    ],
    { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
  )
  child.stdout.on('data', (chunk) => log(String(chunk).trimEnd()))
  child.stderr.on('data', (chunk) => log(String(chunk).trimEnd()))
  return child
}

export class ApiSupervisor {
  #child = null
  #cleanup = null
  #onSigint = null
  #onSigterm = null

  constructor({
    baseUrl = process.env.FREECUT_API_URL || 'http://127.0.0.1:8787',
    workspace = process.env.FREECUT_WORKSPACE || '',
    autostart = process.env.FREECUT_MCP_AUTOSTART !== '0',
    fetchImpl = globalThis.fetch,
    log = (message) => console.error('[freecut-mcp]', message),
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    exitProcess = (status) => process.exit(status),
  } = {}) {
    this.exitProcess = exitProcess
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.workspace = workspace
    this.autostart = autostart
    this.fetchImpl = fetchImpl
    this.log = log
    this.now = now
    this.sleep = sleep
  }

  /**
   * @returns {Promise<'attached'|'started'|'unavailable'>}
   */
  async ensure() {
    if (await isApiHealthy(this.baseUrl, this.fetchImpl)) {
      this.log(`attached to the API already running at ${this.baseUrl}`)
      return 'attached'
    }
    if (!this.autostart) return 'unavailable'
    if (!this.workspace) {
      this.log(
        `no API at ${this.baseUrl} and FREECUT_WORKSPACE is unset — set it to have one started automatically`,
      )
      return 'unavailable'
    }
    if (!fs.existsSync(this.workspace)) {
      this.log(`FREECUT_WORKSPACE does not exist: ${this.workspace}`)
      return 'unavailable'
    }

    this.log(`starting the API on ${this.baseUrl} over ${this.workspace} (first run builds dist/)`)
    this.#child = spawnApi({ workspace: this.workspace, baseUrl: this.baseUrl, log: this.log })
    this.#installCleanup()

    const deadline = this.now() + READY_TIMEOUT_MS
    while (this.now() < deadline) {
      if (this.#child.exitCode !== null) {
        this.log(`the API exited during startup (code ${this.#child.exitCode})`)
        return 'unavailable'
      }
      if (await isApiHealthy(this.baseUrl, this.fetchImpl)) {
        this.log('API ready')
        return 'started'
      }
      await this.sleep(POLL_INTERVAL_MS)
    }
    this.log('the API did not become healthy in time')
    await this.stop()
    return 'unavailable'
  }

  /** Only a process we started is ours to stop; an attached one is left alone. */
  async stop() {
    const child = this.#child
    this.#child = null
    this.#removeCleanup()
    if (!child || child.exitCode !== null) return
    child.kill('SIGTERM')
  }

  /** Test seam: exercise signal wiring without spawning a real child. */
  _installCleanupForTest() {
    this.#installCleanup()
  }

  #installCleanup() {
    if (this.#cleanup) return
    const cleanup = () => {
      const child = this.#child
      this.#child = null
      if (child && child.exitCode === null) child.kill('SIGTERM')
    }
    // Registering a signal handler REPLACES Node's default terminate
    // behaviour, so a handler that only reaps the child leaves this process
    // alive and unkillable by an ordinary SIGTERM. Reap, then exit with the
    // conventional 128+signal status.
    const onSignal = (signal, status) => () => {
      cleanup()
      this.exitProcess(status, signal)
    }
    this.#cleanup = cleanup
    this.#onSigint = onSignal('SIGINT', 130)
    this.#onSigterm = onSignal('SIGTERM', 143)
    process.once('exit', cleanup)
    process.once('SIGINT', this.#onSigint)
    process.once('SIGTERM', this.#onSigterm)
  }

  #removeCleanup() {
    if (!this.#cleanup) return
    process.off('exit', this.#cleanup)
    if (this.#onSigint) process.off('SIGINT', this.#onSigint)
    if (this.#onSigterm) process.off('SIGTERM', this.#onSigterm)
    this.#cleanup = null
    this.#onSigint = null
    this.#onSigterm = null
  }
}
