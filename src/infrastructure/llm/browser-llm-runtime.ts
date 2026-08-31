export const MIN_BROWSER_LLM_TRANSFORMERS_VERSION = '4.2.0'

function parseVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function isTransformersVersionCompatible(version: string): boolean {
  const current = parseVersion(version)
  const minimum = parseVersion(MIN_BROWSER_LLM_TRANSFORMERS_VERSION)
  if (!current || !minimum) return false

  for (let index = 0; index < current.length; index += 1) {
    if (current[index] !== minimum[index]) return current[index]! > minimum[index]!
  }
  return true
}

export function assertBrowserLlmRuntimeCompatible(version: string): void {
  if (isTransformersVersionCompatible(version)) return
  throw new Error(
    `The browser assistant requires Transformers.js ${MIN_BROWSER_LLM_TRANSFORMERS_VERSION} or newer to create compatible ONNX cache tensors (found ${version || 'unknown'}).`,
  )
}
