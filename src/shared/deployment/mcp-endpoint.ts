/**
 * Where a client should dial to reach this deployment's MCP server.
 *
 * The port and the bind address live in the Docker host's environment, so the
 * browser can only learn them by asking the server. The host is the one part
 * the browser already knows better than the server does: the editor was loaded
 * from the machine running the stack, so the address in its own URL is by
 * construction an address that machine answers to for whoever is asking.
 */

const DEPLOYMENT_ENDPOINT = '/api/deployment'

/** The compose default, used whenever the server does not describe itself. */
export const DEFAULT_MCP_PORT = 8788

export interface McpEndpointInfo {
  port: number
  /**
   * False when the endpoint is bound to loopback, which is the compose
   * default. The address is then correct and still unreachable from any other
   * machine, and saying so beats handing over a config that cannot connect.
   */
  reachableFromNetwork: boolean
}

function parseMcpEndpointInfo(value: unknown): McpEndpointInfo | null {
  if (!value || typeof value !== 'object') return null
  const mcp = (value as Record<string, unknown>).mcp
  if (!mcp || typeof mcp !== 'object') return null
  const candidate = mcp as Record<string, unknown>
  if (!Number.isInteger(candidate.port) || typeof candidate.reachableFromNetwork !== 'boolean') {
    return null
  }
  return {
    port: candidate.port as number,
    reachableFromNetwork: candidate.reachableFromNetwork,
  }
}

/**
 * Null outside a Docker deployment, where the static server that answers this
 * route does not exist and the editor has no stack to describe.
 */
export async function getMcpEndpointInfo(signal?: AbortSignal): Promise<McpEndpointInfo | null> {
  try {
    const response = await fetch(DEPLOYMENT_ENDPOINT, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      return null
    }
    return parseMcpEndpointInfo(await response.json())
  } catch {
    return null
  }
}
