/**
 * B-owned business dispatch (wave-27): one entry point for the three original callbacks.
 *
 * This consumes the 0068 coordinator-channel contract types. It replaces the three independent waiter
 * maps (fact, payload, native-write) with a single generation-scoped dispatch, so a command or a fact
 * cannot be served by two different bindings at once.
 *
 * Invariants, all local to this module:
 * - the producer comes from the original trusted registration and never changes;
 * - generation starts at 0, the first compare-and-set bind returns 1, and generations are monotonic and
 *   never reused;
 * - only the current lease receives a reply, and frames from an older lease are never forwarded;
 * - a detach rejects every pending native write as indeterminate. It grants no permission and replays no
 *   business command; the caller must return to the original command reconciliation.
 */
import {
  CoordinatorChannelLimitsSchema,
  CoordinatorChannelProducerSchema,
  CoordinatorChannelReplySchema,
  CoordinatorChannelRequestSchema,
  sameCoordinatorChannelProducer,
} from '../../../packages/contracts/src/coordinator-channel.ts'
import type {
  CoordinatorChannelLimits,
  CoordinatorChannelProducer,
  CoordinatorChannelReply,
  CoordinatorChannelRequest,
} from '../../../packages/contracts/src/coordinator-channel.ts'

export class BusinessDispatchError extends Error {
  readonly code: 'not_bound' | 'stale_generation' | 'producer_mismatch' | 'capacity' | 'indeterminate' | 'timeout'
  constructor(code: BusinessDispatchError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export type BusinessDispatchBackends = {
  /** Durable fact ACK. The original fact id is reused so A can dedupe it. */
  recordFact(fact: Extract<CoordinatorChannelRequest, { type: 'fact' }>['fact']): Promise<CoordinatorChannelReply>
  /** Immutable payload read by its original reference, under the remaining bounds. */
  readPayload(reference: string, leaseGeneration: number): Promise<CoordinatorChannelReply>
  /** The Broker's before-write admission. Never cached, never migrated between leases. */
  admitWrite(request: Extract<CoordinatorChannelRequest, { type: 'native-write-intent' }>): Promise<CoordinatorChannelReply>
}

export type BusinessDispatch = {
  readonly generation: number
  readonly limits: CoordinatorChannelLimits
  bind(producer: CoordinatorChannelProducer): { generation: number }
  detach(): void
  request(producer: CoordinatorChannelProducer, request: CoordinatorChannelRequest): Promise<CoordinatorChannelReply>
  pending(): { facts: number; payloads: number; writes: number }
}

export function createBusinessDispatch(options: {
  producer: CoordinatorChannelProducer
  backends: BusinessDispatchBackends
  limits?: Partial<CoordinatorChannelLimits>
}): BusinessDispatch {
  const trusted = CoordinatorChannelProducerSchema.parse(options.producer)
  const limits = CoordinatorChannelLimitsSchema.parse({
    maxPendingFacts: 256, maxPendingPayloads: 32, maxPendingWrites: 32,
    maxPendingBytes: 4 * 1024 * 1024, maxPayloadBytes: 2 * 1024 * 1024,
    requestTimeoutMs: 5000, maxSettledRequests: 4096, ...(options.limits ?? {}),
  })
  // ONE map per callback kind, all keyed by generation, so a stale lease can never be served.
  const pending = {
    facts: new Map<number, Map<string, Promise<CoordinatorChannelReply>>>(),
    payloads: new Map<number, Map<string, Promise<CoordinatorChannelReply>>>(),
    writes: new Map<number, Map<string, { reject: (error: BusinessDispatchError) => void; promise: Promise<CoordinatorChannelReply> }>>(),
  }
  const settled = new Set<string>()
  let generation = 0
  let bound = false
  let currentProducer: CoordinatorChannelProducer | null = null

  const bucket = <T>(store: Map<number, Map<string, T>>) => {
    const existing = store.get(generation)
    if (existing) return existing
    const created = new Map<string, T>()
    store.set(generation, created)
    return created
  }
  const count = () => ({
    facts: bucket(pending.facts).size,
    payloads: bucket(pending.payloads).size,
    writes: bucket(pending.writes).size,
  })
  const guard = (producer: CoordinatorChannelProducer) => {
    if (!bound || !currentProducer) throw new BusinessDispatchError('not_bound', 'No authenticated lease is bound to this dispatch')
    if (!sameCoordinatorChannelProducer(producer, trusted) || !sameCoordinatorChannelProducer(currentProducer, producer))
      throw new BusinessDispatchError('producer_mismatch', 'Request producer is not the registered producer of the current lease')
  }
  const withTimeout = async <T>(work: Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        work,
        new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new BusinessDispatchError('timeout', 'Business dispatch request timed out')), limits.requestTimeoutMs) }),
      ])
    } finally { if (timer) clearTimeout(timer) }
  }

  return {
    get generation() { return generation },
    limits,
    bind(producer) {
      if (!sameCoordinatorChannelProducer(producer, trusted)) throw new BusinessDispatchError('producer_mismatch', 'Only the originally registered producer may bind this dispatch')
      if (bound && sameCoordinatorChannelProducer(currentProducer, producer)) return { generation }
      // Compare-and-set: generation is monotonic, never reused, and an older lease cannot take it back.
      generation += 1
      bound = true
      currentProducer = CoordinatorChannelProducerSchema.parse(producer)
      return { generation }
    },
    detach() {
      // A pending native write becomes indeterminate. Nothing is granted, migrated or replayed.
      for (const [, waiting] of pending.writes.get(generation) ?? []) waiting.reject(new BusinessDispatchError('indeterminate', 'Native write admission is indeterminate after detach'))
      pending.writes.delete(generation)
      bound = false
      currentProducer = null
    },
    pending: count,
    async request(producer, raw) {
      guard(producer)
      const request = CoordinatorChannelRequestSchema.parse(raw)
      const lease = generation
      const key = `${lease}:${request.type}:${request.id}`
      if (settled.has(key)) throw new BusinessDispatchError('stale_generation', `Request ${request.id} was already settled for generation ${lease}`)
      if (request.type === 'fact') {
        const facts = bucket(pending.facts)
        if (facts.size >= limits.maxPendingFacts) throw new BusinessDispatchError('capacity', 'Too many pending fact acknowledgements')
        const work = withTimeout(options.backends.recordFact(request.fact)).then(reply => {
          if (generation !== lease) throw new BusinessDispatchError('stale_generation', 'Lease changed while the fact was being acknowledged')
          return CoordinatorChannelReplySchema.parse(reply)
        }).finally(() => { facts.delete(request.id); settled.add(key) })
        facts.set(request.id, work)
        return work
      }
      if (request.type === 'payload-read') {
        const payloads = bucket(pending.payloads)
        if (payloads.size >= limits.maxPendingPayloads) throw new BusinessDispatchError('capacity', 'Too many pending payload reads')
        const work = withTimeout(options.backends.readPayload(request.reference, lease)).then(reply => {
          if (generation !== lease) throw new BusinessDispatchError('stale_generation', 'Lease changed while the payload was being read')
          return CoordinatorChannelReplySchema.parse(reply)
        }).finally(() => { payloads.delete(request.id); settled.add(key) })
        payloads.set(request.id, work)
        return work
      }
      const writes = bucket(pending.writes)
      if (writes.size >= limits.maxPendingWrites) throw new BusinessDispatchError('capacity', 'Too many pending native write admissions')
      let reject!: (error: BusinessDispatchError) => void
      const promise = new Promise<CoordinatorChannelReply>((resolve, rejectFn) => {
        reject = rejectFn
        withTimeout(options.backends.admitWrite(request)).then(reply => {
          if (generation !== lease) return rejectFn(new BusinessDispatchError('stale_generation', 'Lease changed while write admission was pending'))
          resolve(CoordinatorChannelReplySchema.parse(reply))
        }).catch(rejectFn)
      }).finally(() => { writes.delete(request.id); settled.add(key) })
      writes.set(request.id, { reject, promise })
      return promise
    },
  }
}
