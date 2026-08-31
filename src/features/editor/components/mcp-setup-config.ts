export const MCP_DOCKER_START_COMMAND =
  'FREECUT_WORKSPACE=/absolute/path FREECUT_API_TOKEN=change-me docker compose --profile automation up --build -d headless'

export const MCP_DOCKER_CLIENT_CONFIG = JSON.stringify(
  {
    mcpServers: {
      freecut: {
        command: 'docker',
        args: ['exec', '-i', 'freecut-headless', 'node', 'mcp/server.mjs'],
      },
    },
  },
  null,
  2,
)
