import { loopbackOrigin, readPrivateCredential, sha256 } from './evidence.mjs'

export class LocalProductError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message)
    this.name = 'LocalProductError'
    this.status = status
    this.code = code
    this.body = body
  }
}

/**
 * Authenticated client for the product's loopback API.
 *
 * Order matters: the origin is proven to be plain loopback before the private credential file is
 * read. Redirects are never followed, so a `Location` cannot move the credential to another origin;
 * a 3xx, a changed response URL, or a non-loopback host is a hard error.
 */
export class LocalProductClient {
  #token
  #origin
  constructor({ baseURL, stateDir, token, timeoutMs = 10_000 }) {
    this.#origin = loopbackOrigin(baseURL)
    if (token !== undefined) this.#token = token
    else if (stateDir !== undefined) this.#token = readPrivateCredential(stateDir, 'api.key')
    else throw new TypeError('A client needs a token source')
    this.timeoutMs = timeoutMs
    this.requests = 0
  }

  get origin() {
    return this.#origin.origin
  }

  async request(path, { method = 'GET', body, headers = {}, authenticated = true, origin } = {}) {
    if (typeof path !== 'string' || path.startsWith('//') || /^https?:/i.test(path))
      throw new TypeError('Request path must be origin-relative')
    const target = new URL(path, this.#origin)
    if (target.origin !== this.#origin.origin) throw new TypeError('Request escaped the loopback origin')
    const requestHeaders = { accept: 'application/json', ...headers }
    if (authenticated) requestHeaders.authorization = `Bearer ${this.#token}`
    if (origin) requestHeaders.origin = origin
    if (body !== undefined) {
      requestHeaders['content-type'] = 'application/json'
    }
    this.requests += 1
    const response = await fetch(target, {
      method,
      headers: requestHeaders,
      redirect: 'manual',
      signal: AbortSignal.timeout(this.timeoutMs),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (response.status >= 300 && response.status < 400)
      throw new LocalProductError(`Refused redirect ${response.status} to ${response.headers.get('location') ?? '?'}`, {
        status: response.status,
      })
    if (new URL(response.url).origin !== this.#origin.origin)
      throw new LocalProductError(`Response origin changed to ${new URL(response.url).origin}`, {
        status: response.status,
      })
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const text = await response.text()
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new LocalProductError('Response body is not JSON despite its content type', {
          status: response.status,
          body: text.slice(0, 200),
        })
      }
      return { status: response.status, headers: response.headers, body: parsed, contentType }
    }
    return { status: response.status, headers: response.headers, body: await response.arrayBuffer(), contentType }
  }

  async json(path, options = {}) {
    const result = await this.request(path, options)
    if (result.status !== 200)
      throw new LocalProductError(`HTTP ${result.status} for ${path}`, {
        status: result.status,
        code: result.body?.error?.code,
        body: result.body,
      })
    return result.body
  }

  async health() {
    const tokenFree = await this.request('/v1/health', { authenticated: false })
    return tokenFree.body
  }

  configuration() {
    return this.json('/v1/configuration')
  }

  snapshot(query = {}) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) search.set(key, String(value))
    const suffix = search.size ? `?${search}` : ''
    return this.json(`/v1/snapshot${suffix}`)
  }

  work(id) {
    return this.json(`/v1/works/${encodeURIComponent(id)}`)
  }

  conversation(conversationId, { before, limit } = {}) {
    const search = new URLSearchParams()
    if (before !== undefined) search.set('before', String(before))
    if (limit !== undefined) search.set('limit', String(limit))
    const suffix = search.size ? `?${search}` : ''
    return this.json(`/v1/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`)
  }

  command(command) {
    return this.json('/v1/commands', { method: 'POST', body: command })
  }

  /** Returns the receipt even when the product rejected the command (a legitimate business answer). */
  async dispatch(command) {
    const result = await this.request('/v1/commands', { method: 'POST', body: command })
    return { status: result.status, receipt: result.body, error: result.body?.error }
  }

  verification(id) {
    return this.json(`/v1/verifications/${encodeURIComponent(id)}`)
  }

  deliveries(questionId) {
    return this.json(`/v1/questions/${encodeURIComponent(questionId)}/deliveries`)
  }

  async artifact(id) {
    const result = await this.request(`/v1/artifacts/${encodeURIComponent(id)}`, {
      headers: { accept: '*/*' },
    })
    if (result.status !== 200)
      throw new LocalProductError(`Artifact download failed with HTTP ${result.status}`, {
        status: result.status,
        body: result.body,
      })
    const bytes = Buffer.from(result.body)
    return { bytes, sha256: sha256(bytes), contentType: result.contentType }
  }

  async events({ after = 0, timeoutMs = 1500 } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(new URL(`/v1/events?after=${after}`, this.#origin), {
      headers: { authorization: `Bearer ${this.#token}`, accept: 'text/event-stream' },
      redirect: 'manual',
      signal: controller.signal,
    }).catch((error) => {
      if (error?.name === 'AbortError') return undefined
      throw error
    })
    if (!response) return []
    if (response.status !== 200)
      throw new LocalProductError(`Event stream failed with HTTP ${response.status}`, { status: response.status })
    const text = await response.text().catch(() => '')
    clearTimeout(timer)
    return text
      .split('\n\n')
      .map((frame) => frame.split('\n').find((line) => line.startsWith('data: ')))
      .filter(Boolean)
      .map((line) => JSON.parse(line.slice(6)))
      .filter((value) => value && typeof value === 'object' && 'seq' in value)
  }
}

/** Unauthenticated or origin-varied probe used by negative cases. */
export async function rawProbe(baseURL, path, { method = 'GET', headers = {}, body } = {}) {
  const url = loopbackOrigin(baseURL)
  const response = await fetch(new URL(path, url), {
    method,
    headers,
    redirect: 'manual',
    body,
    signal: AbortSignal.timeout(5000),
  })
  return { status: response.status, headers: response.headers, body: await response.text() }
}
