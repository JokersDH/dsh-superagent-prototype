/**
 * Codex app-server protocol layer (WP-07).
 *
 * The native surface is JSON-RPC 2.0 over stdio, newline-delimited. This module owns only the wire
 * mechanics and identity rules; it does not interpret business meaning (that is the Driver's job) and
 * does not reach into any other protocol (Codex is not ACP).
 *
 * Two rules are load-bearing and are enforced here rather than in the Driver:
 *
 * 1. **Request ids are lossless.** JSON numbers are parsed as raw tokens and kept as strings, so
 *    `43` and `"43"` stay different and integers beyond 2^53 survive untouched. A response is matched
 *    to the exact closed request that produced it.
 * 2. **Ids are never reused across connections.** Each connection has its own closed id set; a reply
 *    from an older connection can never satisfy a request on a newer one.
 */
import { JsonLineDecoder, encodeFrame } from '../../../driver-kit/src/index.ts'

export const CODEX_WIRE = 'app-server/jsonrpc2' as const

/** A JSON value with numbers preserved exactly. */
export type JsonValue = null | boolean | string | number | JsonValue[] | { [key: string]: JsonValue }

/** A JSON-RPC id exactly as it appeared: `kind` distinguishes a string id from an integer id. */
export type LosslessId = { kind: 'string'; value: string } | { kind: 'integer'; decimal: string }

export type RpcError = { code: number; message: string; data?: JsonValue }

export type RpcRequest = { jsonrpc: '2.0'; id: LosslessId; method: string; params?: JsonValue }
export type RpcNotification = { jsonrpc: '2.0'; method: string; params?: JsonValue }
export type RpcResponse = { jsonrpc: '2.0'; id: LosslessId; result?: JsonValue; error?: RpcError }
const integerTokens = new WeakSet<object>()

export class CodexProtocolError extends Error {
  readonly code = 'protocol_error'
  readonly reason: string
  constructor(reason: string, message: string) {
    super(message)
    this.name = 'CodexProtocolError'
    this.reason = reason
  }
}

/**
 * Parse JSON preserving integer precision: numbers are returned as a tagged object so no value is
 * silently rounded by `JSON.parse`.
 */
export function parseLossless(text: string): JsonValue {
  try {
    const parse = JSON.parse as (
      text: string,
      reviver: (key: string, value: unknown, context: { source?: string }) => unknown,
    ) => JsonValue
    return parse(text, (key, value, context) => {
      if ((key === 'id' || key === 'requestId') && typeof value === 'number' && !Number.isSafeInteger(value)) {
        if (
          !context.source ||
          !/^-?\d{1,19}$/.test(context.source) ||
          BigInt(context.source) < -9223372036854775808n ||
          BigInt(context.source) > 9223372036854775807n
        )
          throw new Error('Invalid integer request id')
        const token = { kind: 'integer', decimal: context.source }
        integerTokens.add(token)
        return token
      }
      return value
    })
  } catch {
    throw new CodexProtocolError('invalid_json', 'Invalid native JSON message')
  }
}

/** Read an id without losing its type or precision. */
export function losslessId(raw: unknown): LosslessId {
  if (typeof raw === 'string') return { kind: 'string', value: raw }
  if (typeof raw === 'number' && Number.isSafeInteger(raw)) return { kind: 'integer', decimal: String(raw) }
  if (raw && typeof raw === 'object' && integerTokens.has(raw) && 'decimal' in raw && typeof raw.decimal === 'string')
    return { kind: 'integer', decimal: raw.decimal }
  throw new CodexProtocolError('invalid_id', `Unsupported JSON-RPC id: ${JSON.stringify(raw)}`)
}

/** A stable comparison key; `43` and `"43"` are different. */
export function idKey(id: LosslessId): string {
  return id.kind === 'string' ? `string:${id.value}` : `integer:${id.decimal}`
}

/** Serialize an id back to the wire without changing its type. */
export function idToWire(id: LosslessId): JsonValue {
  if (id.kind === 'string') return id.value
  if (
    !/^-?\d{1,19}$/.test(id.decimal) ||
    BigInt(id.decimal) < -9223372036854775808n ||
    BigInt(id.decimal) > 9223372036854775807n
  )
    throw new CodexProtocolError('invalid_id', 'Native integer request id is outside int64')
  const asNumber = Number(id.decimal)
  // Only emit a bare number when the value round-trips exactly.
  return BigInt(id.decimal) <= BigInt(Number.MAX_SAFE_INTEGER) && BigInt(id.decimal) >= BigInt(Number.MIN_SAFE_INTEGER)
    ? asNumber
    : (JSON as unknown as { rawJSON(value: string): JsonValue }).rawJSON(id.decimal)
}

export type SessionState = 'uninitialized' | 'initialized' | 'closed'

/**
 * One JSON-RPC connection to a Codex app-server child.
 *
 * A connection is single-use: `closed` is irreversible, and ids allocated on it are never handed out
 * again, so a late reply from a dead connection can never be mistaken for a live one.
 */
/** Process-wide id source: ids are never reused across connections. */
let connectionSeq = 0
let idSeq = 0

export class CodexConnection {
  #state: SessionState = 'uninitialized'
  readonly #epoch = ++connectionSeq
  /** Server-initiated requests this connection is still allowed to answer. */
  readonly #serverRequests = new Map<string, LosslessId>()
  readonly #open = new Map<
    string,
    {
      method: string
      resolve: (value: JsonValue) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  readonly #decoder = new JsonLineDecoder({
    maxFrameBytes: 16 * 1024 * 1024,
    maxBufferedBytes: 32 * 1024 * 1024,
    parse: parseLossless,
  })
  readonly #send: (bytes: Uint8Array) => void
  readonly #requests: Array<{ method: string; params?: JsonValue }> = []
  readonly #notifications: Array<{ method: string; params?: JsonValue; id?: JsonValue }> = []
  #notificationBytes = 0

  constructor(send: (bytes: Uint8Array) => void) {
    this.#send = send
  }

  get state(): SessionState {
    return this.#state
  }

  get pending(): number {
    return this.#open.size
  }

  /** Connection epoch; ids from a different epoch never match. */
  get epoch(): number {
    return this.#epoch
  }

  /** Methods this connection sent, in order (goldens use this). */
  sentRequests(): ReadonlyArray<{ method: string; params?: JsonValue }> {
    return this.#requests
  }

  receivedNotifications(): ReadonlyArray<{ method: string; params?: JsonValue; id?: JsonValue }> {
    return this.#notifications
  }
  drainNotifications() {
    this.#notificationBytes = 0
    return this.#notifications.splice(0)
  }

  /** `initialize` then `initialized`; the connection becomes usable only afterwards. */
  async initialize(clientInfo: { name: string; version: string }, capabilities: JsonValue = {}): Promise<JsonValue> {
    if (this.#state !== 'uninitialized')
      throw new CodexProtocolError('bad_state', `Cannot initialize from ${this.#state}`)
    const result = await this.request('initialize', { clientInfo, capabilities })
    this.notify('initialized', {})
    this.#state = 'initialized'
    return result
  }

  /** Send a request and resolve with its result; the id is allocated by this connection only. */
  request(method: string, params?: JsonValue): Promise<JsonValue> {
    if (this.#state === 'closed') throw new CodexProtocolError('connection_closed', 'Connection is closed')
    if (this.#open.size >= 256) throw new CodexProtocolError('request_capacity', 'Too many native requests')
    // A global counter (not per connection) so a stale reply can never collide with a new request.
    const id: LosslessId = { kind: 'integer', decimal: String(++idSeq) }
    const key = idKey(id)
    const frame: RpcRequest = {
      jsonrpc: '2.0',
      id: idToWire(id) as never,
      method,
      ...(params === undefined ? {} : { params }),
    }
    this.#requests.push({ method, ...(params === undefined ? {} : { params }) })
    if (this.#requests.length > 256) this.#requests.shift()
    return new Promise<JsonValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#open.delete(key)
        reject(new CodexProtocolError('request_timeout', `Native ${method} request timed out`))
      }, 30000)
      timer.unref()
      this.#open.set(key, { method, resolve, reject, timer })
      try {
        this.#send(encodeFrame(frame))
      } catch (error) {
        clearTimeout(timer)
        this.#open.delete(key)
        reject(error as Error)
      }
    })
  }

  notify(method: string, params?: JsonValue): void {
    if (this.#state === 'closed') throw new CodexProtocolError('connection_closed', 'Connection is closed')
    this.#send(encodeFrame({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }))
  }

  /**
   * Record a server-initiated request (an approval or user-input prompt) this connection may answer.
   *
   * The request id is stored losslessly; a later `answer` can only succeed on the connection that
   * received it, so a stale binding from an older connection is refused rather than replayed.
   */
  trackServerRequest(id: LosslessId): void {
    if (this.#serverRequests.has(idKey(id)))
      throw new CodexProtocolError('duplicate_server_request', 'Native request id was reused while pending')
    if (this.#serverRequests.size >= 256)
      throw new CodexProtocolError('request_capacity', 'Too many native server requests')
    this.#serverRequests.set(idKey(id), id)
  }

  /** Claim a tracked server request for an answer; throws when this connection never received it. */
  claimServerRequest(nativeBindingRef: string | LosslessId): LosslessId {
    const claimed =
      typeof nativeBindingRef === 'string'
        ? (this.#serverRequests.get(`string:${nativeBindingRef}`) ??
          this.#serverRequests.get(`integer:${nativeBindingRef}`))
        : this.#serverRequests.get(idKey(nativeBindingRef))
    if (!claimed) {
      throw new CodexProtocolError(
        'stale_server_request',
        'No such server request on this connection; it is stale or belongs to another connection',
      )
    }
    return claimed
  }

  /** Send the reply to a server request, then forget it (each request is answered at most once). */
  replyToServerRequest(id: LosslessId, result: JsonValue): void {
    if (this.#state === 'closed') throw new CodexProtocolError('connection_closed', 'Connection is closed')
    const key = idKey(id)
    if (!this.#serverRequests.has(key)) {
      throw new CodexProtocolError(
        'stale_server_request',
        `Server request ${key} was already answered or never received`,
      )
    }
    this.#serverRequests.delete(key)
    this.#send(encodeFrame({ jsonrpc: '2.0', id: idToWire(id) as never, result }))
  }

  /** Server requests still awaiting an answer on this connection. */
  pendingServerRequests(): string[] {
    return [...this.#serverRequests.keys()]
  }

  /** Feed a chunk from the child; responses settle their requests, notifications are recorded. */
  receive(chunk: Uint8Array): void {
    if (this.#state === 'closed') return
    for (const frame of this.#decoder.push(chunk)) {
      const message = frame.value as Record<string, JsonValue>
      if (!message || typeof message !== 'object' || Array.isArray(message))
        throw new CodexProtocolError('invalid_frame', 'Native frame must be an object')
      if (message.error !== undefined && message.id !== undefined) {
        const id = losslessId(message.id)
        const entry = this.#open.get(idKey(id))
        if (!entry) continue // a reply to a request this connection no longer owns
        this.#open.delete(idKey(id))
        clearTimeout(entry.timer)
        const error = message.error as unknown as RpcError
        entry.reject(new CodexProtocolError('rpc_error', `${error.code}: ${error.message}`))
        continue
      }
      // A server *request* also carries an `id`, but it is neither a result nor an error: it has a
      // `method` and must be recorded as an incoming request, not treated as a reply.
      if (message.id !== undefined && message.method === undefined) {
        if (message.result === undefined)
          throw new CodexProtocolError('invalid_response', 'Native response needs a result or error')
        const id = losslessId(message.id)
        const entry = this.#open.get(idKey(id))
        if (!entry) continue
        this.#open.delete(idKey(id))
        clearTimeout(entry.timer)
        entry.resolve(message.result ?? null)
        continue
      }
      if (typeof message.method === 'string') {
        this.#notificationBytes += frame.bytes
        if (this.#notifications.length >= 4096 || this.#notificationBytes > 8 * 1024 * 1024)
          throw new CodexProtocolError('notification_capacity', 'Native notification backlog exceeded its bound')
        // A server-initiated request keeps its top-level id; a plain notification has none.
        this.#notifications.push({
          method: message.method,
          ...(message.params === undefined ? {} : { params: message.params }),
          ...(message.id === undefined ? {} : { id: message.id }),
        })
      }
    }
  }

  /** End the connection irreversibly; outstanding requests fail. */
  close(reason = 'closed'): void {
    if (this.#state === 'closed') return
    this.#state = 'closed'
    for (const entry of this.#open.values()) {
      clearTimeout(entry.timer)
      entry.reject(new CodexProtocolError('connection_closed', reason))
    }
    this.#open.clear()
    this.#serverRequests.clear()
    this.#notifications.splice(0)
    this.#notificationBytes = 0
  }
}
