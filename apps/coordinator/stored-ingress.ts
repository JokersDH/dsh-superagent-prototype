import { JsonSchema } from '@personal-agent/contracts'
import type { AttemptIO, Json, RuntimeFactPayload } from '@personal-agent/contracts'
import type { Engine, Policy } from '@personal-agent/orchestrator-core'
import type { ProductStore } from '@personal-agent/storage'
import { createRuntimeIngress } from './runtime-ingress.ts'
import type { IngressBinding, RuntimeIngressStore } from './runtime-ingress.ts'

/** Compose production storage ports without private SQL or a second domain lifecycle. */
export function createStoredRuntimeIngress(store: ProductStore, core: Pick<Engine, 'personalExecutor' | 'invalidateCandidate'>, policy: () => Pick<Policy, 'revalidate'>) {
  if (typeof policy !== 'function') throw new TypeError('Stored runtime ingress requires the current trusted policy')
  const facts = core.personalExecutor()
  const observe: (input: Parameters<RuntimeIngressStore['applyBusiness']>[0], payload: RuntimeFactPayload, disposition: 'business' | 'physical_only') => void = (input, payload, disposition) => {
    store.events.append({
      topic: 'runtime.observed', entityRef: input.attemptId,
      payload: { factId: input.factId, ticketId: input.ticketId, assignmentId: input.assignmentId, attemptId: input.attemptId, fenceEpoch: input.fenceEpoch, contract: input.contract, kind: payload.kind, payloadRef: input.payloadRef, disposition },
    })
  }
  const ports: RuntimeIngressStore = {
    nesting: () => store.uow.nesting,
    atomic: work => store.uow.atomic(work),
    binding: id => store.bindings.binding<IngressBinding>(id),
    current: id => store.bindings.current<IngressBinding>(id),
    ticket: id => store.domain.tickets.get(id),
    authorized: ticket => !!ticket.completion && store.authority.isCurrent(ticket.completion.contract) && policy().revalidate(ticket.mandate) === true,
    facts: { get: id => store.facts.get(id), record: (id, digest, apply) => store.facts.record(id, digest, apply) },
    applyBusiness: (input, payload) => {
      if (payload.kind === 'turn.ended') facts.turnEnded(input.ticketId, input.assignmentId)
      if (payload.kind === 'config.changed') {
        core.invalidateCandidate({ ticketId: input.ticketId, assignmentId: input.assignmentId, contract: input.contract })
        const binding = store.bindings.binding<IngressBinding>(input.attemptId)!
        store.bindings.record({ ...binding, state: 'stopping' })
        store.queue.enqueue('runtime.reconcile', input.attemptId, input.payloadRef, store.queue.maxSeq() + 1, 0, new Date().toISOString())
      }
      // Candidate, questions and approvals remain observations until their trusted owners apply them.
      observe(input, payload, 'business')
    },
    applyPhysical: (input, payload) => {
      // Exit/cancel are not group-quiescence proofs. Never revive or end an attempt here.
      observe(input, payload, 'physical_only')
    },
  }
  return createRuntimeIngress(ports, store.payloads)
}

/** Runner-local references reuse the host's immutable payloads; no transaction may contain file I/O. */
export function storedAttemptPayloads(store: ProductStore): AttemptIO['payloads'] {
  return {
    read: async ref => {
      if (store.uow.nesting) throw new Error('Read immutable payloads outside the database transaction')
      return JsonSchema.parse((await store.payloads.read(ref)).value)
    },
    store: async (input: Json, _classification) => {
      if (store.uow.nesting) throw new Error('Write immutable payload files before the database transaction')
      return store.payloads.write(JsonSchema.parse(input)).ref
    },
  }
}
