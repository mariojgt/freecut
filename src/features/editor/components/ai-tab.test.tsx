import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key.split('.').at(-1) ?? key }),
}))

vi.mock('./agent-chat-panel', () => ({ AgentChatPanel: () => <div>assistant-panel</div> }))
vi.mock('./ai-panel', () => ({ AiPanel: () => <div>generate-panel</div> }))
vi.mock('./mcp-setup-panel', () => ({ McpSetupPanel: () => <div>mcp-setup-panel</div> }))

import { AiTab } from './ai-tab'

describe('AiTab', () => {
  it('opens the MCP setup from the visible MCP tab', () => {
    render(<AiTab />)

    expect(screen.getByText('assistant-panel')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'mcp' }))
    expect(screen.getByText('mcp-setup-panel')).toBeTruthy()
  })
})
