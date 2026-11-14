/**
 * Concrete CoordinatorChannel (wave-27 I).
 *
 * This module owns the whole correlation complexity that runner-service currently spreads over
 * `factWaiters`, `payloadWaiters` and `writeWaiters`: pending registration, deadline arming,
 * reply correlation, byte/pending bounds, lease generation fencing and single settlement. Callers
 * see three ordinary async callbacks plus one bind/lease pair; they never hold a second pending map,
 * a timer, a generation or a reply-dedup table.
 *
 * What this module is *not*: it creates no socket, server, database, ledger, Driver, permission or
 * execution lifecycle. `send` is the caller's already-authenticated v1 transport; `receive` is fed
 * the caller's already-decoded reply for the connection that produced the lease. Factory
 * `producer` identity is fixed at construction from the original trusted registration.
 *
 * Wire shapes are the existing frozen v1 bridge frames (`fact`, `payload-read`,
 * `native-write-intent` and their replies). Nothing here adds a wire version or changes the frozen
 * Runner hash.
 */
import {
  CoordinatorChannelLimitsSchema,
  CoordinatorChannelProducerSchema,
  CoordinatorChannelReplySchema,
  CoordinatorChannelRequestSchema,
  parseCoordinatorChannelRequest,
  sameCoordinatorChannelProducer,
} from '../../../../packages/contracts/src/coordinator-channel.ts'
import type {
  CoordinatorChannel,
  CoordinatorChannelFailure,
  CoordinatorChannelLease,
  CoordinatorChannelLimits,
  CoordinatorChannelOptions,
  CoordinatorChannelProducer,
  CoordinatorChannelReply,
  CoordinatorChannelRequest,
} from '../../../../packages/contracts/src/coordinator-channel.ts'
import { IdSchema } from '../../../../packages/contracts/src/schemas.ts'
import type { CriticalFact, DurableReceipt, Json, RunnerCommand } from '../../../../packages/contracts/src/types.ts'
import { CoordinatorChannelError, NativeWriteDenied } from './errors.ts'

type PendingBase = {
  /** Correlation key: factId, payload requestId or command id. */
  readonly key: string
  readonly request: CoordinatorChannelRequest
  readonly bytes: number
  /** Absolute monotonic deadline. Rebinding never refreshes it. */
  readonly expiresAt: number
  cancel: (() => void) | undefined
  armToken: number
}

type PendingFact = PendingBase & {
  readonly kind: 'fact'
  readonly resolve: (receipt: DurableReceipt) => void
  readonly reject: (error: Error) => void
}
type PendingPayload = PendingBase & {
  readonly kind: 'payload'
  readonly resolve: (value: Json) => void
  readonly reject: (error: Error) => void
}
type PendingWrite = PendingBase & {
  readonly kind: 'write'
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}
type Pending = PendingFact | PendingPayload | PendingWrite

type ActiveLease = {
  readonly connectionId: string
  readonly generation: number
  readonly send: (request: CoordinatorChannelRequest) => void | Promise<void>
  readonly receive: (reply: unknown) => boolean
  readonly close: (reason?: string) => void
}

const DEFAULT_LIMITS: CoordinatorChannelLimits = CoordinatorChannelLimitsSchema.parse({
  maxPendingFacts: 64,
  maxPendingPayloads: 16,
  maxPendingWrites: 8,
  maxPendingBytes: 1024 * 1024,
  maxPayloadBytes: 512 * 1024,
  requestTimeoutMs: 30_000,
  maxSettledRequests: 256,
})

const defaultNow = (): number => Date.now()

function defaultSchedule(delayMs: number, callback: () => void): () => void {
  const handle = setTimeout(callback, delayMs)
  if (typeof (handle as { unref?: () => void }).unref === 'function') (handle as { unref: () => void }).unref()
  return () => clearTimeout(handle)
}

function encodedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry)
    Object.freeze(value)
  }
  return value
}

/** Same producer tuple comparison the shared contract defines; re-exported for the adapter. */
export { sameCoordinatorChannelProducer }

export class CoordinatorChannelModule implements CoordinatorChannel {
  readonly #producer: CoordinatorChannelProducer
  readonly #limits: CoordinatorChannelLimits
  readonly #now: () => number
  readonly #schedule: (delayMs: number, callback: () => void) => () => void

  #generation = 0
  #lease: ActiveLease | undefined
  #closed = false

  readonly #facts = new Map<string, PendingFact>()
  readonly #payloads = new Map<string, PendingPayload>()
  readonly #writes = new Map<string, PendingWrite>()
  #pendingBytes = 0

  /** Bounded record of settled correlation keys: late/duplicate replies are recognised, not revived. */
  readonly #settled: string[] = []
  readonly #settledSet = new Set<string>()

  #payloadSeq = 0
  #timerSeq = 0

  constructor(options: CoordinatorChannelOptions) {
    const producer = CoordinatorChannelProducerSchema.safeParse(options.producer)
    if (!producer.success) throw new CoordinatorChannelError('identity_mismatch', 'producer_invalid')
    const limits = CoordinatorChannelLimitsSchema.safeParse(options.limits)
    if (!limits.success) throw new CoordinatorChannelError('protocol_error', 'limits_invalid')
    this.#producer = deepFreeze(producer.data)
    this.#limits = limits.data
    this.#now = options.now ?? defaultNow
    this.#schedule = options.schedule ?? defaultSchedule
  }

  get producer(): CoordinatorChannelProducer {
    return this.#producer
  }

  bind(input: {
    readonly producer: CoordinatorChannelProducer
    readonly connectionId: string
    readonly expectedGeneration: number
    readonly send: (request: CoordinatorChannelRequest) => void | Promise<void>
  }): CoordinatorChannelLease {
    if (this.#closed) throw new CoordinatorChannelError('closed', 'module_closed')
    if (!sameCoordinatorChannelProducer(input.producer, this.#producer))
      throw new CoordinatorChannelError('identity_mismatch', 'producer_mismatch')
    if (!IdSchema.safeParse(input.connectionId).success)
      throw new CoordinatorChannelError('protocol_error', 'connection_id_invalid', 'connectionId must be a bounded id')
    if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0)
      throw new CoordinatorChannelError('protocol_error', 'generation_invalid', 'expectedGeneration must be a non-negative safe integer')
    if (typeof input.send !== 'function') throw new CoordinatorChannelError('protocol_error', 'send_invalid')
    // Compare-and-swap. A failed CAS leaves the current lease, its pendings and its timers untouched.
    if (input.expectedGeneration !== this.#generation)
      throw new CoordinatorChannelError('stale_connection', 'generation_mismatch', 'bind expected a different generation')
    if (this.#generation >= Number.MAX_SAFE_INTEGER)
      throw new CoordinatorChannelError('stale_connection', 'generation_exhausted', 'connection generation is exhausted')

    // Invalidate the previous lease before installing the replacement: exactly one lease is live.
    this.#lease = undefined
    this.#generation += 1
    const generation = this.#generation

    const lease: ActiveLease = {
      connectionId: input.connectionId,
      generation,
      send: input.send,
      receive: reply => {
        // Fencing is structural: replies are accepted only from the lease object of the
        // connection that produced them, and only while that lease is the current one.
        if (this.#closed || this.#lease !== lease) return false
        return this.#receive(reply)
      },
      close: reason => {
        void reason
        // An old lease closing is a no-op; it can never close the replacement or the attempt.
        if (this.#lease !== lease) return
        this.#lease = undefined
        // A native write whose socket vanished is *unknown*, never "not sent": the caller must
        // reconcile the original command before asking again.
        for (const pending of [...this.#writes.values()])
          this.#settleFailure(pending, new CoordinatorChannelError('indeterminate', 'lease_closed_during_write'))
        // Facts and payload reads stay pending: a replacement lease can resend/re-read them with
        // their original identity inside the already-running deadline.
      },
    }
    this.#lease = lease

    for (const pending of [...this.#writes.values()])
      this.#settleFailure(pending, new CoordinatorChannelError('indeterminate', 'connection_replaced_during_write'))
    for (const pending of [...this.#facts.values()]) this.#resend(pending)
    for (const pending of [...this.#payloads.values()]) this.#resend(pending)

    return lease
  }

  recordFact(fact: CriticalFact): Promise<DurableReceipt> {
    return new Promise<DurableReceipt>((resolve, reject) => {
      let request: CoordinatorChannelRequest
      try {
        this.#assertUsable()
        request = this.#request({ v: 1, type: 'fact', id: fact.factId, fact })
      } catch (error) {
        reject(error)
        return
      }
      const key = String(fact.factId)
      if (this.#facts.has(key)) {
        reject(new CoordinatorChannelError('protocol_error', 'fact_already_pending', `fact ${key} is already awaiting its receipt`))
        return
      }
      const bytes = encodedBytes(request)
      try {
        this.#admit('fact', bytes)
      } catch (error) {
        reject(error)
        return
      }
      const pending: PendingFact = {
        kind: 'fact', key, request, bytes, expiresAt: this.#now() + this.#limits.requestTimeoutMs,
        cancel: undefined, armToken: 0, resolve, reject,
      }
      this.#register(pending)
      this.#arm(pending, this.#limits.requestTimeoutMs)
      this.#dispatch(pending)
    })
  }

  readPayload(reference: string): Promise<Json> {
    return new Promise<Json>((resolve, reject) => {
      let request: CoordinatorChannelRequest
      let requestId: string
      try {
        this.#assertUsable()
        if (!IdSchema.safeParse(reference).success)
          throw new CoordinatorChannelError('protocol_error', 'payload_reference_invalid', 'payload reference must be a bounded id')
        requestId = `payload-${++this.#payloadSeq}`
        // A payload reference carries no producer tuple of its own: the original Store/responder
        // still decides content and permission, and the module only correlates the immutable read.
        request = this.#anonymousRequest({ v: 1, type: 'payload-read', id: requestId, requestId, reference })
      } catch (error) {
        reject(error)
        return
      }
      const bytes = encodedBytes(request)
      try {
        this.#admit('payload', bytes)
      } catch (error) {
        reject(error)
        return
      }
      const pending: PendingPayload = {
        kind: 'payload', key: requestId, request, bytes, expiresAt: this.#now() + this.#limits.requestTimeoutMs,
        cancel: undefined, armToken: 0, resolve, reject,
      }
      this.#register(pending)
      this.#arm(pending, this.#limits.requestTimeoutMs)
      this.#dispatch(pending)
    })
  }

  beforeNativeWrite(command: RunnerCommand): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let request: CoordinatorChannelRequest
      try {
        this.#assertUsable()
        if (command.kind !== 'answer')
          throw new CoordinatorChannelError('protocol_error', 'unsupported_command', 'only the answer hook requests native write admission')
        request = this.#request({ v: 1, type: 'native-write-intent', id: command.id, command })
      } catch (error) {
        reject(error)
        return
      }
      const key = String(command.id)
      if (this.#writes.has(key)) {
        reject(new CoordinatorChannelError('protocol_error', 'write_already_pending', `native write ${key} is already pending`))
        return
      }
      const bytes = encodedBytes(request)
      try {
        this.#admit('write', bytes)
      } catch (error) {
        reject(error)
        return
      }
      const pending: PendingWrite = {
        kind: 'write', key, request, bytes, expiresAt: this.#now() + this.#limits.requestTimeoutMs,
        cancel: undefined, armToken: 0, resolve, reject,
      }
      this.#register(pending)
      this.#arm(pending, this.#limits.requestTimeoutMs)
      this.#dispatch(pending)
    })
  }

  close(reason?: string): void {
    void reason
    if (this.#closed) return
    this.#closed = true
    this.#lease = undefined
    for (const pending of [...this.#facts.values()])
      this.#settleFailure(pending, new CoordinatorChannelError('closed', 'module_closed'))
    for (const pending of [...this.#payloads.values()])
      this.#settleFailure(pending, new CoordinatorChannelError('closed', 'module_closed'))
    // Closing communication says nothing about a pending native write: keep it unknown.
    for (const pending of [...this.#writes.values()])
      this.#settleFailure(pending, new CoordinatorChannelError('indeterminate', 'module_closed_during_write'))
    this.#settled.length = 0
    this.#settledSet.clear()
  }

  inspect(): {
    readonly state: 'unbound' | 'bound' | 'closed'
    readonly generation: number
    readonly pendingFacts: number
    readonly pendingPayloads: number
    readonly pendingWrites: number
    readonly pendingBytes: number
  } {
    return {
      state: this.#closed ? 'closed' : this.#lease ? 'bound' : 'unbound',
      generation: this.#generation,
      pendingFacts: this.#facts.size,
      pendingPayloads: this.#payloads.size,
      pendingWrites: this.#writes.size,
      pendingBytes: this.#pendingBytes,
    }
  }

  // --- internals ------------------------------------------------------------

  #assertUsable(): void {
    if (this.#closed) throw new CoordinatorChannelError('closed', 'module_closed')
    if (!this.#lease) throw new CoordinatorChannelError('stale_connection', 'not_bound', 'no active connection lease')
  }

  /** Parse a producer-less v1 request shape (payload reads only) and freeze it. */
  #anonymousRequest(draft: unknown): CoordinatorChannelRequest {
    const parsed = CoordinatorChannelRequestSchema.safeParse(draft)
    if (!parsed.success || parsed.data.type !== 'payload-read')
      throw new CoordinatorChannelError('protocol_error', 'request_invalid', 'request does not match a v1 channel frame')
    return deepFreeze(parsed.data)
  }

  /**
   * Build a frozen v1 request through the shared contract parser, so the registered producer — not
   * the request's own claim — decides ownership.
   */
  /**
   * Build a frozen v1 request through the shared contract parser. The producer handed to the parser is
   * always this module's constructor registration — never the identity the request itself claims.
   */
  #request(draft: unknown): CoordinatorChannelRequest {
    const parsed = CoordinatorChannelRequestSchema.safeParse(draft)
    if (!parsed.success) throw new CoordinatorChannelError('protocol_error', 'request_invalid', 'request does not match a v1 channel frame')
    try {
      return deepFreeze(parseCoordinatorChannelRequest(parsed.data, this.#producer))
    } catch {
      throw new CoordinatorChannelError('identity_mismatch', 'producer_mismatch', 'request does not belong to the registered producer')
    }
  }

  #admit(kind: 'fact' | 'payload' | 'write', bytes: number): void {
    if (kind === 'fact' && this.#facts.size >= this.#limits.maxPendingFacts)
      throw new CoordinatorChannelError('capacity', 'pending_facts', 'too many facts are awaiting receipts')
    if (kind === 'payload' && this.#payloads.size >= this.#limits.maxPendingPayloads)
      throw new CoordinatorChannelError('capacity', 'pending_payloads', 'too many payload reads are pending')
    if (kind === 'write' && this.#writes.size >= this.#limits.maxPendingWrites)
      throw new CoordinatorChannelError('capacity', 'pending_writes', 'too many write admissions are pending')
    if (this.#pendingBytes + bytes > this.#limits.maxPendingBytes)
      throw new CoordinatorChannelError('capacity', 'pending_bytes', 'pending request bytes exceed the channel bound')
  }

  #register(pending: Pending): void {
    if (pending.kind === 'fact') this.#facts.set(pending.key, pending)
    else if (pending.kind === 'payload') this.#payloads.set(pending.key, pending)
    else this.#writes.set(pending.key, pending)
    this.#pendingBytes += pending.bytes
  }

  #arm(pending: Pending, delayMs: number): void {
    const token = ++this.#timerSeq
    pending.armToken = token
    pending.cancel = this.#schedule(Math.max(1, delayMs), () => {
      if (pending.armToken !== token) return
      if (this.#current(pending.kind, pending.key) !== pending) return
      const taken = this.#take(pending.kind, pending.key)
      if (!taken) return
      taken.reject(new CoordinatorChannelError('timeout', 'request_timeout', `request ${taken.key} timed out`))
    })
  }

  #current(kind: Pending['kind'], key: string): Pending | undefined {
    if (kind === 'fact') return this.#facts.get(key)
    if (kind === 'payload') return this.#payloads.get(key)
    return this.#writes.get(key)
  }

  /** Remove a pending and release its timer, bytes and correlation slot exactly once. */
  #take(kind: Pending['kind'], key: string): Pending | undefined {
    const map = kind === 'fact' ? this.#facts : kind === 'payload' ? this.#payloads : this.#writes
    const pending = map.get(key)
    if (!pending) return undefined
    map.delete(key)
    if (pending.cancel) {
      pending.cancel()
      pending.cancel = undefined
    }
    pending.armToken = 0
    this.#pendingBytes = Math.max(0, this.#pendingBytes - pending.bytes)
    this.#recordSettled(key)
    return pending
  }

  #recordSettled(key: string): void {
    if (this.#settledSet.has(key)) return
    this.#settledSet.add(key)
    this.#settled.push(key)
    while (this.#settled.length > this.#limits.maxSettledRequests) {
      const evicted = this.#settled.shift()
      if (evicted !== undefined) this.#settledSet.delete(evicted)
    }
  }

  #settleFailure(pending: Pending, error: Error): void {
    const taken = this.#take(pending.kind, pending.key)
    if (!taken) return
    taken.reject(error)
  }

  #dispatch(pending: Pending): void {
    const lease = this.#lease
    if (!lease) {
      this.#settleFailure(pending, new CoordinatorChannelError('stale_connection', 'not_bound', 'no active connection lease'))
      return
    }
    const generation = lease.generation
    let outcome: void | Promise<void>
    try {
      outcome = lease.send(pending.request)
    } catch {
      // The frame never left: nothing was written and the request can be asked for again.
      this.#settleFailure(pending, new CoordinatorChannelError('stale_connection', 'send_failed', `request ${pending.key} could not be sent`))
      return
    }
    if (outcome && typeof (outcome as PromiseLike<void>).then === 'function') {
      void Promise.resolve(outcome).catch(() => {
        // A rejected async send may already have flushed part of the frame. Facts are idempotent and
        // payload reads are safe to repeat, but a native intent's fate is genuinely unknown.
        if (this.#lease?.generation !== generation) return
        if (this.#current(pending.kind, pending.key) !== pending) return
        this.#settleFailure(pending,
          pending.kind === 'write'
            ? new CoordinatorChannelError('indeterminate', 'write_intent_send_failed')
            : new CoordinatorChannelError('stale_connection', 'send_failed'))
      })
    }
  }

  /** Re-send one surviving pending on the current lease without refreshing its deadline. */
  #resend(pending: Pending): void {
    if (this.#current(pending.kind, pending.key) !== pending) return
    const remaining = pending.expiresAt - this.#now()
    if (remaining <= 0) {
      this.#settleFailure(pending, new CoordinatorChannelError('timeout', 'request_timeout', `request ${pending.key} timed out`))
      return
    }
    if (pending.cancel) {
      pending.cancel()
      pending.cancel = undefined
    }
    this.#arm(pending, remaining)
    this.#dispatch(pending)
  }

  #receive(reply: unknown): boolean {
    const parsed = CoordinatorChannelReplySchema.safeParse(reply)
    if (!parsed.success) return false
    const value: CoordinatorChannelReply = parsed.data
    switch (value.type) {
      case 'receipt': {
        const pending = this.#facts.get(value.factId)
        if (!pending) return false
        if (pending.request.type !== 'fact' || pending.request.fact.factId !== value.factId) return false
        const taken = this.#take('fact', value.factId)
        if (!taken) return false
        taken.resolve(value.receipt)
        return true
      }
      case 'ack-failed': {
        const pending = this.#facts.get(value.factId)
        if (!pending) return false
        const taken = this.#take('fact', value.factId) as PendingFact | undefined
        if (!taken) return false
        taken.reject(new CoordinatorChannelError('protocol_error', 'fact_ack_failed',
          `coordinator refused fact ${value.factId}: ${value.reason.slice(0, 160)}`))
        return true
      }
      case 'payload': {
        const pending = this.#payloads.get(value.requestId)
        if (!pending) return false
        let bytes: number
        try {
          bytes = encodedBytes(value.value)
        } catch {
          const taken = this.#take('payload', value.requestId)
          if (!taken) return false
          taken.reject(new CoordinatorChannelError('protocol_error', 'payload_unserializable'))
          return true
        }
        if (bytes > this.#limits.maxPayloadBytes) {
          const taken = this.#take('payload', value.requestId)
          if (!taken) return false
          taken.reject(new CoordinatorChannelError('capacity', 'payload_bytes', `payload ${value.requestId} exceeds the channel byte bound`))
          return true
        }
        const taken = this.#take('payload', value.requestId) as PendingPayload | undefined
        if (!taken) return false
        taken.resolve(value.value)
        return true
      }
      case 'write-admission': {
        const pending = this.#writes.get(value.id)
        if (!pending) return false
        const taken = this.#take('write', value.id) as PendingWrite | undefined
        if (!taken) return false
        if (value.allowed) taken.resolve()
        else taken.reject(new NativeWriteDenied(value.id))
        return true
      }
      default:
        return false
    }
  }
}

export { DEFAULT_LIMITS, CoordinatorChannelError, NativeWriteDenied }
export type { CoordinatorChannelFailure, CoordinatorChannelLease }
