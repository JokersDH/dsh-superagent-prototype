/**
 * Minimal ACP v1 JSON-RPC line protocol.
 *
 * Transport is newline-delimited JSON on the agent's stdio. Requests and responses are correlated by
 * JSON-RPC id; agent-initiated requests (e.g. session/request_permission) keep their original id so an
 * answer can name the exact native request. This module does not spawn, prompt or interpret tool
 * permissions; the Driver does that.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export type AcpIncoming =
  | { kind: 'response'; id: number | string; result?: Json; error?: Json }
  | { kind: 'request'; id: number | string; method: string; params?: Json }
  | { kind: 'notification'; method: string; params?: Json }

export class AcpProtocolError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.code = code; this.name = 'AcpProtocolError' }
}

export class AcpConnection {
  readonly #send: (bytes: Uint8Array) => void
  readonly #pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void }>()
  readonly #requests: Array<{ id: number | string; method: string; params?: Json }> = []
  readonly #notifications: Array<{ method: string; params?: Json }> = []
  #nextId = 1
  #closed = false
  #buffer = ''

  constructor(send: (bytes: Uint8Array) => void) {
    this.#send = send
  }

  receive(chunk: Uint8Array): void {
    this.#buffer += Buffer.from(chunk).toString('utf8')
    for (;;) {
      const newline = this.#buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.#buffer.slice(0, newline).trim()
      this.#buffer = this.#buffer.slice(newline + 1)
      if (!line) continue
      let message: Record<string, Json>
      try { message = JSON.parse(line) as Record<string, Json> } catch { throw new AcpProtocolError('invalid_json', 'ACP frame was not JSON') }
      this.#dispatch(message)
    }
  }

  #dispatch(message: Record<string, Json>): void {
    if (typeof message.method === 'string') {
      if ('id' in message && message.id !== null && message.id !== undefined) {
        this.#requests.push({ id: message.id as number | string, method: message.method, ...(message.params === undefined ? {} : { params: message.params }) })
      } else {
        this.#notifications.push({ method: message.method, ...(message.params === undefined ? {} : { params: message.params }) })
      }
      return
    }
    const id = message.id as number | string | undefined
    if (typeof id !== 'number') throw new AcpProtocolError('invalid_response_id', 'ACP response id must be numeric')
    const pending = this.#pending.get(id)
    if (!pending) return
    this.#pending.delete(id)
    if ('error' in message) pending.reject(new AcpProtocolError('acp_error', JSON.stringify(message.error)))
    else pending.resolve(message.result ?? null)
  }

  request(method: string, params?: Json): Promise<Json> {
    if (this.#closed) return Promise.reject(new AcpProtocolError('closed', 'ACP connection is closed'))
    const id = this.#nextId++
    const frame = { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }
    this.#send(Buffer.from(JSON.stringify(frame) + '\n', 'utf8'))
    return new Promise<Json>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      // A request that never resolves is the caller's timeout responsibility, not a silent retry.
    })
  }

  notify(method: string, params?: Json): void {
    if (this.#closed) return
    this.#send(Buffer.from(JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }) + '\n', 'utf8'))
  }

  respond(id: number | string, result: Json): void {
    if (this.#closed) return
    this.#send(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n', 'utf8'))
  }

  respondError(id: number | string, code: number, message: string): void {
    if (this.#closed) return
    this.#send(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n', 'utf8'))
  }

  takeRequests(): Array<{ id: number | string; method: string; params?: Json }> {
    return this.#requests.splice(0)
  }

  takeNotifications(): Array<{ method: string; params?: Json }> {
    return this.#notifications.splice(0)
  }

  rejectAll(reason: string): void {
    this.#closed = true
    for (const pending of this.#pending.values()) pending.reject(new AcpProtocolError('closed', reason))
    this.#pending.clear()
  }

  close(reason = 'closed'): void {
    this.rejectAll(reason)
  }
}

export const ACP_PROTOCOL_VERSION = 1
