import { describe, expect, it } from 'vite-plus/test'
import { buildDeterministicEditPlan, isLikelyEditRequest } from './edit-intent'

describe('editing intent fallback', () => {
  it('distinguishes an edit command from a how-to question', () => {
    expect(isLikelyEditRequest('Add fade transitions to all my videos')).toBe(true)
    expect(isLikelyEditRequest('How do I add a transition?')).toBe(false)
  })

  it('plans one bulk transition action for every video', () => {
    expect(buildDeterministicEditPlan('Add 1 second fade transitions to all videos')).toEqual({
      reply: 'I’ll add transitions across the requested clips.',
      steps: [
        {
          tool: 'add_transitions',
          args: { scope: 'all', type: 'fade', durationSeconds: 1 },
        },
      ],
    })
  })

  it('extracts title text instead of returning a chat answer', () => {
    expect(buildDeterministicEditPlan('Add a lower third title saying X Y and Z')).toEqual({
      reply: 'I’ll add that title to the timeline.',
      steps: [{ tool: 'add_title', args: { text: 'X Y and Z', position: 'lower-third' } }],
    })
  })

  it('requires precise times for an ambiguous middle cut', () => {
    expect(buildDeterministicEditPlan('Cut the middle of my video')).toEqual({
      reply: 'Which exact start and end times should I remove?',
      steps: [],
    })
  })
})
