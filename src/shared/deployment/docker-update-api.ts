const DEPLOYMENT_ENDPOINT = '/api/deployment'
const UPDATE_ENDPOINT = '/api/deployment/update'

export interface DockerDeploymentInfo {
  runtime: 'docker'
  releaseTag: string | null
  updateEnabled: true
}

function isDockerDeploymentInfo(value: unknown): value is DockerDeploymentInfo {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.runtime === 'docker' &&
    candidate.updateEnabled === true &&
    (candidate.releaseTag === null || typeof candidate.releaseTag === 'string')
  )
}

export async function getDockerDeploymentInfo(
  signal?: AbortSignal,
): Promise<DockerDeploymentInfo | null> {
  try {
    const response = await fetch(DEPLOYMENT_ENDPOINT, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      return null
    }
    const value: unknown = await response.json()
    return isDockerDeploymentInfo(value) ? value : null
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    return null
  }
}

export async function requestDockerUpdate(): Promise<void> {
  const response = await fetch(UPDATE_ENDPOINT, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Docker update request failed (${response.status})`)
  const value: unknown = await response.json()
  if (!value || typeof value !== 'object' || (value as Record<string, unknown>).accepted !== true) {
    throw new Error('Docker update request was not accepted')
  }
}
