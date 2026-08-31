import { beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  armDockerUpdateAutoApply,
  consumeDockerUpdateAutoApply,
  isDockerUpdateAutoApplyArmed,
} from './docker-update-session'

describe('Docker update auto-apply session', () => {
  beforeEach(() => sessionStorage.clear())

  it('arms one automatic save-and-reload within the update window', () => {
    armDockerUpdateAutoApply(1_000)

    expect(isDockerUpdateAutoApplyArmed(2_000)).toBe(true)
    expect(consumeDockerUpdateAutoApply(2_000)).toBe(true)
    expect(isDockerUpdateAutoApplyArmed(2_000)).toBe(false)
  })

  it('expires instead of applying an unrelated future deployment', () => {
    armDockerUpdateAutoApply(1_000)

    expect(isDockerUpdateAutoApplyArmed(31 * 60 * 1000)).toBe(false)
    expect(consumeDockerUpdateAutoApply(31 * 60 * 1000)).toBe(false)
  })
})
