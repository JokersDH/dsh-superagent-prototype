import { JsonSchema, RuntimeFactPayloadSchema } from '@personal-agent/contracts'
import type { CriticalFact, Json } from '@personal-agent/contracts'
import { key } from '@personal-agent/orchestrator-core'
import type { ProductStore } from '@personal-agent/storage'
import { jsonDigest } from './runtime-ingress.ts'
import type { IngressBinding } from './runtime-ingress.ts'
import { verifiedRunnerInspection } from './runner-link.ts'
import type { RunnerInspection, VerifiedRunnerInspection } from './runner-link.ts'

export class ResourceBarrierError extends Error {
  readonly code: 'not_quiescent' | 'resource_manifest_changed' | 'identity_mismatch' | 'invalid_transaction'
  constructor(code: ResourceBarrierError['code'], message: string) { super(message); this.code = code }
}
export function ownedResourceManifestDigest(resources: readonly { ref: string; ownership: string }[]): string {
  return jsonDigest(resources.map(resource => ({ ref: resource.ref, ownership: resource.ownership })).sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
}
function currentBinding(store: ProductStore, value: RunnerInspection): IngressBinding {
  const binding = store.bindings.binding<IngressBinding>(value.attempt.attemptId)
  const attempt = value.attempt
  if (!binding || binding.ticketId !== attempt.ticketId || binding.assignmentId !== attempt.assignmentId || binding.fenceEpoch !== attempt.fenceEpoch
    || binding.contract.workId !== attempt.contract.workId || binding.contract.revision !== attempt.contract.revision || binding.contract.digest !== attempt.contract.digest
    || binding.runnerIdentityRef !== value.runnerIdentityRef || binding.source !== value.source) throw new ResourceBarrierError('identity_mismatch', 'Inspection does not match the registered execution identity')
  if (ownedResourceManifestDigest(binding.resources) !== ownedResourceManifestDigest(value.resources)) throw new ResourceBarrierError('resource_manifest_changed', 'Inspect again after resource registration changes')
  return binding
}
export type OwnedQuiescenceReceipt = {
  scope: 'registered_owned_resources_only'
  attemptId: string
  proofRef: string
  resourceManifestDigest: string
  confirmedEventSeq: number
  writerFactId?: string
}

/** Consume only an authenticated fresh peer proof; ordinary Driver observations cannot call this gate. */
export function confirmOwnedQuiescence(store: ProductStore, proof: VerifiedRunnerInspection, maxAgeMs = 5000) {
  if (store.uow.nesting) throw new ResourceBarrierError('invalid_transaction', 'Resource barrier owns the outer commit')
  const { value, endpoint } = verifiedRunnerInspection(proof, maxAgeMs)
  if (value.state !== 'terminated' || value.admission !== 'closed' || value.coverage !== 'complete_owned_resources'
    || value.resources.some(resource => resource.writer !== 'quiescent' || resource.evidence.length === 0)) throw new ResourceBarrierError('not_quiescent', 'Runner must close business admission and prove every owned resource quiescent')
  currentBinding(store, value)
  const resourceManifestDigest = ownedResourceManifestDigest(value.resources)
  const commandId = key('confirm-owned-quiescence/v2', value.attempt.attemptId, resourceManifestDigest)
  const bodyDigest = jsonDigest(JsonSchema.parse({ attempt: value.attempt, runnerIdentityRef: value.runnerIdentityRef, source: value.source, resourceManifestDigest, scope: 'registered_owned_resources_only' }))
  // Fresh inspections of an irreversible closed inventory reuse its first receipt and proof.
  const existing = store.commands.get(commandId)
  const evidence: Json = JsonSchema.parse({ protocol: 'runner-owned-quiescence/1', inspection: value, socketIdentity: endpoint.socketIdentity })
  const proofRef = existing ? undefined : store.payloads.write(evidence).ref
  const writerPayload = proofRef && value.resources.length ? RuntimeFactPayloadSchema.parse({ kind: 'writer.observed', value: { resources: value.resources.map(resource => ({ resourceRef: resource.ref, ownership: resource.ownership, status: 'quiescent', evidenceRefs: [proofRef] })) } }) : undefined
  const writerRef = writerPayload ? store.payloads.write(JsonSchema.parse(writerPayload)).ref : undefined
  return store.uow.atomic(() => {
    verifiedRunnerInspection(proof, maxAgeMs)
    const binding = currentBinding(store, value)
    return store.commands.record<OwnedQuiescenceReceipt>(commandId, bodyDigest, () => {
      if (!proofRef) throw new Error('Stored barrier receipt disappeared during confirmation')
      let writerFactId: string | undefined
      if (writerPayload && writerRef) {
        writerFactId = key('host-writer-proof', binding.attemptId, proofRef)
        const fact: CriticalFact = { ticketId: binding.ticketId, assignmentId: binding.assignmentId, attemptId: binding.attemptId, fenceEpoch: binding.fenceEpoch,
          contract: binding.contract, source: binding.source, factId: writerFactId, kind: 'writer.observed', payloadRef: writerRef }
        const payloadSha256 = jsonDigest(JsonSchema.parse(writerPayload))
        store.facts.record(writerFactId, jsonDigest(JsonSchema.parse({ fact, payloadDigest: payloadSha256 })), () => {
          store.observations.record({ fact, payload: writerPayload, payloadSha256, disposition: 'physical_only' })
        })
      }
      store.bindings.end(binding.attemptId)
      const confirmedEventSeq = store.events.append({ topic: 'runtime.barrier.confirmed', entityRef: binding.attemptId,
        payload: { barrierCommandId: commandId, attempt: value.attempt, source: value.source, writerFactId: writerFactId ?? null, proofRef, resourceManifestDigest, runnerIdentityRef: binding.runnerIdentityRef, contract: binding.contract, scope: 'registered_owned_resources_only' } })
      return { scope: 'registered_owned_resources_only', attemptId: binding.attemptId, proofRef, resourceManifestDigest, confirmedEventSeq, ...(writerFactId ? { writerFactId } : {}) }
    })
  })
}
