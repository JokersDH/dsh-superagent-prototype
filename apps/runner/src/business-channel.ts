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
}

export function createBusinessChannel(): BusinessChannel {
  // ONE store for all three kinds; the generation is part of every waiter, not of a separate map.
  const waiters = new Map<'fact' | 'payload' | 'write', Map<string, Waiter>>([
    ['fact', new Map()], ['payload', new Map()], ['write', new Map()],
  ])
  // Generation starts at 0 so the first compare-and-set bind returns 1.
  let generation = 0
  let lease: string | null = null

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
      lease = null
    },
  }
}
