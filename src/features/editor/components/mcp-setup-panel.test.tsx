import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { MCP_DOCKER_CLIENT_CONFIG } from './mcp-setup-config'
import { McpSetupPanel } from './mcp-setup-panel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'editor.agent.mcp.copyConfig': 'Copy MCP config',
        'editor.agent.mcp.copied': 'MCP config copied',
      })[key] ?? key,
  }),
}))

describe('McpSetupPanel', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>()

  beforeEach(() => {
    writeText.mockReset()
    writeText.mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  it('shows a valid Docker MCP client configuration', () => {
    render(<McpSetupPanel />)

    expect(JSON.parse(MCP_DOCKER_CLIENT_CONFIG)).toEqual({
      mcpServers: {
        freecut: {
          command: 'docker',
          args: ['exec', '-i', 'freecut-headless', 'node', 'mcp/server.mjs'],
        },
      },
    })
    expect(screen.getByTestId('mcp-client-config').textContent).toBe(MCP_DOCKER_CLIENT_CONFIG)
  })

  it('copies the complete MCP configuration with one click', async () => {
    render(<McpSetupPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy MCP config' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MCP_DOCKER_CLIENT_CONFIG))
    expect(screen.getByRole('button', { name: 'MCP config copied' })).toBeTruthy()
  })
})
