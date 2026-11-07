/**
 * Batch 2: runtime observations — append-only evidence with independent cancel/exit/writer facts,
 * a read-only reducer for the composition root, and no manufactured physical success.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRuntimeFactPayload } from '@personal-agent/contracts'
import type { CriticalFact, Json } from '@personal-agent/contracts'
import { canonicalDigest, ObservationConflict, type ObservationInput, type ProductStore } from '../src/index.ts'
import { withStore } from './helpers.ts'

const contract = { workId: 'work-1', revision: 1, digest: '0123456789abcdef'.repeat(4) }
const attemptRef = (attemptId = 'attempt-1', overrides: Record<string, unknown> = {}) => ({
  ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId, fenceEpoch: 1, contract, ...overrides,
})
const binding = (attemptId = 'attempt-1', overrides: Record<string, unknown> = {}) => ({
  ...attemptRef(attemptId, overrides), runnerIdentityRef: 'runner-1', source: 'codex', state: 'active' as const,
  resources: [
    { ref: 'resource-1', ownership: 'spawned_process' as const },
    { ref: 'resource-2', ownership: 'shared_service_session' as const },
  ],
  ...overrides,
})
const factOf = (attemptId: string, kind: CriticalFact['kind'], factId: string): CriticalFact => ({
  ...attemptRef(attemptId), factId, source: 'codex', kind, payloadRef: `payload:${factId}`,
} as CriticalFact)
const rawTurn = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-1', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['ev-1'] } }
const rawCancel = (acknowledged: boolean) => ({ kind: 'cancel.observed', value: { dispatch: { commandId: 'cmd-1', delivery: 'written', retry: 'reconcile_first', evidenceRefs: [] }, acknowledged, evidenceRefs: [] } })
const rawExit = (resourceRef = 'resource-1', exitCode: number | null = 0) => ({ kind: 'runtime.exited', value: { resourceRef, exitCode, signal: null, evidenceRefs: [] } })
const rawWriter = (status: 'active' | 'quiescent' | 'indeterminate', resourceRef = 'resource-1', ownership: 'spawned_process' | 'shared_service_session' = 'spawned_process') => ({
  kind: 'writer.observed', value: { resources: [{ resourceRef, ownership, status, evidenceRefs: [] }] },
})
const observation = (attemptId: string, raw: { kind: string; value: unknown }, factId = `fact-${raw.kind}`, disposition: ObservationInput['disposition'] = 'physical_only'): ObservationInput => {
  const fact = factOf(attemptId, raw.kind as CriticalFact['kind'], factId)
  return {
    fact,
    payload: parseRuntimeFactPayload(fact, raw),
    disposition,
    payloadSha256: canonicalDigest(raw as Json),
  }
}
const seed = (store: ProductStore): void => {
  store.uow.atomic(() => {
    store.bindings.record(binding('attempt-1'))
    store.bindings.setCurrent('ticket-1', 'attempt-1')
    store.authority.enable(contract)
  })
}

test('a business fact leaves one attempt observation and no resource rows', async () => {
  await withStore(({ store }) => {
    seed(store)
    const input = observation('attempt-1', rawTurn, 'fact-turn-1', 'business')
    store.uow.atomic(() => { store.facts.record(input.fact.factId, input.payloadSha256, () => store.observations.record(input)) })
    const row = store.observations.get('fact-turn-1')!
    assert.equal(row.kind, 'turn.ended')
    assert.equal(row.disposition, 'business')
    assert.deepEqual(row.detail, { outcome: 'completed', candidateAvailable: true })
    assert.equal(row.payloadRef, 'payload:fact-turn-1')
    assert.equal(row.payloadSha256, input.payloadSha256)
    const summary = store.observations.summarize('attempt-1')
    assert.equal(summary.observations, 1)
    assert.deepEqual(summary.resources, [])
    assert.equal(summary.cancel.observed, false)

    // An exact repeat is an idempotent no-op; a changed body under the same fact ID conflicts.
    store.uow.atomic(() => store.observations.record(input))
    assert.equal(store.observations.forAttempt('attempt-1').length, 1)
    const altered = { ...input, payloadSha256: canonicalDigest({ ...rawTurn, value: { ...rawTurn.value, nativeTurnRef: 'turn-2' } } as Json) }
    assert.throws(() => store.uow.atomic(() => store.observations.record(altered)), ObservationConflict)
  })
})

test('cancel acknowledgement, process exit and writer quiescence stay independent facts', async () => {
  await withStore(({ store }) => {
    seed(store)
    // Cancel ACK is a dispatch fact: it says nothing about resources.
    store.uow.atomic(() => store.observations.record(observation('attempt-1', rawCancel(true), 'fact-cancel')))
    let summary = store.observations.summarize('attempt-1')
    assert.deepEqual(summary.cancel, { observed: true, acknowledged: true })
    assert.deepEqual(summary.resources, [], 'a cancel does not produce resource observations')

    // An exit is evidence for one resource only, and never quiescence by itself.
    store.uow.atomic(() => store.observations.record(observation('attempt-1', rawExit('resource-1', 0), 'fact-exit')))
    summary = store.observations.summarize('attempt-1')
    const one = summary.resources.find(resource => resource.resourceRef === 'resource-1')!
    assert.deepEqual(one.exit, { observed: true, exitCode: 0, signal: null, factId: 'fact-exit' })
    assert.deepEqual(one.writer, { observed: false })
    assert.equal(one.quiescence, 'unknown', 'an exit alone is not quiescence')
    assert.equal(summary.resources.find(resource => resource.resourceRef === 'resource-2'), undefined)

    // Writer observations are the only explicit quiescence signal; a later non-quiescent status wins.
    store.uow.atomic(() => store.observations.record(observation('attempt-1', rawWriter('active'), 'fact-writer-active')))
    assert.equal(store.observations.summarize('attempt-1').resources[0]!.quiescence, 'unknown')
    store.uow.atomic(() => store.observations.record(observation('attempt-1', rawWriter('quiescent'), 'fact-writer-quiescent')))
    assert.equal(store.observations.summarize('attempt-1').resources[0]!.quiescence, 'observed_quiescent')
    store.uow.atomic(() => store.observations.record(observation('attempt-1', rawWriter('indeterminate'), 'fact-writer-indeterminate')))
    const after = store.observations.summarize('attempt-1')
    assert.equal(after.resources[0]!.quiescence, 'unknown', 'quiescence is not sticky once a newer writer observation disagrees')
    assert.equal(after.resources[0]!.writer.status, 'indeterminate')
    assert.equal(after.cancel.acknowledged, true, 'the cancel fact is still independently visible')
  })
})

test('an old attempt physical observation is stored without touching the new attempt, pointer or authority', async () => {
  await withStore(({ store }) => {
    seed(store)
    store.uow.atomic(() => store.observations.record(observation('attempt-1', rawExit('resource-1', 0), 'fact-old-exit')))
    // The old attempt ends and a new attempt with different resources becomes current.
    store.uow.atomic(() => {
      store.bindings.end('attempt-1')
      store.bindings.record(binding('attempt-2', { fenceEpoch: 2, resources: [{ ref: 'resource-3', ownership: 'spawned_process' as const }] }))
      store.bindings.setCurrent('ticket-1', 'attempt-2')
    })
    const before = JSON.stringify(store.bindings.current('ticket-1'))

    // A late physical observation for the ended attempt remains valid evidence.
    store.uow.atomic(() => store.observations.record(observation('attempt-1', rawWriter('quiescent'), 'fact-old-writer')))
    assert.equal(store.observations.forAttempt('attempt-1').length, 2)
    assert.equal(JSON.stringify(store.bindings.current('ticket-1')), before, 'the current binding is unchanged')
    assert.deepEqual(store.bindings.current('ticket-1')?.resources, [{ ref: 'resource-3', ownership: 'spawned_process' }])
    assert.equal(store.authority.isCurrent(contract), true, 'authorization unchanged')
    const newSummary = store.observations.summarize('attempt-2')
    assert.deepEqual(newSummary.resources, [], 'old-attempt facts do not appear in the new attempt summary')
    assert.equal(store.observations.summarize('attempt-1').resources[0]!.quiescence, 'observed_quiescent')
  })
})

test('physical observations refuse an unknown attempt or an unregistered or differently-owned resource', async () => {
  await withStore(({ store }) => {
    seed(store)
    assert.throws(() => store.uow.atomic(() => store.observations.record(observation('attempt-unknown', rawExit('resource-1'), 'fact-unknown'))), (error: unknown) =>
      error instanceof ObservationConflict && /unknown attempt/.test((error as Error).message))
    assert.throws(() => store.uow.atomic(() => store.observations.record(observation('attempt-1', rawExit('resource-9'), 'fact-unregistered'))), (error: unknown) =>
      error instanceof ObservationConflict && /did not register resource resource-9/.test((error as Error).message))
    assert.throws(() => store.uow.atomic(() => store.observations.record(observation('attempt-1', rawWriter('active', 'resource-1', 'shared_service_session'), 'fact-ownership'))), (error: unknown) =>
      error instanceof ObservationConflict && /ownership shared_service_session/.test((error as Error).message))
    assert.equal(store.observations.forAttempt('attempt-1').length, 0)
  })
})

test('observations must be recorded inside the ingress transaction and roll back with it', async () => {
  await withStore(({ store }) => {
    seed(store)
    const input = observation('attempt-1', rawTurn, 'fact-turn-2', 'business')
    assert.throws(() => store.observations.record(input), /inside the ingress transaction/)

    const eventsBefore = store.events.cursor()
    assert.throws(() => store.uow.atomic(() => {
      store.bindings.record(binding('attempt-2', { fenceEpoch: 2 }))
      store.bindings.setCurrent('ticket-1', 'attempt-2')
      store.authority.disable(contract)
      store.facts.record(input.fact.factId, input.payloadSha256, () => store.observations.record(input))
      store.events.append({ topic: 'runtime.observed', entityRef: input.fact.factId, payload: {} })
      store.queue.enqueue('runtime.reconcile', 'attempt-2', JSON.stringify({}), 1, 0, 'now')
      throw new Error('late failure')
    }), /late failure/)
    assert.equal(store.bindings.current('ticket-1')?.attemptId, 'attempt-1', 'pointer rolled back')
    assert.equal(store.authority.isCurrent(contract), true, 'authority rolled back')
    assert.equal(store.facts.get(input.fact.factId), undefined, 'receipt rolled back')
    assert.equal(store.observations.forAttempt('attempt-1').length, 0, 'observation rolled back')
    assert.equal(store.facts.get(input.fact.factId), undefined)
    assert.equal(store.events.cursor(), eventsBefore, 'event rolled back')
    assert.equal(store.queue.stats('runtime.reconcile').waiting, 0, 'queued effect rolled back')
  })
})

test('composition fixture: the public ports accept one fact transaction and reduce its evidence', async () => {
  await withStore(({ store }) => {
    seed(store)
    // The shape the coordinator's stored ingress uses: parse strict payload, resolve the digest,
    // dedupe through FactReceipts, record the observation, append the event — one transaction.
    const accept = (attemptId: string, raw: { kind: string; value: unknown }, factId: string, disposition: 'business' | 'physical_only') => {
      const fact = factOf(attemptId, raw.kind as CriticalFact['kind'], factId)
      const payload = parseRuntimeFactPayload(fact, raw)
      const payloadSha256 = canonicalDigest(raw as Json)
      const bodyDigest = canonicalDigest({ fact, payloadDigest: payloadSha256 } as Json)
      return store.uow.atomic(() => {
        const existing = store.facts.get(fact.factId)
        if (existing) return { replayed: true, seq: existing.seq }
        const receipt = store.facts.record(fact.factId, bodyDigest, () => {
          store.observations.record({ fact, payload, disposition, payloadSha256 })
          store.events.append({ topic: 'runtime.observed', entityRef: fact.factId, payload: { kind: payload.kind, disposition } })
        })
        return { replayed: false, seq: receipt.seq }
      })
    }
    const first = accept('attempt-1', rawExit('resource-1', 3), 'fact-exit-3', 'physical_only')
    assert.equal(first.replayed, false)
    const replay = accept('attempt-1', rawExit('resource-1', 3), 'fact-exit-3', 'physical_only')
    assert.deepEqual(replay, { replayed: true, seq: first.seq })
    const observedEvent = store.events.after(0, 10).find(event => event.topic === 'runtime.observed')
    assert.equal(observedEvent?.entityRef, 'fact-exit-3', 'the observation event is committed in the same transaction')
    const summary = store.observations.summarize('attempt-1')
    assert.equal(summary.observations, 1)
    assert.deepEqual(summary.resources[0]!.exit, { observed: true, exitCode: 3, signal: null, factId: 'fact-exit-3' })
    assert.equal(summary.resources[0]!.quiescence, 'unknown')
  })
})
