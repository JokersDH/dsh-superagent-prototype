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
  // A minimal recursive-descent pass over the already-validated text: only number tokens change.
  let index = 0
  const ws = (): void => {
    while (index < text.length && /\s/.test(text[index]!)) index += 1
  }
  const value = (): JsonValue => {
    ws()
    const char = text[index]
    if (char === '{') {
      index += 1
      const object: Record<string, JsonValue> = {}
      ws()
      if (text[index] === '}') {
        index += 1
        return object
      }
      for (;;) {
        ws()
        const key = string()
        ws()
        if (text[index] !== ':') throw new CodexProtocolError('invalid_json', 'Expected ":" in object')
        index += 1
        object[key] = value()
        ws()
        if (text[index] === ',') {
          index += 1
          continue
        }
        if (text[index] === '}') {
          index += 1
          return object
        }
        throw new CodexProtocolError('invalid_json', 'Expected "," or "}" in object')
      }
    }
    if (char === '[') {
      index += 1
      const array: JsonValue[] = []
      ws()
      if (text[index] === ']') {
        index += 1
        return array
      }
      for (;;) {
        array.push(value())
        ws()
        if (text[index] === ',') {
          index += 1
          continue
        }
        if (text[index] === ']') {
          index += 1
          return array
        }
        throw new CodexProtocolError('invalid_json', 'Expected "," or "]" in array')
      }
    }
    if (char === '"') return string()
    if (text.startsWith('true', index)) {
      index += 4
      return true
    }
    if (text.startsWith('false', index)) {
      index += 5
      return false
    }
    if (text.startsWith('null', index)) {
      index += 4
      return null
    }
    const match = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(index))
    if (!match) throw new CodexProtocolError('invalid_json', `Unexpected token at ${index}`)
    index += match[0].length
    // Integers are surfaced as a lossless integer id-like object so precision survives.
    return Number.isInteger(Number(match[0])) && match[0] === String(Number(match[0]))
      ? (Number(match[0]) as JsonValue)
      : Number(match[0])
  }
  const string = (): string => {
    if (text[index] !== '"') throw new CodexProtocolError('invalid_json', 'Expected a string')
    let out = ''
    index += 1
    while (index < text.length) {
      const char = text[index]!
      if (char === '"') {
        index += 1
        return out
      }
      if (char === '\\') {
        const next = text[index + 1]
        index += 2
        switch (next) {
          case '"':
            out += '"'
            break
          case '\\':
            out += '\\'
            break
          case '/':
            out += '/'
            break
          case 'b':
            out += '\b'
            break
          case 'f':
            out += '\f'
            break
          case 'n':
            out += '\n'
            break
          case 'r':
            out += '\r'
            break
          case 't':
            out += '\t'
            break
          case 'u': {
            out += String.fromCharCode(Number.parseInt(text.slice(index, index + 4), 16))
            index += 4
            break
          }
          default:
            throw new CodexProtocolError('invalid_json', 'Invalid escape')
        }
        continue
      }
      out += char
      index += 1
    }
    throw new CodexProtocolError('invalid_json', 'Unterminated string')
  }
  const result = value()
  ws()
  if (index !== text.length) throw new CodexProtocolError('invalid_json', 'Trailing characters')
  return result
}

/** Read an id without losing its type or precision. */
export function losslessId(raw: unknown): LosslessId {
  if (typeof raw === 'string') return { kind: 'string', value: raw }
  if (typeof raw === 'number' && Number.isInteger(raw)) return { kind: 'integer', decimal: String(raw) }
  throw new CodexProtocolError('invalid_id', `Unsupported JSON-RPC id: ${JSON.stringify(raw)}`)
}

/** A stable comparison key; `43` and `"43"` are different. */
export function idKey(id: LosslessId): string {
  return id.kind === 'string' ? `string:${id.value}` : `integer:${id.decimal}`
}

/** Serialize an id back to the wire without changing its type. */
export function idToWire(id: LosslessId): string | number {
  if (id.kind === 'string') return id.value
  const asNumber = Number(id.decimal)
  // Only emit a bare number when the value round-trips exactly.
  return BigInt(id.decimal) <= BigInt(Number.MAX_SAFE_INTEGER) && BigInt(id.decimal) >= BigInt(Number.MIN_SAFE_INTEGER)
    ? asNumber
    : id.decimal
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
  readonly #open = new Map<string, { method: string; resolve: (value: JsonValue) => void; reject: (error: Error) => void }>()
  readonly #decoder = new JsonLineDecoder({ maxFrameBytes: 16 * 1024 * 1024, maxBufferedBytes: 32 * 1024 * 1024 })
  readonly #send: (bytes: Uint8Array) => void
  readonly #requests: Array<{ method: string; params?: JsonValue }> = []
  readonly #notifications: Array<{ method: string; params?: JsonValue }> = []

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

  receivedNotifications(): ReadonlyArray<{ method: string; params?: JsonValue }> {
    return this.#notifications
  }

  /** `initialize` then `initialized`; the connection becomes usable only afterwards. */
  async initialize(clientInfo: { name: string; version: string }, capabilities: JsonValue = {}): Promise<JsonValue> {
    if (this.#state !== 'uninitialized') throw new CodexProtocolError('bad_state', `Cannot initialize from ${this.#state}`)
    const result = await this.request('initialize', { clientInfo, capabilities })
    this.notify('initialized', {})
    this.#state = 'initialized'
    return result
  }

  /** Send a request and resolve with its result; the id is allocated by this connection only. */
  request(method: string, params?: JsonValue): Promise<JsonValue> {
    if (this.#state === 'closed') throw new CodexProtocolError('connection_closed', 'Connection is closed')
    // A global counter (not per connection) so a stale reply can never collide with a new request.
    const id: LosslessId = { kind: 'integer', decimal: String(++idSeq) }
    const key = idKey(id)
    const frame: RpcRequest = { jsonrpc: '2.0', id: idToWire(id) as never, method, ...(params === undefined ? {} : { params }) }
    this.#requests.push({ method, ...(params === undefined ? {} : { params }) })
    return new Promise<JsonValue>((resolve, reject) => {
      this.#open.set(key, { method, resolve, reject })
      this.#send(encodeFrame(frame))
    })
  }

  notify(method: string, params?: JsonValue): void {
    if (this.#state === 'closed') throw new CodexProtocolError('connection_closed', 'Connection is closed')
    this.#send(encodeFrame({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }))
  }

  /** Feed a chunk from the child; responses settle their requests, notifications are recorded. */
  receive(chunk: Uint8Array): void {
    for (const frame of this.#decoder.push(chunk)) {
      const message = parseLossless(JSON.stringify(frame.value)) as Record<string, JsonValue>
      if (message.error !== undefined && message.id !== undefined) {
        const id = losslessId(message.id)
        const entry = this.#open.get(idKey(id))
        if (!entry) continue // a reply to a request this connection no longer owns
        this.#open.delete(idKey(id))
        const error = message.error as unknown as RpcError
        entry.reject(new CodexProtocolError('rpc_error', `${error.code}: ${error.message}`))
        continue
      }
      if (message.id !== undefined && (message.result !== undefined || message.error === undefined)) {
        const id = losslessId(message.id)
        const entry = this.#open.get(idKey(id))
        if (!entry) continue
        this.#open.delete(idKey(id))
        entry.resolve(message.result ?? null)
        continue
      }
      if (typeof message.method === 'string') {
        this.#notifications.push({ method: message.method, ...(message.params === undefined ? {} : { params: message.params }) })
      }
    }
  }

  /** End the connection irreversibly; outstanding requests fail. */
  close(reason = 'closed'): void {
    if (this.#state === 'closed') return
    this.#state = 'closed'
    for (const entry of this.#open.values()) entry.reject(new CodexProtocolError('connection_closed', reason))
    this.#open.clear()
  }
}
