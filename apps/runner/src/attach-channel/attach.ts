/**
 * Runner-side pull adapter for the concrete attach channel.
 *
 * `runner-service` does not push replies into a live socket object: the coordinator (and other
 * authenticated clients) *pull* the next outstanding request over the existing route and post the
 * reply back with the same lease identity. This adapter serves exactly that shape without keeping a
 * second pending store:
 *
 * - `bind` is the only mutating entry: explicit full producer + compare-and-swap generation.
 * - `next` is read-only. A stale or foreign connection is refused and changes nothing — polling is
 *   not a takeover.
 * - `receive` routes a reply to the lease of the connection that produced it.
 * - The outbound queue is bounded by construction (at most one entry per pending correlation, pruned
 *   on settlement/rebind/drop) and never carries a reply permission or a business lifecycle.
 */
import type {
  CoordinatorChannelLease,
  CoordinatorChannelLimits,
  CoordinatorChannelProducer,
  CoordinatorChannelRequest,
} from '../../../../packages/contracts/src/coordinator-channel.ts'
import type { CriticalFact, DurableReceipt, Json, RunnerCommand } from '../../../../packages/contracts/src/types.ts'
import { CoordinatorChannelModule, sameCoordinatorChannelProducer } from './coordinator-channel.ts'
import { CoordinatorChannelError, NativeWriteDenied } from './errors.ts'

export type AttachHooks = {
  readonly factSink: { record(fact: CriticalFact): Promise<DurableReceipt> }
  readonly payloads: { read(reference: string): Promise<Json> }
  readonly beforeNativeWrite: (command: RunnerCommand) => Promise<void>
}

export type AttachOptions = {
  readonly producer: CoordinatorChannelProducer
  readonly limits: CoordinatorChannelLimits
  readonly now?: () => number
  readonly schedule?: (delayMs: number, callback: () => void) => () => void
}

export type AttachRefusal = 'stale_connection' | 'identity_mismatch' | 'closed'

/**
 * Read-only projection of the current connection owner. It exists so a control path (command/cancel
 * admission) can ask "is this lease the live connection?" without binding, polling or caching a second
 * owner: `unbound` means no connection is bound yet, `stale_connection` means another lease owns it.
 */
export type AttachOwnership = 'owned' | 'unbound' | 'stale_connection' | 'identity_mismatch' | 'closed'

export type AttachNext =
  | {
      readonly ok: true
      readonly generation: number
      readonly request: CoordinatorChannelRequest | null
      /** Absolute deadline of the returned request; null when there is nothing outstanding. */
      readonly expiresAt: number | null
      readonly remainingMs: number | null
    }
  | { readonly ok: false; readonly generation: number; readonly refused: AttachRefusal }

export type AttachReply = {
  readonly accepted: boolean
  readonly generation: number
  readonly refused?: AttachRefusal
}

type Queued = { readonly generation: number; readonly key: string; readonly request: CoordinatorChannelRequest }

/**
 * Correlation key of an outbound request, namespaced by kind so a fact id can never collide with a
 * payload request id or a native intent id in the transport queue (the module keeps them apart too).
 */
function correlationKey(request: CoordinatorChannelRequest): string {
  return request.type === 'fact' ? `fact:${request.id}` : request.type === 'payload-read' ? `payload:${request.requestId}` : `write:${request.id}`
}

/** The same namespacing, derived from a reply that settled one of the three kinds. */
function correlationKeyOfReply(frame: unknown): string | undefined {
  if (frame === null || typeof frame !== 'object') return undefined
  const reply = frame as { readonly id?: unknown; readonly type?: unknown }
  if (typeof reply.id !== 'string' || reply.id.length === 0) return undefined
  switch (reply.type) {
    case 'receipt':
    case 'ack-failed':
      return `fact:${reply.id}`
    case 'payload':
      return `payload:${reply.id}`
    case 'write-admission':
      return `write:${reply.id}`
    default:
      return undefined
  }
}

export class RunnerAttachChannel {
  readonly #channel: CoordinatorChannelModule
  readonly #hooks: AttachHooks
  #lease: CoordinatorChannelLease | undefined
  #connectionId: string | undefined
  readonly #now: () => number
  /** Insertion-ordered, deduplicated by correlation key: at most one entry per pending request. */
  #queue: Queued[] = []

  constructor(options: AttachOptions) {
    this.#now = options.now ?? Date.now
    this.#channel = new CoordinatorChannelModule({
      ...options,
      onPendingSettled: settled => this.#dequeue(`${settled.kind}:${settled.id}`),
    })
    this.#hooks = {
      factSink: { record: fact => this.#channel.recordFact(fact) },
      payloads: { read: reference => this.#channel.readPayload(reference) },
      beforeNativeWrite: command => this.#channel.beforeNativeWrite(command),
    }
  }

  get hooks(): AttachHooks {
    return this.#hooks
  }

  get channel(): CoordinatorChannelModule {
    return this.#channel
  }

  /** Bind one authenticated connection. The only call that can change the current lease. */
  bind(input: {
    readonly producer: CoordinatorChannelProducer
    readonly connectionId: string
    readonly expectedGeneration: number
  }): number {
    const lease = this.#channel.bind({
      producer: input.producer,
      connectionId: input.connectionId,
      expectedGeneration: input.expectedGeneration,
      send: request => this.#enqueue(request),
    })
    this.#lease = lease
    this.#connectionId = input.connectionId
    this.#pruneStale(lease.generation)
    return lease.generation
  }

  /**
   * Read the next outstanding request for the current connection. Never binds, never replaces a
   * lease and never answers for another connection.
   */
  next(connectionId: string, producer: CoordinatorChannelProducer = this.#channel.producer): AttachNext {
    const generation = this.#channel.inspect().generation
    const refusal = this.#refusal(connectionId, producer)
    if (refusal) return { ok: false, generation, refused: refusal }
    this.#pruneStale(generation)
    const head = this.#queue[0]
    if (!head) return { ok: true, generation, request: null, expiresAt: null, remainingMs: null }
    const separator = head.key.indexOf(':')
    const kind = head.key.slice(0, separator) as 'fact' | 'payload' | 'write'
    const id = head.key.slice(separator + 1)
    const expiresAt = this.#channel.deadline(kind, id) ?? null
    return {
      ok: true,
      generation,
      request: head.request,
      expiresAt,
      remainingMs: expiresAt === null ? null : Math.max(0, expiresAt - this.#now()),
    }
  }

  /** Route one decoded coordinator reply to the lease of the connection that produced it. */
  receive(connectionId: string, frame: unknown, producer: CoordinatorChannelProducer = this.#channel.producer): AttachReply {
    const generation = this.#channel.inspect().generation
    const refusal = this.#refusal(connectionId, producer)
    if (refusal) return { accepted: false, generation, refused: refusal }
    const accepted = this.#lease ? this.#lease.receive(frame) : false
    if (accepted) {
      const key = correlationKeyOfReply(frame)
      if (key) this.#dequeue(key)
    }
    return { accepted, generation }
  }

  /** The connection went away: writes become indeterminate, facts/payloads wait for a rebind. */
  drop(connectionId: string, reason?: string): void {
    const lease = this.#lease
    if (!lease || this.#connectionId !== connectionId) return
    this.#lease = undefined
    this.#connectionId = undefined
    this.#queue = []
    lease.close(reason)
  }

  close(reason?: string): void {
    this.#lease = undefined
    this.#connectionId = undefined
    this.#queue = []
    this.#channel.close(reason)
  }

  inspect(): ReturnType<CoordinatorChannelModule['inspect']> {
    return this.#channel.inspect()
  }

  /**
   * Read-only ownership check used by control admission. It never binds, never polls and never
   * replaces the lease; it reports what the channel already knows so a caller cannot turn an
   * arbitrary lease id into authority while no connection (or another connection) owns the channel.
   */
  owns(connectionId: string, producer: CoordinatorChannelProducer = this.#channel.producer): AttachOwnership {
    if (this.#channel.inspect().state === 'closed') return 'closed'
    if (!this.#lease) return 'unbound'
    if (this.#connectionId !== connectionId) return 'stale_connection'
    if (!sameCoordinatorChannelProducer(producer, this.#channel.producer)) return 'identity_mismatch'
    return 'owned'
  }

  /** Size of the outbound queue for the current generation (bounded by the module's pending caps). */
  get outboundCount(): number {
    return this.#queue.length
  }

  #refusal(connectionId: string, producer: CoordinatorChannelProducer): AttachRefusal | undefined {
    if (this.#channel.inspect().state === 'closed') return 'closed'
    if (!this.#lease || this.#connectionId !== connectionId) return 'stale_connection'
    if (!sameCoordinatorChannelProducer(producer, this.#channel.producer)) return 'identity_mismatch'
    return undefined
  }

  #enqueue(request: CoordinatorChannelRequest): void {
    const generation = this.#channel.inspect().generation
    const key = correlationKey(request)
    this.#queue = this.#queue.filter(entry => entry.generation === generation && entry.key !== key)
    this.#queue.push({ generation, key, request })
  }

  #dequeue(key: string): void {
    this.#queue = this.#queue.filter(entry => entry.key !== key)
  }

  #pruneStale(generation: number): void {
    this.#queue = this.#queue.filter(entry => entry.generation === generation)
  }
}

export { CoordinatorChannelError, NativeWriteDenied }
