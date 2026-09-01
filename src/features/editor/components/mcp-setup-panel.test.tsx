import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DEFAULT_MCP_PORT } from '@/shared/deployment/mcp-endpoint'
import {
  buildMcpClientConfig,
  isLoopbackHost,
  MCP_DIRECT_CLIENT_CONFIG,
  MCP_DOCKER_REMOTE_START_COMMAND,
  MCP_DOCKER_START_COMMAND,
  MCP_REMOTE_START_COMMAND,
  resolveMcpHost,
} from './mcp-setup-config'

// jsdom serves the panel from localhost, which is what the browser would
// report for a stack reached at that address.
const PAGE_HOST = 'localhost'
const CLIENT_CONFIG = buildMcpClientConfig({ host: PAGE_HOST, port: DEFAULT_MCP_PORT })
const CLIENT_CONFIG_WITH_TOKEN = buildMcpClientConfig({
  host: PAGE_HOST,
  port: DEFAULT_MCP_PORT,
  withToken: true,
})
import { McpSetupPanel } from './mcp-setup-panel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'editor.agent.mcp.copyConfig': 'Copy MCP config',
        'editor.agent.mcp.copyRemoteCommand': 'Copy host command',
        'editor.agent.mcp.copyRemoteDockerCommand': 'Copy supervised host command',
        'editor.agent.mcp.copyRemoteConfig': 'Copy remote config',
        'editor.agent.mcp.copyRemoteTokenConfig': 'Copy remote config with token',
        'editor.agent.mcp.copyDockerCommand': 'Copy Docker command',
        'editor.agent.mcp.copyDockerConfig': 'Copy Docker config',
        'editor.agent.mcp.copied': 'MCP config copied',
        'editor.agent.mcp.loopbackWarning': 'Bound to loopback only.',
      })[key] ?? key,
  }),
}))

/** Every artifact the panel shows, and the button that copies it. */
const ARTIFACTS = [
  {
    testId: 'mcp-client-config',
    button: 'mcp-copy-config-button',
    value: MCP_DIRECT_CLIENT_CONFIG,
  },
  {
    testId: 'mcp-remote-command',
    button: 'mcp-copy-remote-command-button',
    value: MCP_REMOTE_START_COMMAND,
  },
  {
    testId: 'mcp-remote-docker-command',
    button: 'mcp-copy-remote-docker-command-button',
    value: MCP_DOCKER_REMOTE_START_COMMAND,
  },
  {
    testId: 'mcp-remote-config',
    button: 'mcp-copy-remote-config-button',
    value: CLIENT_CONFIG,
  },
  {
    testId: 'mcp-remote-token-config',
    button: 'mcp-copy-remote-token-config-button',
    value: CLIENT_CONFIG_WITH_TOKEN,
  },
  {
    testId: 'mcp-docker-command',
    button: 'mcp-copy-docker-command-button',
    value: MCP_DOCKER_START_COMMAND,
  },
  {
    testId: 'mcp-docker-config',
    button: 'mcp-copy-docker-config-button',
    value: CLIENT_CONFIG,
  },
]

describe('McpSetupPanel', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>()

  beforeEach(() => {
    writeText.mockReset()
    writeText.mockResolvedValue()
    // A stubbed location or fetch would otherwise leak into the next test and
    // silently decide its result.
    vi.unstubAllGlobals()
    // The panel asks the server to describe its MCP endpoint on mount. Outside
    // Docker there is nothing to answer, which is the default here.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no deployment endpoint')))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  it('renders every command and configuration it documents', () => {
    render(<McpSetupPanel />)
    for (const artifact of ARTIFACTS) {
      expect(screen.getByTestId(artifact.testId).textContent).toBe(artifact.value)
    }
  })

  it('copies each artifact in full, so nothing has to be transcribed by hand', async () => {
    render(<McpSetupPanel />)
    for (const artifact of ARTIFACTS) {
      writeText.mockClear()
      fireEvent.click(screen.getByTestId(artifact.button))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(artifact.value))
    }
  })

  it('gives every copy button a distinct accessible name', () => {
    // Six identically-labelled buttons would be ambiguous to a screen reader
    // and easy to click by mistake.
    render(<McpSetupPanel />)
    const names = screen
      .getAllByRole('button')
      .map((button) => button.textContent?.trim())
      .filter(Boolean)
    expect(names).toHaveLength(ARTIFACTS.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('confirms the copy on the button that was pressed, not the others', async () => {
    render(<McpSetupPanel />)
    fireEvent.click(screen.getByTestId('mcp-copy-remote-config-button'))

    await waitFor(() =>
      expect(screen.getByTestId('mcp-copy-remote-config-button').textContent).toContain(
        'MCP config copied',
      ),
    )
    expect(screen.getByTestId('mcp-copy-config-button').textContent).toContain('Copy MCP config')
  })

  it('offers a remote configuration with no local path and no required auth', () => {
    // The point of the HTTP transport is hosting FreeCut elsewhere; a
    // filesystem path would mean the client still had to be on that machine.
    const remote = JSON.parse(CLIENT_CONFIG).mcpServers.freecut
    expect(remote.url).toMatch(/^https?:\/\//)
    expect(remote.command).toBeUndefined()
    expect(remote.args).toBeUndefined()
    expect(remote.headers).toBeUndefined()
  })

  it('starts everything with a plain up, and no profile flag to remember', () => {
    expect(MCP_DOCKER_START_COMMAND).toBe('docker compose up --build -d')
    expect(MCP_DOCKER_START_COMMAND).not.toContain('--profile')
  })

  it('spells out the one silent requirement for reaching a remote host', () => {
    // The MCP port publishes on loopback by default, so without this bind the
    // container runs fine and no other machine can reach it.
    expect(MCP_DOCKER_REMOTE_START_COMMAND).toContain('FREECUT_MCP_BIND=0.0.0.0')
  })

  it('still offers a token-bearing variant for hosts that opt in', () => {
    const secured = JSON.parse(CLIENT_CONFIG_WITH_TOKEN).mcpServers.freecut
    expect(secured.url).toBe(JSON.parse(CLIENT_CONFIG).mcpServers.freecut.url)
    expect(secured.headers.Authorization).toMatch(/^Bearer /)
  })

  it('surfaces a clipboard failure instead of silently doing nothing', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    // jsdom does not implement execCommand at all, so the legacy fallback path
    // has to be defined before it can be made to fail.
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => false,
    })
    render(<McpSetupPanel />)

    fireEvent.click(screen.getByTestId('mcp-copy-config-button'))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  })
  it('addresses the page host instead of a placeholder to be edited by hand', () => {
    // The host is the one field a user cannot fill in from what is on screen,
    // and a wrong guess fails at connect time rather than at paste time.
    render(<McpSetupPanel />)
    const url = JSON.parse(screen.getByTestId('mcp-remote-config').textContent ?? '{}').mcpServers
      .freecut.url
    expect(url).toBe(`http://${PAGE_HOST}:${DEFAULT_MCP_PORT}/mcp`)
    expect(url).not.toContain('your-host')
  })

  it('publishes the port the deployment actually reports, not the default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ mcp: { port: 9100, reachableFromNetwork: false } }),
      }),
    )
    render(<McpSetupPanel />)

    await waitFor(() =>
      expect(screen.getByTestId('mcp-docker-config').textContent).toContain(':9100/mcp'),
    )
  })

  it('warns when the reported endpoint cannot answer the machine reading the page', async () => {
    vi.stubGlobal('location', { ...window.location, hostname: '192.168.1.50' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ mcp: { port: 8788, reachableFromNetwork: false } }),
      }),
    )
    render(<McpSetupPanel />)

    // The copied address is right and still unreachable: loopback serves the
    // Docker host alone, and this page was opened from somewhere else.
    await waitFor(() => expect(screen.getByTestId('mcp-loopback-warning')).toBeTruthy())
    expect(screen.getByTestId('mcp-remote-config').textContent).toContain('192.168.1.50')
  })

  it('stays quiet when the page is the Docker host, where loopback works', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ mcp: { port: 8788, reachableFromNetwork: false } }),
      }),
    )
    render(<McpSetupPanel />)

    await waitFor(() =>
      expect(screen.getByTestId('mcp-remote-config').textContent).toContain(PAGE_HOST),
    )
    expect(screen.queryByTestId('mcp-loopback-warning')).toBeNull()
  })

  it('treats every spelling of the local machine as loopback', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'LOCALHOST']) {
      expect(isLoopbackHost(host)).toBe(true)
    }
    expect(isLoopbackHost('192.168.1.50')).toBe(false)
    expect(isLoopbackHost('freecut.example.com')).toBe(false)
  })

  it('falls back to a placeholder only when the page has no host to offer', () => {
    expect(resolveMcpHost('192.168.1.50')).toBe('192.168.1.50')
    expect(resolveMcpHost('  ')).toBe('your-host')
  })
})
