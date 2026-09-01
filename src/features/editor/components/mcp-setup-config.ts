/**
 * Client configuration for the FreeCut MCP server.
 *
 * Two supported shapes. The direct one is the default because the MCP server
 * supervises the render API itself — the client spawns the server, the server
 * brings the API up, and there is no command to run first. Docker remains the
 * choice for a shared or always-on deployment, where its restart policy keeps
 * the API alive across reboots and several clients attach to the one instance.
 */

/**
 * The whole stack — editor, render API, MCP endpoint — all with
 * `restart: unless-stopped`. No profile flag and no inline environment: compose
 * reads `.env`, so this is typed once and never again.
 */
export const MCP_DOCKER_START_COMMAND = 'docker compose up --build -d'

/**
 * Paste-and-go config. `FREECUT_WORKSPACE` is the only thing to fill in; the
 * server starts the API against it on first use and stops it on exit.
 */
export const MCP_DIRECT_CLIENT_CONFIG = JSON.stringify(
  {
    mcpServers: {
      freecut: {
        command: 'node',
        args: ['/absolute/path/to/freecut/mcp/server.mjs'],
        env: { FREECUT_WORKSPACE: '/absolute/path/to/your/workspace' },
      },
    },
  },
  null,
  2,
)

export const MCP_REMOTE_START_COMMAND =
  'FREECUT_WORKSPACE=/absolute/path node mcp/http-server.mjs --host 0.0.0.0'

/**
 * The supervised remote path. Only one thing differs from the local command,
 * and it is silent when wrong: the MCP port publishes on loopback by default,
 * so without this bind no other machine can reach it. Put it in `.env` and the
 * plain command above covers this case too.
 */
export const MCP_DOCKER_REMOTE_START_COMMAND =
  'FREECUT_MCP_BIND=0.0.0.0 docker compose up --build -d'

/** Stands in for the address only when the page cannot supply a real one. */
const MCP_HOST_PLACEHOLDER = 'your-host'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Whether a client reading this page sits on the machine running the stack.
 * A loopback-bound MCP port serves that client and no other, so this is what
 * separates a working default from an address that cannot answer.
 */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase())
}

/**
 * The address to publish, taken from the URL the editor was opened on.
 *
 * A hand-written placeholder is the one part of this config a user cannot
 * complete from what is on screen, and getting it wrong fails at connect time
 * rather than at paste time. The page host is the answer by construction: it
 * reached the machine running the stack, from the machine that is asking.
 * `location.hostname` already brackets IPv6 literals, so it is used verbatim.
 */
export function resolveMcpHost(hostname: string): string {
  const host = hostname.trim()
  return host.length > 0 ? host : MCP_HOST_PLACEHOLDER
}

interface McpClientConfigOptions {
  host: string
  port: number
  /** Set when the host opted into FREECUT_MCP_TOKEN; the value stays a blank. */
  withToken?: boolean
}

/**
 * The endpoint speaks plain HTTP even when the editor is served over TLS: the
 * MCP container publishes its own port directly and is not behind the proxy
 * that terminates TLS for the editor.
 */
export function buildMcpClientConfig({
  host,
  port,
  withToken = false,
}: McpClientConfigOptions): string {
  const freecut: { url: string; headers?: Record<string, string> } = {
    url: `http://${host}:${port}/mcp`,
  }
  if (withToken) freecut.headers = { Authorization: 'Bearer <FREECUT_MCP_TOKEN>' }
  return JSON.stringify({ mcpServers: { freecut } }, null, 2)
}
