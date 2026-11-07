import { ProductStore } from '../../packages/storage/dist/index.js'
import { createPersonalEngine } from '../../packages/orchestrator-core/dist/index.js'
import { join } from 'node:path'
import { bindCoreRepositories } from '../../apps/coordinator/main.ts'
import { createStoredRuntimeIngress } from '../../apps/coordinator/stored-ingress.ts'
import { recoverStoredFacts } from '../../apps/coordinator/recover-facts.ts'
import { jsonDigest } from '../../apps/coordinator/runtime-ingress.ts'
import { initialTicket, binding, producer } from './runtime-ingress-fixture.ts'

export function recoveryRecord(payload, id = 'fact-1') {
  return { fact: { ...producer.attempt, factId: id, source: producer.source, kind: payload.kind, payloadRef: `payload:${jsonDigest(payload)}` }, payload }
}
export function openRecoveryFixture(directory) {
  const store = new ProductStore({ path: join(directory, 'state.sqlite'), artifactsRoot: join(directory, 'artifacts') })
  const policy = () => ({ version: 'v1', paused: false, evalTimeoutMs: 1000, gate: () => ({ admissible: false, reason: 'fixture' }), revalidate: () => true, admitsInferred: () => false })
  const core = createPersonalEngine({ repo: bindCoreRepositories(store), policy, scope: { scope: () => ({ listened: true, observed: false }) }, assessor: { request: () => {} }, executor: { start: () => { throw new Error('Recovery must not start work') }, deliver: () => { throw new Error('Recovery must not deliver business') }, stop: () => {} }, outbox: { send: () => {}, withdraw: () => {}, status: () => undefined }, completionPolicy: () => { throw new Error('Preseeded fixture') }, isCurrentContract: ref => store.authority.isCurrent(ref) })
  const ingress = createStoredRuntimeIngress(store, core, policy)
  if (!store.domain.tickets.get(binding.ticketId)) {
    store.uow.atomic(() => {
      store.domain.tickets.save(initialTicket()); store.authority.enable(binding.contract)
      store.bindings.record(binding); store.bindings.setCurrent(binding.ticketId, binding.attemptId)
    })
  }
  return { store, core, ingress, close: () => store.close(), run: (records, integrity = 'verified_snapshot') => recoverStoredFacts({ integrity, records }, producer, store, ingress) }
}
