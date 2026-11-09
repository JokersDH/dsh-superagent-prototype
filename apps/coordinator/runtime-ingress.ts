import { createHash } from 'node:crypto'
import { AttemptRefSchema, CriticalFactSchema, DurableReceiptSchema, IdSchema, JsonSchema, parseRuntimeFactPayload } from '@personal-agent/contracts'
import type { AttemptRef, CriticalFact, DurableReceipt, Json, RuntimeFactPayload } from '@personal-agent/contracts'
import type { Ticket } from '@personal-agent/orchestrator-core'

import type { RuntimeProducer } from '../../packages/execution/src/contracts.ts'
export type { RuntimeProducer } from '../../packages/execution/src/contracts.ts'
/** Physical execution records, not a second Ticket lifecycle. Owned by the storage/runtime bridge. */
export type IngressBinding = AttemptRef & {
  runnerIdentityRef: string
  source: string
  state: 'active' | 'stopping' | 'ended'
  resources: readonly { ref: string; ownership: 'spawned_process' | 'shared_service_session' }[]
}
export type PhysicalPayload = Extract<RuntimeFactPayload, { kind: 'cancel.observed' | 'writer.observed' | 'runtime.exited' }>
export type BusinessPayload = Exclude<RuntimeFactPayload, PhysicalPayload>
export type RefusalReason = 'unknown_binding' | 'producer_mismatch' | 'attempt_mismatch' | 'stale_epoch' | 'stale_contract' | 'stale_assignment' | 'not_active' | 'unknown_resource'
export type IngressResult =
  | { accepted: true; receipt: DurableReceipt; replayed: boolean; disposition: 'business' | 'physical_only' | 'duplicate' }
  | { accepted: false; reason: RefusalReason }

export class IngressError extends Error {
  readonly code: 'invalid_payload' | 'fact_conflict' | 'invalid_transaction' | 'invalid_receipt'
  constructor(code: IngressError['code'], message: string) { super(message); this.code = code }
}
export class IngressRefused extends Error {
  readonly reason: RefusalReason
  constructor(reason: RefusalReason) { super(`Runtime fact refused: ${reason}`); this.reason = reason }
}

/** All methods below must read/write on one connection under atomic(). No external I/O in callbacks. */
export interface RuntimeIngressStore {
  nesting(): number
  atomic<T>(work: () => T): T
  binding(attemptId: string): IngressBinding | undefined
  current(ticketId: string): IngressBinding | undefined
  ticket(ticketId: string): Ticket | undefined
  authorized(ticket: Ticket): boolean
  facts: {
    get(factId: string): { payloadDigest: string; seq: number } | undefined
    record(factId: string, payloadDigest: string, apply: () => void): DurableReceipt
  }
  applyBusiness(fact: CriticalFact, payload: BusinessPayload): void
  applyPhysical(fact: CriticalFact, payload: PhysicalPayload): void
}
export interface ImmutablePayloadReader {
  /** Resolve a host-managed immutable reference; sha256 is canonical JSON's digest, not producer metadata. */
  read(reference: string): Promise<{ value: unknown; sha256: string }>
}

export function canonicalJson(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(',')}}`
}
export const jsonDigest = (value: Json): string => createHash('sha256').update(canonicalJson(value)).digest('hex')
const sameContract = (a: AttemptRef['contract'], b: AttemptRef['contract']) => a.workId === b.workId && a.revision === b.revision && a.digest === b.digest
const sameAttempt = (a: AttemptRef, b: AttemptRef) => a.ticketId === b.ticketId && a.assignmentId === b.assignmentId && a.attemptId === b.attemptId && a.fenceEpoch === b.fenceEpoch && sameContract(a.contract, b.contract)
const physical = (payload: RuntimeFactPayload): payload is PhysicalPayload => ['cancel.observed', 'writer.observed', 'runtime.exited'].includes(payload.kind)

function synchronous<T>(work: () => T): T {
  if (Object.prototype.toString.call(work) === '[object AsyncFunction]') throw new IngressError('invalid_transaction', 'Ingress callbacks must be synchronous')
  const result = work()
  if (result && (typeof result === 'object' || typeof result === 'function') && 'then' in result && typeof result.then === 'function') {
    void Promise.resolve(result).catch(() => undefined)
    throw new IngressError('invalid_transaction', 'Ingress callbacks cannot return a Promise/thenable')
  }
  return result
}

/** Use a trusted authenticated Runner context; the incoming fact cannot choose its own producer. */
export function createRuntimeIngress(store: RuntimeIngressStore, payloads: ImmutablePayloadReader) {
  for (const callback of [store.atomic, store.binding, store.current, store.ticket, store.authorized, store.facts.get, store.facts.record, store.applyBusiness, store.applyPhysical]) {
    if (Object.prototype.toString.call(callback) === '[object AsyncFunction]') throw new IngressError('invalid_transaction', 'Ingress storage and reducers must be synchronous')
  }

  async function recordFenced(input: unknown, context: RuntimeProducer): Promise<IngressResult> {
    if (store.nesting() !== 0) throw new IngressError('invalid_transaction', 'Ingress owns its outer commit; do not call from an open transaction')
    const fact = CriticalFactSchema.parse(input)
    const producer: RuntimeProducer = { attempt: AttemptRefSchema.parse(context.attempt), source: IdSchema.parse(context.source), runnerIdentityRef: IdSchema.parse(context.runnerIdentityRef) }
    if (!sameAttempt(fact, producer.attempt) || fact.source !== producer.source) return { accepted: false, reason: 'producer_mismatch' }

    // All asynchronous reads happen before the transaction. Parsing copies data before any await boundary.
    const resolved = await payloads.read(fact.payloadRef)
    const raw = JsonSchema.parse(resolved.value)
    const payloadDigest = jsonDigest(raw)
    if (!/^[a-f0-9]{64}$/.test(resolved.sha256) || resolved.sha256 !== payloadDigest) throw new IngressError('invalid_payload', 'Resolved payload digest does not match its immutable record')
    const payload = parseRuntimeFactPayload(fact, raw)
    const bodyDigest = jsonDigest(JsonSchema.parse({ fact, payloadDigest }))
    if (store.nesting() !== 0) throw new IngressError('invalid_transaction', 'Cannot acknowledge facts inside another open transaction')

    const result = synchronous(() => store.atomic((): IngressResult => {
      if (store.nesting() < 1) throw new IngressError('invalid_transaction', 'Storage atomic callback did not open a transaction')
      const known = synchronous(() => store.binding(fact.attemptId))
      if (!known) return { accepted: false, reason: 'unknown_binding' }
      if (!sameAttempt(known, fact)) return { accepted: false, reason: known.fenceEpoch !== fact.fenceEpoch ? 'stale_epoch' : 'attempt_mismatch' }
      if (known.runnerIdentityRef !== producer.runnerIdentityRef || known.source !== producer.source) return { accepted: false, reason: 'producer_mismatch' }

      const existing = synchronous(() => store.facts.get(fact.factId))
      if (existing) {
        if (existing.payloadDigest !== bodyDigest) throw new IngressError('fact_conflict', 'factId is immutable and already has a different identity or payload')
        const receipt = DurableReceiptSchema.parse({ factId: fact.factId, persisted: true, seq: existing.seq })
        return { accepted: true, replayed: true, disposition: 'duplicate', receipt }
      }

      let disposition: 'business' | 'physical_only'
      if (physical(payload)) {
        const resourceIds = payload.kind === 'runtime.exited' ? [payload.value.resourceRef] : payload.kind === 'writer.observed' ? payload.value.resources.map(item => item.resourceRef) : []
        if (resourceIds.some(id => !known.resources.some(resource => resource.ref === id))) return { accepted: false, reason: 'unknown_resource' }
        if (payload.kind === 'writer.observed' && payload.value.resources.some(item => !known.resources.some(resource => resource.ref === item.resourceRef && resource.ownership === item.ownership))) return { accepted: false, reason: 'unknown_resource' }
        disposition = 'physical_only'
      } else {
        const current = synchronous(() => store.current(fact.ticketId))
        if (!current || current.attemptId !== fact.attemptId) return { accepted: false, reason: 'attempt_mismatch' }
        if (current.fenceEpoch !== fact.fenceEpoch) return { accepted: false, reason: 'stale_epoch' }
        if (!sameAttempt(current, fact)) return { accepted: false, reason: 'attempt_mismatch' }
        if (current.runnerIdentityRef !== producer.runnerIdentityRef || current.source !== producer.source) return { accepted: false, reason: 'producer_mismatch' }
        if (known.state !== 'active' || current.state !== 'active') return { accepted: false, reason: 'not_active' }
        const ticket = synchronous(() => store.ticket(fact.ticketId))
        if (!ticket || ticket.ended || !ticket.completion || ticket.completion.retired || !sameContract(ticket.completion.contract, fact.contract)
          || synchronous(() => store.authorized(ticket)) !== true) return { accepted: false, reason: 'stale_contract' }
        const assignment = ticket.assignments.at(-1)
        if (!assignment || assignment.id !== fact.assignmentId || assignment.state === 'ended') return { accepted: false, reason: 'stale_assignment' }
        disposition = 'business'
      }

      let applications = 0
      const receipt = synchronous(() => store.facts.record(fact.factId, bodyDigest, () => {
        applications++
        if (physical(payload)) synchronous(() => store.applyPhysical(fact, payload))
        else synchronous(() => store.applyBusiness(fact, payload))
      }))
      const parsed = DurableReceiptSchema.parse(receipt)
      const persisted = synchronous(() => store.facts.get(fact.factId))
      if (applications !== 1 || parsed.factId !== fact.factId || persisted?.payloadDigest !== bodyDigest || persisted.seq !== parsed.seq) throw new IngressError('invalid_receipt', 'Storage did not atomically record the applied fact and matching receipt')
      return { accepted: true, replayed: false, disposition, receipt: parsed }
    }))
    if (store.nesting() !== 0) throw new IngressError('invalid_transaction', 'Storage returned before the outer commit')
    return result
  }

  return Object.freeze({
    recordFenced,
    bind(context: RuntimeProducer) {
      const producer = structuredClone(context)
      return Object.freeze({ async record(fact: CriticalFact): Promise<DurableReceipt> {
        const result = await recordFenced(fact, producer)
        if (!result.accepted) throw new IngressRefused(result.reason)
        return result.receipt
      } })
    },
  })
}
