import type { CriticalFact, RuntimeFactPayload } from '../../packages/contracts/src/index.ts'
import { JsonSchema } from '../../packages/contracts/src/index.ts'
import { MemoryRepositories, createPersonalEngine } from '../../packages/orchestrator-core/dist/index.js'
import type { Ticket } from '../../packages/orchestrator-core/src/index.ts'
import { createRuntimeIngress, jsonDigest } from '../../apps/coordinator/runtime-ingress.ts'
import type { RuntimeIngressStore, RuntimeProducer, IngressBinding, ImmutablePayloadReader } from '../../apps/coordinator/runtime-ingress.ts'

export const contract = { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) }
export const binding: IngressBinding = {
  ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract,
  runnerIdentityRef: 'runner-1', source: 'fixture-driver', state: 'active', resources: [{ ref: 'resource-1', ownership: 'spawned_process' }],
}
export const producer: RuntimeProducer = { attempt: { ticketId: binding.ticketId, assignmentId: binding.assignmentId, attemptId: binding.attemptId, fenceEpoch: binding.fenceEpoch, contract }, runnerIdentityRef: binding.runnerIdentityRef, source: binding.source }
export function initialTicket(): Ticket {
  return {
    id: binding.ticketId, title: 'Ingress test', decisionId: 'decision-1',
    mandate: { strength: 'explicit', policyVersion: 'v1', basis: { via: 'listed' }, actor: { source: 'local', id: 'user-1' }, scope: 'project' },
    channels: [], assignments: [{ id: binding.assignmentId, state: 'running', createdAt: '2026-11-07T00:00:00Z' }], inputs: [], undelivered: [],
    createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z', origin: { triggerId: 'request-1', triggerIds: ['request-1'] },
    completion: { mode: 'verified', contract, generation: 0, criteria: [{ id: 'test-1', kind: 'machine', description: 'Project check passes.', required: true, checkDefinitionRef: 'check-1' }] },
  }
}
export function fact(payload: RuntimeFactPayload, id = 'fact-1'): CriticalFact {
  return { ...producer.attempt, factId: id, source: producer.source, kind: payload.kind, payloadRef: `sha256:${jsonDigest(JsonSchema.parse(payload))}` }
}
export const turnPayload = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-1', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['evidence-1'] } } satisfies RuntimeFactPayload
export const exitPayload = { kind: 'runtime.exited', value: { resourceRef: 'resource-1', exitCode: 0, signal: null, evidenceRefs: ['evidence-1'] } } satisfies RuntimeFactPayload

export function memoryIngressFixture() {
  const repo = new MemoryRepositories()
  repo.tickets.save(initialTicket())
  const bindings = new Map([[binding.attemptId, structuredClone(binding)]])
  let currentAttempt = binding.attemptId
  let authorized = true
  let depth = 0
  let seq = 0
  let failCommit = false
  const receipts = new Map<string, { payloadDigest: string; seq: number }>()
  const applications: { factId: string; disposition: 'business' | 'physical_only'; payload: RuntimeFactPayload }[] = []
  const payloads = new Map<string, { value: unknown; sha256: string }>()
  const core = createPersonalEngine({
    repo, policy: () => ({ version: 'v1', paused: false, gate: () => ({ admissible: false, reason: 'fixture' }), revalidate: () => authorized, admitsInferred: () => false, evalTimeoutMs: 1000 }),
    scope: { scope: () => ({ listened: true, observed: false }) }, assessor: { request: () => {} },
    executor: { start: () => {}, deliver: () => {}, stop: () => {} }, outbox: { send: () => {}, withdraw: () => {}, status: () => undefined },
    completionPolicy: () => { throw new Error('Preseeded fixture only') }, isCurrentContract: () => authorized,
  })
  const store: RuntimeIngressStore = {
    nesting: () => depth,
    atomic: work => {
      const before = { receipts: structuredClone(receipts), applications: structuredClone(applications), seq }
      depth++
      try {
        return repo.atomic(() => { const result = work(); if (failCommit) throw new Error('injected commit failure'); return result })
      } catch (error) {
        receipts.clear(); for (const [key, value] of before.receipts) receipts.set(key, value)
        applications.splice(0, applications.length, ...before.applications); seq = before.seq
        throw error
      } finally { depth-- }
    },
    binding: id => structuredClone(bindings.get(id)),
    current: () => structuredClone(bindings.get(currentAttempt)),
    ticket: id => repo.tickets.get(id),
    authorized: () => authorized,
    facts: {
      get: id => receipts.get(id),
      record: (factId, payloadDigest, apply) => {
        const old = receipts.get(factId)
        if (old) { if (old.payloadDigest !== payloadDigest) throw new Error('conflict'); return { factId, persisted: true, seq: old.seq } }
        apply(); const value = { payloadDigest, seq: ++seq }; receipts.set(factId, value)
        return { factId, persisted: true, seq: value.seq }
      },
    },
    applyBusiness: (input, payload) => {
      applications.push({ factId: input.factId, disposition: 'business', payload })
      if (payload.kind === 'turn.ended') core.personalExecutor().turnEnded(input.ticketId, input.assignmentId)
    },
    applyPhysical: (input, payload) => { applications.push({ factId: input.factId, disposition: 'physical_only', payload }) },
  }
  const reader: ImmutablePayloadReader = { read: async reference => { const value = payloads.get(reference); if (!value) throw new Error('missing payload'); return structuredClone(value) } }
  const ingress = createRuntimeIngress(store, reader)
  return {
    repo, bindings, receipts, applications, payloads, core, store, reader, ingress,
    add(payload: RuntimeFactPayload, id = 'fact-1') {
      const input = fact(payload, id)
      payloads.set(input.payloadRef, { value: structuredClone(payload), sha256: jsonDigest(JsonSchema.parse(payload)) })
      return input
    },
    setCurrent: (id: string) => { currentAttempt = id }, setAuthorized: (value: boolean) => { authorized = value },
    setDepth: (value: number) => { depth = value }, failCommit: (value: boolean) => { failCommit = value },
  }
}
