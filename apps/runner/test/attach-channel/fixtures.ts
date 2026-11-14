/**
 * Shared fixtures for the attach-channel tests.
 *
 * These are ordinary local doubles, not product authorities. In particular `DurableSink` models the
 * *idempotency contract* A's durable ingress provides (same fact id replays the same receipt, a
 * conflicting body is refused); it proves nothing about real persistence.
 */
import type {
  CoordinatorChannelRequest,
  CoordinatorChannelReply,
} from '../../../../packages/contracts/src/coordinator-channel.ts'
import type { CriticalFact, DurableReceipt, Json } from '../../../../packages/contracts/src/types.ts'
import { makeAttemptSpec, makeFact } from '../../../../packages/testing/src/index.ts'
import { CoordinatorChannelModule } from '../../src/attach-channel/coordinator-channel.ts'

const SPEC = makeAttemptSpec()

export const PRODUCER = {
  // Only the registered attempt tuple: the shared producer schema is strict about extra fields.
  attempt: {
    ticketId: SPEC.ticketId,
    assignmentId: SPEC.assignmentId,
    attemptId: SPEC.attemptId,
    fenceEpoch: SPEC.fenceEpoch,
    contract: { ...SPEC.contract },
  },
  runnerIdentityRef: 'runner-fixture',
  source: 'fixture-source',
}

export const LIMITS = {
  maxPendingFacts: 8,
  maxPendingPayloads: 4,
  maxPendingWrites: 4,
  maxPendingBytes: 65536,
  maxPayloadBytes: 8192,
  requestTimeoutMs: 1000,
  maxSettledRequests: 32,
}

/** Deterministic injected clock/timer: tests advance time explicitly, never sleep. */
export class ManualClock {
  #time = 0
  #seq = 0
  #timers: Array<{ id: number; at: number; callback: () => void }> = []

  readonly now = (): number => this.#time

  readonly schedule = (delayMs: number, callback: () => void): (() => void) => {
    const id = ++this.#seq
    this.#timers.push({ id, at: this.#time + delayMs, callback })
    return () => {
      this.#timers = this.#timers.filter(timer => timer.id !== id)
    }
  }

  get armed(): number {
    return this.#timers.length
  }

  advance(ms: number): void {
    this.#time += ms
    for (let guard = 0; guard < 10_000; guard++) {
      const due = this.#timers.filter(timer => timer.at <= this.#time).sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!due) return
      this.#timers = this.#timers.filter(timer => timer.id !== due.id)
      due.callback()
    }
    throw new Error('timer loop did not settle')
  }
}

export type Harness = ReturnType<typeof makeHarness>

export function makeHarness(overrides: Partial<typeof LIMITS> = {}) {
  const clock = new ManualClock()
  const limits = { ...LIMITS, ...overrides }
  const channel = new CoordinatorChannelModule({ producer: PRODUCER, limits, now: clock.now, schedule: clock.schedule })
  const sent: CoordinatorChannelRequest[] = []
  const client = (connectionId: string, expectedGeneration: number) => {
    const frames: CoordinatorChannelRequest[] = []
    const lease = channel.bind({
      producer: PRODUCER,
      connectionId,
      expectedGeneration,
      send: request => {
        sent.push(request)
        frames.push(request)
      },
    })
    return { lease, frames }
  }
  const first = client('conn-1', 0)
  return { clock, channel, limits, sent, lease: first.lease, frames: first.frames, client }
}

export function factOf(overrides: Partial<CriticalFact> = {}): CriticalFact {
  return { ...makeFact('question.opened'), source: PRODUCER.source, ...overrides }
}

export function receiptReply(factId: string, seq = 1): CoordinatorChannelReply {
  return { v: 1, type: 'receipt', id: factId, factId, receipt: { factId, persisted: true, seq } }
}

export function payloadReply(requestId: string, value: Json): CoordinatorChannelReply {
  return { v: 1, type: 'payload', id: requestId, requestId, value }
}

/** Idempotent durable-ACK double with A's replay/conflict contract. */
export class DurableSink {
  readonly receipts = new Map<string, DurableReceipt>()
  readonly bodies = new Map<string, string>()
  readonly calls: string[] = []
  #seq = 0

  record = async (fact: CriticalFact): Promise<DurableReceipt> => {
    this.calls.push(fact.factId)
    const body = JSON.stringify(fact)
    const existing = this.receipts.get(fact.factId)
    if (existing) {
      if (this.bodies.get(fact.factId) !== body) throw Object.assign(new Error('fact body conflicts with its receipt'), { reason: 'conflict' })
      return existing
    }
    const receipt: DurableReceipt = { factId: fact.factId, persisted: true, seq: ++this.#seq }
    this.receipts.set(fact.factId, receipt)
    this.bodies.set(fact.factId, body)
    return receipt
  }
}

/** Immutable content-addressed payload double: same reference always yields the same value. */
export class ImmutablePayloads {
  readonly store = new Map<string, Json>()
  readonly reads: string[] = []

  put(reference: string, value: Json): string {
    const existing = this.store.get(reference)
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error('payload reference conflict')
    this.store.set(reference, value)
    return reference
  }

  read = async (reference: string): Promise<Json> => {
    this.reads.push(reference)
    const value = this.store.get(reference)
    if (value === undefined) throw new Error(`missing payload ${reference}`)
    return value
  }
}

/** Fresh-guard double: every intent needs its own current decision; results are never reused. */
export class FreshGuard {
  readonly decisions: Array<{ commandId: string; allowed: boolean }> = []

  decide: (commandId: string) => boolean = () => true

  check = async (commandId: string): Promise<boolean> => {
    const allowed = this.decide(commandId)
    this.decisions.push({ commandId, allowed })
    return allowed
  }
}
