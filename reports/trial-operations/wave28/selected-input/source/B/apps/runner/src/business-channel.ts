/**
 * B-owned unified business channel (wave-27).
 *
 * The Runner used to keep three independent waiter maps — one each for fact receipts, payload reads and
 * native-write admission. They could disagree about which lease they belonged to: a reply from an older
 * coordinator could settle a waiter created by a newer one. This module owns a SINGLE pending store keyed
 * by kind and generation, so every waiter is scoped to the lease that created it.
 *
 * Direction matters: these are waiters the Runner creates while it waits for the coordinator's replies.
 * Detaching a lease rejects every pending native write as indeterminate, because the Runner cannot know
 * whether the writer saw it. Nothing is granted, migrated or replayed on rebind.
 */
import type { DurableReceipt, Json } from '../../../packages/contracts/src/types.ts'

export type ChannelDetach = { reason: string; code?: 'state_indeterminate' | 'closed' }

type Waiter = { generation: number; resolve: (value: never) => void; reject: (error: Error) => void }

/** An outbound request the Runner is waiting for the coordinator to answer. */
export type ChannelOutboundRequest =
  | { type: 'fact'; id: string; fact: unknown }
  | { type: 'payload-read'; id: string; requestId: string; reference: string }
  | { type: 'native-write-intent'; id: string; command: unknown }

export type BusinessChannel = {
  readonly generation: number
  /** Compare-and-set the lease. Monotonic, never reused, and rebinding the same lease is a no-op. */
  bind(leaseRef: string): number
  awaitFact(factId: string): Promise<DurableReceipt>
  awaitPayload(requestId: string): Promise<Json>
  awaitWrite(commandId: string): Promise<void>
  resolveReceipt(factId: string, receipt: DurableReceipt): boolean
  rejectReceipt(factId: string, error: Error): boolean
  resolvePayload(requestId: string, value: Json): boolean
  resolveWrite(commandId: string, allowed: boolean): boolean
  pending(): { facts: number; payloads: number; writes: number }
  detach(detach: ChannelDetach): void
  /**
   * Bind the lease that will serve the Runner's OUTBOUND callbacks and return the next outstanding
   * request for it. `null` means the caller has nothing to do right now.
   */
  hasLease(): boolean
  leaseRef(): string | null
  /** Create a waiter AND enqueue its outbound request, so the bound lease is asked for the answer. */
  requestFact(fact: { factId: string }): Promise<DurableReceipt>
  requestPayload(requestId: string, reference: string): Promise<Json>
  requestWrite(commandId: string, command: unknown): Promise<void>
  lease(ref: string): number
  nextOutbound(): ChannelOutboundRequest | null
  /** Route one reply to the outbound request it names. A reply for another lease is refused. */
  reply(ref: string, reply: { id: string; kind: 'receipt' | 'ack-failed' | 'payload' | 'write-admission'; value?: unknown; reason?: string }): boolean
  outboundCount(): number
}

export function createBusinessChannel(): BusinessChannel {
  // ONE store for all three kinds; the generation is part of every waiter, not of a separate map.
  const waiters = new Map<'fact' | 'payload' | 'write', Map<string, Waiter>>([
    ['fact', new Map()], ['payload', new Map()], ['write', new Map()],
  ])
  // Generation starts at 0 so the first compare-and-set bind returns 1.
  let generation = 0
  let lease: string | null = null
  // Outbound callbacks, in creation order, scoped to the lease generation that created them.
  const outbound: { request: ChannelOutboundRequest; generation: number }[] = []

  const register = <T>(kind: 'fact' | 'payload' | 'write', id: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      waiters.get(kind)!.set(id, { generation, resolve: resolve as (value: never) => void, reject })
    })
  const take = (kind: 'fact' | 'payload' | 'write', id: string): Waiter | undefined => {
    const bucket = waiters.get(kind)!
    const waiter = bucket.get(id)
    // A reply that names a waiter from an older generation is ignored rather than settled across leases.
    if (!waiter || waiter.generation !== generation) return undefined
    bucket.delete(id)
    return waiter
  }

  return {
    get generation() { return generation },
    bind(leaseRef) {
      if (lease === leaseRef) return generation
      // A new lease cannot settle the previous lease's waiters, so they are settled as failures here
      // rather than left in the store to be counted or, worse, resolved across generations.
      if (lease !== null) this.detach({ reason: `lease replaced by ${leaseRef}` })
      generation += 1
      lease = leaseRef
      return generation
    },
    awaitFact: factId => register<DurableReceipt>('fact', factId),
    awaitPayload: requestId => register<Json>('payload', requestId),
    awaitWrite: commandId => register<void>('write', commandId),
    resolveReceipt(factId, receipt) {
      const waiter = take('fact', factId)
      if (!waiter) return false
      ;(waiter.resolve as unknown as (value: DurableReceipt) => void)(receipt)
      return true
    },
    rejectReceipt(factId, error) {
      const waiter = take('fact', factId)
      if (!waiter) return false
      waiter.reject(error)
      return true
    },
    resolvePayload(requestId, value) {
      const waiter = take('payload', requestId)
      if (!waiter) return false
      ;(waiter.resolve as unknown as (value: Json) => void)(value)
      return true
    },
    resolveWrite(commandId, allowed) {
      const waiter = take('write', commandId)
      if (!waiter) return false
      if (allowed) waiter.resolve(undefined as never)
      else waiter.reject(new Error('Coordinator refused native write'))
      return true
    },
    hasLease() { return lease !== null },
    leaseRef() { return lease },
    requestFact(fact) {
      const pending = this.awaitFact(fact.factId)
      outbound.push({ request: { type: 'fact', id: fact.factId, fact }, generation })
      return pending
    },
    requestPayload(requestId, reference) {
      const pending = this.awaitPayload(requestId)
      outbound.push({ request: { type: 'payload-read', id: requestId, requestId, reference }, generation })
      return pending
    },
    requestWrite(commandId, command) {
      const pending = this.awaitWrite(commandId)
      outbound.push({ request: { type: 'native-write-intent', id: commandId, command }, generation })
      return pending
    },
    lease(ref) {
      if (lease !== ref) this.bind(ref)
      return generation
    },
    nextOutbound() {
      const head = outbound.find(entry => entry.generation === generation)
      return head ? head.request : null
    },
    reply(ref, reply) {
      if (lease !== ref) return false
      const index = outbound.findIndex(entry => entry.generation === generation && entry.request.id === reply.id)
      if (index < 0) return false
      const request = outbound[index].request
      outbound.splice(index, 1)
      if (request.type === 'fact') {
        if (reply.kind === 'receipt') return this.resolveReceipt(request.id, reply.value as DurableReceipt)
        if (reply.kind === 'ack-failed') return this.rejectReceipt(request.id, Object.assign(new Error(String(reply.reason ?? 'ack failed')), { code: 'state_indeterminate', reason: 'ingress_unavailable' }))
        return false
      }
      if (request.type === 'payload-read') return reply.kind === 'payload' ? this.resolvePayload(request.requestId, reply.value as Json) : false
      return reply.kind === 'write-admission' ? this.resolveWrite(request.id, reply.value === true) : false
    },
    outboundCount() { return outbound.filter(entry => entry.generation === generation).length },
    pending() {
      return {
        facts: waiters.get('fact')!.size,
        payloads: waiters.get('payload')!.size,
        writes: waiters.get('write')!.size,
      }
    },
    detach({ reason, code = 'closed' }) {
      for (const waiter of waiters.get('write')!.values()) {
        // A pending native write is INDETERMINATE: the Runner cannot know whether the writer saw it.
        waiter.reject(Object.assign(new Error(`Native write admission is indeterminate: ${reason}`), {
          code: 'state_indeterminate', reason: 'write_indeterminate_after_detach',
        }))
      }
      for (const kind of ['fact', 'payload'] as const) {
        for (const waiter of waiters.get(kind)!.values()) waiter.reject(Object.assign(new Error(reason), { code, reason: 'channel_detached' }))
      }
      for (const bucket of waiters.values()) bucket.clear()
      // Outbound callbacks of a detached lease are dropped: a new lease must not answer for them.
      outbound.length = 0
      lease = null
    },
  }
}
