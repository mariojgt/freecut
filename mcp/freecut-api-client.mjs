import fs from 'node:fs/promises'
import path from 'node:path'

class FreeCutApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message)
    this.name = 'FreeCutApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(value || 'http://127.0.0.1:8787')
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('FREECUT_API_URL must use http:// or https://')
  }
  return url.toString().replace(/\/$/, '')
}

function safeFileName(value, fallback) {
  const unsafe = '<>:"/\\|?*'
  const cleaned = [...String(value || fallback)]
    .map((character) =>
      unsafe.includes(character) || character.codePointAt(0) < 32 ? '_' : character,
    )
    .join('')
    .replace(/^\.+|[. ]+$/g, '')
    .slice(0, 180)
  return cleaned || fallback
}

function responseFileName(response, fallback) {
  const disposition = response.headers.get('content-disposition') ?? ''
  const match = /filename="?([^";]+)"?/i.exec(disposition)
  return safeFileName(match?.[1], fallback)
}

export class FreeCutApiClient {
  // Environment defaults and injectable fetch are kept together for CLI and tests.
  // fallow-ignore-next-line complexity
  constructor({
    baseUrl = process.env.FREECUT_API_URL || 'http://127.0.0.1:8787',
    token = process.env.FREECUT_API_TOKEN || '',
    outputDir = process.env.FREECUT_MCP_OUTPUT_DIR || path.resolve('freecut-mcp-output'),
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('A Fetch API implementation is required')
    this.baseUrl = normalizeBaseUrl(baseUrl)
    this.token = token
    this.outputDir = path.resolve(outputDir)
    this.fetchImpl = fetchImpl
  }

  headers(extra = {}) {
    return {
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    }
  }

  // Success and structured-error variants are covered by the MCP client contract tests.
  // fallow-ignore-next-line complexity
  async requestJson(pathname, { method = 'GET', body } = {}) {
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method,
      headers: this.headers(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const apiError = payload?.error
      throw new FreeCutApiError(
        apiError?.message || `FreeCut API returned HTTP ${response.status}`,
        {
          status: response.status,
          code: apiError?.code,
          details: payload,
        },
      )
    }
    return payload
  }

  // Called structurally by the MCP server's injected API-client interface and covered by protocol tests.
  // fallow-ignore-next-line unused-class-member, complexity
  async requestFile(pathname, { body, fallbackName }) {
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new FreeCutApiError(
        payload?.error?.message || `FreeCut API returned HTTP ${response.status}`,
        { status: response.status, code: payload?.error?.code, details: payload },
      )
    }

    await fs.mkdir(this.outputDir, { recursive: true })
    const originalName = responseFileName(response, fallbackName)
    const parsed = path.parse(originalName)
    const uniqueName = `${parsed.name}-${Date.now()}${parsed.ext}`
    const outputPath = path.join(this.outputDir, uniqueName)
    const bytes = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(outputPath, bytes, { flag: 'wx' })
    return {
      path: outputPath,
      fileName: uniqueName,
      size: bytes.byteLength,
      mimeType: response.headers.get('content-type') || 'application/octet-stream',
    }
  }
}
