const AUTO_APPLY_STORAGE_KEY = 'freecut-docker-update-auto-apply-until'
const AUTO_APPLY_WINDOW_MS = 30 * 60 * 1000

export const DOCKER_UPDATE_REQUESTED_EVENT = 'freecut:docker-update-requested'

function getSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function armDockerUpdateAutoApply(now = Date.now(), storage = getSessionStorage()): void {
  storage?.setItem(AUTO_APPLY_STORAGE_KEY, String(now + AUTO_APPLY_WINDOW_MS))
}

export function isDockerUpdateAutoApplyArmed(
  now = Date.now(),
  storage = getSessionStorage(),
): boolean {
  if (!storage) return false
  const expiresAt = Number(storage.getItem(AUTO_APPLY_STORAGE_KEY))
  if (Number.isFinite(expiresAt) && expiresAt > now) return true
  storage.removeItem(AUTO_APPLY_STORAGE_KEY)
  return false
}

export function consumeDockerUpdateAutoApply(
  now = Date.now(),
  storage = getSessionStorage(),
): boolean {
  const armed = isDockerUpdateAutoApplyArmed(now, storage)
  storage?.removeItem(AUTO_APPLY_STORAGE_KEY)
  return armed
}
