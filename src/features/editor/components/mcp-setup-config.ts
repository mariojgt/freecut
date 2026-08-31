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

/**
 * Remote config: the server runs on another machine and the client connects by
 * URL, so there is no local path to fill in. Complete as written — the endpoint
 * is unauthenticated unless FREECUT_MCP_TOKEN is set on the host.
 */
export const MCP_REMOTE_CLIENT_CONFIG = JSON.stringify(
  {
    mcpServers: {
      freecut: {
        url: 'http://your-host:8788/mcp',
      },
    },
  },
  null,
  2,
)

/** The same config for a host that opted into a bearer token. */
export const MCP_REMOTE_CLIENT_CONFIG_WITH_TOKEN = JSON.stringify(
  {
    mcpServers: {
      freecut: {
        url: 'http://your-host:8788/mcp',
        headers: { Authorization: 'Bearer <FREECUT_MCP_TOKEN>' },
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

/**
 * Points at the supervised `mcp` container's HTTP endpoint rather than exec-ing
 * a one-off stdio bridge, so the client reconnects to a server that is already
 * running instead of spawning a new process per session.
 */
export const MCP_DOCKER_CLIENT_CONFIG = JSON.stringify(
  {
    mcpServers: {
      freecut: {
        url: 'http://127.0.0.1:8788/mcp',
      },
    },
  },
  null,
  2,
)
