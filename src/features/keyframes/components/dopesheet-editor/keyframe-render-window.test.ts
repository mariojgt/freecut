// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { getSortedFrameRenderWindow } from './keyframe-render-window'

describe('getSortedFrameRenderWindow', () => {
  it('bounds a very dense lane to visible keys plus connector neighbours', () => {
    const keyframes = Array.from({ length: 50_000 }, (_, frame) => ({ id: `k-${frame}`, frame }))

    const window = getSortedFrameRenderWindow(keyframes, {
      startFrame: 25_000,
      endFrame: 25_100,
    })

    expect(window.visible).toHaveLength(101)
    expect(window.visible[0]?.frame).toBe(25_000)
    expect(window.visible.at(-1)?.frame).toBe(25_100)
    expect(window.connected).toHaveLength(103)
    expect(window.connected[0]?.frame).toBe(24_999)
    expect(window.connected.at(-1)?.frame).toBe(25_101)
  })

  it('retains both endpoints of a connector that crosses the whole viewport', () => {
    const keyframes = [
      { id: 'before', frame: 10 },
      { id: 'after', frame: 90 },
    ]

    const window = getSortedFrameRenderWindow(keyframes, { startFrame: 30, endFrame: 60 })

    expect(window.visible).toEqual([])
    expect(window.connected).toEqual(keyframes)
  })

  it('includes exact viewport-edge keyframes and tolerates a reversed viewport', () => {
    const keyframes = [
      { id: 'before', frame: 9 },
      { id: 'start', frame: 10 },
      { id: 'end', frame: 20 },
      { id: 'after', frame: 21 },
    ]

    const window = getSortedFrameRenderWindow(keyframes, { startFrame: 20, endFrame: 10 })

    expect(window.visible.map((keyframe) => keyframe.id)).toEqual(['start', 'end'])
    expect(window.connected).toEqual(keyframes)
  })
})
