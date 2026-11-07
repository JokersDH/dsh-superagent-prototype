import { CriticalFactSchema, IdSchema, JsonSchema, AttemptRefSchema, parseRuntimeFactPayload } from '@personal-agent/contracts'
import type { Json } from '@personal-agent/contracts'
import type { ProductStore } from '@personal-agent/storage'
import { createRuntimeIngress, jsonDigest } from './runtime-ingress.ts'
import type { RuntimeProducer, RefusalReason } from './runtime-ingress.ts'

/** A decoder-owned snapshot, not a claim that all native history/environment was recovered. */
export interface RecoveryFactSource {
  integrity: 'verified_snapshot' | 'gapped' | 'corrupt'
  records: Iterable<{ fact: unknown; payload: unknown }>
}
export class FactRecoveryError extends Error {
  readonly code: 'integrity_incomplete' | 'invalid_record' | 'fact_conflict' | 'payload_reference_mismatch' | 'capacity_exhausted' | 'invalid_transaction'
  constructor(code: FactRecoveryError['code'], message: string) { super(message); this.code = code }
}
export type FactRecoveryResult = {
  scope: 'facts_only'
  accepted: number
  replayed: number
  exactLocalDuplicates: number
  refused: { factId: string; reason: RefusalReason }[]
  failures: { factId: string; reason: string }[]
}

/** Restore original content-addressed payload refs, then replay facts; never issue native commands. */
export async function recoverStoredFacts(source: RecoveryFactSource, context: RuntimeProducer, store: ProductStore, ingress: ReturnType<typeof createRuntimeIngress>): Promise<FactRecoveryResult> {
  if (source.integrity !== 'verified_snapshot') throw new FactRecoveryError('integrity_incomplete', 'Do not replay a gapped or corrupt journal as an intact snapshot')
  if (store.uow.nesting !== 0) throw new FactRecoveryError('invalid_transaction', 'Restore payload files outside the database transaction')
  const producer: RuntimeProducer = { attempt: AttemptRefSchema.parse(context.attempt), runnerIdentityRef: IdSchema.parse(context.runnerIdentityRef), source: IdSchema.parse(context.source) }
  const sameAttempt = (a: typeof producer.attempt) => a.ticketId === producer.attempt.ticketId && a.assignmentId === producer.attempt.assignmentId && a.attemptId === producer.attempt.attemptId
    && a.fenceEpoch === producer.attempt.fenceEpoch && a.contract.workId === producer.attempt.contract.workId && a.contract.revision === producer.attempt.contract.revision && a.contract.digest === producer.attempt.contract.digest
  const prepared: { fact: ReturnType<typeof CriticalFactSchema.parse>; payload: Json }[] = []
  const known = new Map<string, string>()
  let totalBytes = 0, seen = 0, exactLocalDuplicates = 0
  // Preflight the entire bounded snapshot before any database or file write.
  for (const entry of source.records) {
    if (++seen > 10000) throw new FactRecoveryError('capacity_exhausted', 'Recovery snapshot has too many records')
    const fact = CriticalFactSchema.parse(entry.fact)
    const payload = JsonSchema.parse(entry.payload)
    parseRuntimeFactPayload(fact, payload)
    if (!sameAttempt(fact) || fact.source !== producer.source) throw new FactRecoveryError('invalid_record', 'Journal fact does not belong to the trusted archived Runner')
    const digest = jsonDigest(payload)
    if (fact.payloadRef !== `payload:${digest}`) throw new FactRecoveryError('payload_reference_mismatch', 'Original payloadRef does not match production content-addressed storage')
    const body = JsonSchema.parse({ fact, payload })
    totalBytes += Buffer.byteLength(JSON.stringify(body))
    if (totalBytes > 8 * 1024 * 1024) throw new FactRecoveryError('capacity_exhausted', 'Recovery snapshot exceeds the bounded replay budget')
    const bodyDigest = jsonDigest(body), previous = known.get(fact.factId)
    if (previous !== undefined) {
      if (previous !== bodyDigest) throw new FactRecoveryError('fact_conflict', 'Journal reused one factId for different immutable content')
      exactLocalDuplicates++; continue
    }
    known.set(fact.factId, bodyDigest); prepared.push({ fact, payload })
  }
  const result: FactRecoveryResult = { scope: 'facts_only', accepted: 0, replayed: 0, exactLocalDuplicates, refused: [], failures: [] }
  for (const entry of prepared) {
    try {
      if (store.uow.nesting !== 0) throw new FactRecoveryError('invalid_transaction', 'Payload restoration must not join an unrelated transaction')
      const restored = store.payloads.write(entry.payload)
      if (restored.ref !== entry.fact.payloadRef) throw new FactRecoveryError('payload_reference_mismatch', 'Restoration changed the immutable payload identity')
      const receipt = await ingress.recordFenced(entry.fact, producer)
      if (!receipt.accepted) result.refused.push({ factId: entry.fact.factId, reason: receipt.reason })
      else if (receipt.replayed) result.replayed++
      else result.accepted++
    } catch (error) {
      result.failures.push({ factId: entry.fact.factId, reason: error instanceof Error ? error.message : String(error) })
      // Stop on an unexpected persistence/conflict failure instead of applying a later business fact past a gap.
      break
    }
  }
  return result
}
