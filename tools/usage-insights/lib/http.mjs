/**
 * Bounded, read-only collection from a real local product HTTP surface.
 *
 * Only GET requests are issued. The base URL must be an explicit loopback origin, the operator
 * supplies the credential file, redirects are refused rather than followed, and every request has a
 * timeout inside one overall deadline plus page, record and byte caps. The token is used from memory
 * only: it never reaches the bundle, a report, an error message or a provenance field.
 */
import { lstatSync, readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'

export class CollectorError extends Error {
  constructor(code, message, detail = {}) {
    super(message)
    this.name = 'CollectorError'
    this.code = code
    /** Bounded, secret-free facts about where collection stopped. */
    this.detail = detail
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function parseLoopbackBase(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new CollectorError('invalid_argument', 'Base URL must be an absolute loopback URL')
  }
  if (url.protocol !== 'http:') throw new CollectorError('invalid_argument', 'Base URL must use http on loopback')
  if (!LOOPBACK_HOSTS.has(url.hostname)) throw new CollectorError('invalid_argument', 'Base URL host must be loopback')
  if (url.username || url.password) throw new CollectorError('invalid_argument', 'Base URL must not embed credentials')
  if (url.pathname !== '/' || url.search || url.hash) throw new CollectorError('invalid_argument', 'Base URL must be a bare origin')
  return url
}

/** Read an explicitly supplied credential file. No home-directory or ambient discovery is performed. */
export function readTokenFile(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new CollectorError('invalid_argument', '--token-file must be an absolute path')
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    throw new CollectorError('invalid_argument', 'The credential file does not exist')
  }
  if (stat.isSymbolicLink()) throw new CollectorError('invalid_argument', 'The credential file must not be a symbolic link')
  if (!stat.isFile()) throw new CollectorError('invalid_argument', 'The credential file must be a regular file')
  if (stat.size <= 0 || stat.size > 4096) throw new CollectorError('invalid_argument', 'The credential file size is not plausible')
  const value = readFileSync(path, 'utf8').trim()
  if (value.length < 16 || value.length > 1024 || /\s/.test(value))
    throw new CollectorError('invalid_argument', 'The credential file must contain one token without whitespace')
  return value
}

const ERROR_BODY_LIMIT = 16 * 1024

/** Read and discard at most `limit` body bytes (used for error and redirect responses). */
async function discard(response, limit, signal) {
  try {
    const result = await readBounded(response, limit, signal ?? null, { tolerateOverflow: true })
    return { bytes: result.bytes }
  } catch {
    // A diagnostic body is best effort: the status code is the useful fact.
    try { await response.body?.cancel() } catch { /* already closed */ }
    return { bytes: 0 }
  }
}

/**
 * Read a response body while counting bytes against a budget. On overflow the stream is cancelled and
 * the error carries how many bytes had arrived, so a caller can see *where* it stopped rather than
 * only that something failed.
 */
async function readBounded(response, limit, signal, options = {}) {
  const body = response.body
  if (!body) return { buffer: Buffer.alloc(0), bytes: 0 }
  const reader = body.getReader()
  const chunks = []
  let bytes = 0
  const abandon = async () => {
    try { await reader.cancel() } catch { /* the stream may already be closed */ }
  }
  try {
    for (;;) {
      if (signal?.aborted) {
        await abandon()
        throw new CollectorError('timeout', 'The response was aborted by its timeout or deadline', { bytesReceived: bytes })
      }
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) {
        await abandon()
        if (options.tolerateOverflow) return { buffer: Buffer.alloc(0), bytes: Math.min(bytes, limit) }
        throw new CollectorError('limits', `The response exceeded its byte budget after ${bytes} of ${limit} allowed bytes`,
          { bytesReceived: bytes, allowed: limit })
      }
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    await abandon()
    if (error instanceof CollectorError) throw error
    if (signal?.aborted) throw new CollectorError('timeout', 'The response was aborted by its timeout or deadline', { bytesReceived: bytes })
    throw new CollectorError('transport', 'The response stream ended unexpectedly', { bytesReceived: bytes })
  }
  return { buffer: Buffer.concat(chunks), bytes }
}

const AUTH_STATUSES = new Set([401, 403])
const MISSING_STATUSES = new Set([404, 405, 501])
const UNSUPPORTED_STATUSES = new Set([415, 422, 400, 409])

function statusCode(status) {
  if (AUTH_STATUSES.has(status)) return 'auth_required'
  if (MISSING_STATUSES.has(status)) return 'not_found'
  if (UNSUPPORTED_STATUSES.has(status)) return 'unsupported'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server_error'
  return 'unexpected_status'
}

export class LoopbackClient {
  constructor({ base, token, requestTimeoutMs, deadlineSignal, maxBytes }) {
    this.base = base
    this.token = token
    this.requestTimeoutMs = requestTimeoutMs
    this.deadlineSignal = deadlineSignal
    this.maxBytes = maxBytes
    this.bytes = 0
    this.requests = 0
  }

  url(path) {
    const url = new URL(path, this.base)
    // Re-check the resolved origin so a crafted path can never move the credential off loopback.
    if (url.origin !== this.base.origin || !LOOPBACK_HOSTS.has(url.hostname))
      throw new CollectorError('invalid_argument', 'Resolved request left the loopback origin')
    return url
  }

  async getJson(path) {
    const url = this.url(path)
    if (this.deadlineSignal.aborted) throw new CollectorError('deadline', 'The collection deadline expired before the request')
    const signal = AbortSignal.any([AbortSignal.timeout(this.requestTimeoutMs), this.deadlineSignal])
    let response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${this.token}`, accept: 'application/json' },
        redirect: 'manual',
        signal,
      })
    } catch (error) {
      if (this.deadlineSignal.aborted) throw new CollectorError('deadline', 'The collection deadline expired')
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
        throw new CollectorError('timeout', 'The request exceeded its timeout', { bytesReceived: 0 })
      throw new CollectorError('transport', 'The local service could not be reached')
    }
    this.requests++
    if (response.status >= 300 && response.status < 400) {
      // Never follow: drop the body (bounded) and report the refusal. A hanging body must not turn a
      // redirect into a timeout, so draining is best-effort.
      const discarded = await discard(response, ERROR_BODY_LIMIT, signal)
      throw new CollectorError('redirect_refused', `Refusing to follow a redirect (${response.status}) from the local service`,
        { bytesReceived: discarded.bytes, locationRefused: true })
    }
    if (!response.ok) {
      // An error body is bounded too: a large diagnostic response must not exhaust the budget.
      const discarded = await discard(response, ERROR_BODY_LIMIT, signal)
      throw new CollectorError(statusCode(response.status), `The local service answered ${response.status}`,
        { bytesReceived: discarded.bytes, errorBodyLimit: ERROR_BODY_LIMIT })
    }

    const remaining = this.maxBytes - this.bytes
    if (remaining <= 0)
      throw new CollectorError('limits', 'The collection budget is exhausted before this response', { bytesReceived: 0, allowed: this.maxBytes })
    const declaredLength = response.headers.get('content-length')
    if (declaredLength !== null && Number(declaredLength) > remaining) {
      // Refuse on the declared size without reading a byte: cancelling is enough, and waiting for a
      // body that may never finish would turn a bound into a timeout.
      try { await response.body?.cancel() } catch { /* already closed */ }
      throw new CollectorError('limits', 'The response declares more bytes than the remaining collection budget',
        { declaredLength: Number(declaredLength), allowed: remaining, bytesReceived: 0 })
    }

    // The body is consumed as a stream against the remaining budget: an unknown or understated
    // Content-Length can never lead to a full allocation first.
    const { buffer, bytes } = await readBounded(response, remaining, signal)
    this.bytes += bytes
    try {
      return { value: JSON.parse(buffer.toString('utf8')), bytes }
    } catch {
      throw new CollectorError('bad_schema', 'The local service returned a body that is not JSON', { bytesReceived: bytes })
    }
  }
}

export function deadlineController(deadlineMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('deadline')), deadlineMs)
  timer.unref?.()
  return { signal: controller.signal, clear: () => clearTimeout(timer), expired: () => controller.signal.aborted }
}

const asArray = value => (Array.isArray(value) ? value : [])
const asString = value => (typeof value === 'string' && value.length > 0 ? value : undefined)

/** Discover works from the local snapshot, which is the only read surface that lists them. */
export function worksFromSnapshot(snapshot) {
  const works = []
  for (const view of asArray(snapshot?.works)) {
    const id = asString(view?.work?.id)
    const projectId = asString(view?.work?.projectId)
    if (!id || !projectId) continue
    works.push({ id, projectId, phase: asString(view?.phase) ?? 'unknown' })
  }
  return works
}

export const helpers = { asArray, asString }
