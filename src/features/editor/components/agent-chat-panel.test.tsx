import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { getLocalLlmConfig } from '@/infrastructure/llm'
import { useAgentStore } from '../agent'
import { AgentChatPanel } from './agent-chat-panel'

describe('AgentChatPanel model selection', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('navigator', { gpu: {}, userAgent: 'test' })
    useAgentStore.setState({
      supported: true,
      modelStatus: 'idle',
      loadPercent: 0,
      loadStage: null,
      loadLoadedBytes: 0,
      loadTotalBytes: 0,
      loadError: null,
      messages: [],
      phase: 'idle',
      streamingText: '',
      plan: null,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('offers three browser models and persists the selected model', () => {
    render(<AgentChatPanel />)

    const select = screen.getByTestId('agent-model-select') as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual([
      'browser:qwen-3.5-0.8b',
      'browser:gemma-4-e2b',
      'browser:gemma-4-e4b',
      'openai-compatible',
    ])
    expect(select.value).toBe('browser:qwen-3.5-0.8b')

    fireEvent.change(select, { target: { value: 'browser:gemma-4-e2b' } })

    expect(getLocalLlmConfig()).toEqual(
      expect.objectContaining({ adapterId: 'gemma', browserModelId: 'gemma-4-e2b' }),
    )
    expect(select.value).toBe('browser:gemma-4-e2b')
    expect(
      within(screen.getByTestId('agent-browser-model-summary')).getByText('Gemma 4 E2B'),
    ).toBeTruthy()
  })

  it('surfaces direct timeline edits as starter requests', () => {
    render(<AgentChatPanel />)

    expect(screen.getByText('Add fade transitions to all videos')).toBeTruthy()
    expect(screen.getByText('Fade every video in and out')).toBeTruthy()
    expect(screen.getByText('Add a title that says Hello')).toBeTruthy()
    expect(screen.getByText('Cut out 5–8 seconds')).toBeTruthy()
  })
})
