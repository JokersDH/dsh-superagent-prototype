import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRuntimeIngress, IngressError, IngressRefused, jsonDigest } from '../../apps/coordinator/runtime-ingress.ts'
import { JsonSchema } from '../../packages/contracts/src/index.ts'
import { memoryIngressFixture, binding, producer, turnPayload, exitPayload } from './runtime-ingress-fixture.ts'

test('current full tuple records once, applies a scoped turn fact and does not finish core work', async () => {
  const h = memoryIngressFixture(), input = h.add(turnPayload)
  const first = await h.ingress.recordFenced(input, producer)
  assert.equal(first.accepted, true)
  assert.equal(h.applications.length, 1)
  assert.equal(h.repo.tickets.get(binding.ticketId)!.ended, undefined)
  assert.equal(h.core.completionCandidate(binding.ticketId), undefined)
  assert.ok(h.repo.tickets.get(binding.ticketId)!.assignments[0]!.idleAt)
  const repeated = await h.ingress.recordFenced(input, producer)
  assert.equal(repeated.accepted && repeated.replayed, true)
  assert.deepEqual(first.accepted && first.receipt, repeated.accepted && repeated.receipt)
  assert.equal(h.applications.length, 1)
})
test('an exact duplicate retains its receipt after stop/current epoch changes without reapplying', async () => {
  const h = memoryIngressFixture(), input = h.add(turnPayload)
  const first = await h.ingress.recordFenced(input, producer)
  h.bindings.get(binding.attemptId)!.state = 'ended'; h.setCurrent('new-attempt'); h.core.stopTicket(binding.ticketId)
  const replay = await h.ingress.recordFenced(input, producer)
  assert.equal(replay.accepted && replay.disposition, 'duplicate')
  assert.deepEqual(first.accepted && first.receipt, replay.accepted && replay.receipt)
  assert.equal(h.applications.length, 1)
})
test('same factId with different immutable payload conflicts rather than replacing the fact', async () => {
  const h = memoryIngressFixture(), input = h.add(turnPayload)
  await h.ingress.recordFenced(input, producer)
  const changed = h.add({ ...turnPayload, value: { ...turnPayload.value, nativeTurnRef: 'changed' } })
  await assert.rejects(h.ingress.recordFenced(changed, producer), (error: unknown) => error instanceof IngressError && error.code === 'fact_conflict')
  assert.equal(h.applications.length, 1)
})
test('immutable payload digest mismatch or kind mismatch receives no receipt', async () => {
  const h = memoryIngressFixture(), input = h.add(turnPayload)
  h.payloads.get(input.payloadRef)!.sha256 = 'b'.repeat(64)
  await assert.rejects(h.ingress.recordFenced(input, producer), IngressError)
  const wrong = h.add(exitPayload)
  await assert.rejects(h.ingress.recordFenced({ ...wrong, kind: 'turn.ended' }, producer))
  assert.equal(h.receipts.size, 0)
})
test('missing kind/value envelope and unknown fields never reach a reducer', async () => {
  const h = memoryIngressFixture(), input = h.add(turnPayload)
  for (const invalid of [{ nativeTurnRef: 'turn-1' }, { ...turnPayload, extra: 'field' }]) {
    h.payloads.set(input.payloadRef, { value: invalid, sha256: jsonDigest(JsonSchema.parse(invalid)) })
    await assert.rejects(h.ingress.recordFenced(input, producer))
  }
  assert.equal(h.applications.length, 0)
})
test('untrusted facts cannot change their authenticated producer/source or full attempt tuple', async () => {
  const h = memoryIngressFixture(), input = h.add(turnPayload)
  for (const changes of [{ ticketId: 'other' }, { assignmentId: 'other' }, { attemptId: 'other' }, { fenceEpoch: 2 }, { contract: { ...binding.contract, revision: 2 } }, { source: 'other' }]) assert.deepEqual(await h.ingress.recordFenced({ ...input, ...changes }, producer), { accepted: false, reason: 'producer_mismatch' })
  assert.equal(h.applications.length, 0)
})
test('known Runner identity is checked even when fact fields otherwise match', async () => {
  const h = memoryIngressFixture(), input = h.add(turnPayload)
  assert.deepEqual(await h.ingress.recordFenced(input, { ...producer, runnerIdentityRef: 'other-runner' }), { accepted: false, reason: 'producer_mismatch' })
})
test('a replaced current Runner identity cannot be bypassed through a retained old binding', async () => {
  const h = memoryIngressFixture(), input = h.add(turnPayload)
  h.store.current = () => ({ ...binding, runnerIdentityRef: 'new-runner' })
  assert.deepEqual(await h.ingress.recordFenced(input, producer), { accepted: false, reason: 'producer_mismatch' })
  assert.equal(h.receipts.size, 0)
})
test('binding/epoch/Assignment/contract freshness is decided after asynchronous payload resolution', async () => {
  const h = memoryIngressFixture(), input = h.add(turnPayload)
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const ingress = createRuntimeIngress(h.store, { read: async reference => { await waiting; return h.reader.read(reference) } })
  const pending = ingress.recordFenced(input, producer)
  h.setCurrent('new-attempt'); release()
  assert.deepEqual(await pending, { accepted: false, reason: 'attempt_mismatch' })
  assert.equal(h.receipts.size, 0)
})
test('a current runtime binding cannot mutate an ended/retried/stale-contract core Ticket', async () => {
  for (const mode of ['ended', 'retry', 'contract', 'revoked'] as const) {
    const h = memoryIngressFixture(), input = h.add(turnPayload)
    const ticket = h.repo.tickets.get(binding.ticketId)!
    if (mode === 'ended') h.core.stopTicket(ticket.id)
    else if (mode === 'retry') { ticket.assignments[0]!.id = 'new-assignment'; h.repo.tickets.save(ticket) }
    else if (mode === 'contract') { ticket.completion!.contract.revision = 2; h.repo.tickets.save(ticket) }
    else h.setAuthorized(false)
    const result = await h.ingress.recordFenced(input, producer)
    assert.equal(result.accepted, false)
    assert.equal(h.receipts.size, 0)
  }
})
test('physical facts remain auditable after stop or supersession but never imply core completion', async () => {
  const h = memoryIngressFixture(), input = h.add(exitPayload)
  h.core.stopTicket(binding.ticketId); h.bindings.get(binding.attemptId)!.state = 'ended'; h.setCurrent('new-attempt')
  const result = await h.ingress.recordFenced(input, producer)
  assert.equal(result.accepted && result.disposition, 'physical_only')
  assert.equal(h.repo.tickets.get(binding.ticketId)!.ended!.outcome, 'stopped')
  assert.equal(h.applications[0]!.disposition, 'physical_only')
})
test('physical resources cannot escape known ownership and unknown attempts get no durable ACK', async () => {
  const h = memoryIngressFixture(), input = h.add({ ...exitPayload, value: { ...exitPayload.value, resourceRef: 'someone-elses-resource' } })
  assert.deepEqual(await h.ingress.recordFenced(input, producer), { accepted: false, reason: 'unknown_resource' })
  h.bindings.clear()
  assert.deepEqual(await h.ingress.recordFenced(input, producer), { accepted: false, reason: 'unknown_binding' })
})
test('a reducer failure or failed commit rolls receipt, core mutation and applied records back together', async () => {
  for (const failure of ['apply', 'commit'] as const) {
    const h = memoryIngressFixture(), input = h.add(turnPayload)
    if (failure === 'commit') h.failCommit(true)
    else { const apply = h.store.applyBusiness; h.store.applyBusiness = (fact, payload) => { apply(fact, payload); throw new Error('reducer failed') } }
    await assert.rejects(h.ingress.recordFenced(input, producer))
    assert.equal(h.receipts.size, 0); assert.equal(h.applications.length, 0)
    assert.equal(h.repo.tickets.get(binding.ticketId)!.assignments[0]!.idleAt, undefined)
  }
})
test('ingress refuses an enclosing transaction and does not return a nested uncommitted ACK', async () => {
  const h = memoryIngressFixture(), input = h.add(turnPayload)
  h.setDepth(1)
  await assert.rejects(h.ingress.recordFenced(input, producer), IngressError)
  h.setDepth(0)
})
test('native async storage/reducers are rejected before any callback body runs', () => {
  const h = memoryIngressFixture()
  let ran = false
  assert.throws(() => createRuntimeIngress({ ...h.store, applyBusiness: async () => { ran = true } }, h.reader), IngressError)
  assert.equal(ran, false)
})
test('a receipt without atomic persistence/application is refused', async () => {
  const h = memoryIngressFixture(), input = h.add(turnPayload)
  h.store.facts.record = (factId, _digest, _apply) => ({ factId, persisted: true, seq: 1 })
  await assert.rejects(h.ingress.recordFenced(input, producer), (error: unknown) => error instanceof IngressError && error.code === 'invalid_receipt')
})
test('a bound Runner sink snapshots trusted identity and throws refusals without fake receipts', async () => {
  const h = memoryIngressFixture(), input = h.add(turnPayload), context = structuredClone(producer)
  const sink = h.ingress.bind(context); context.runnerIdentityRef = 'tampered'
  assert.ok(Object.isFrozen(sink)); assert.equal((await sink.record(input)).persisted, true)
  await assert.rejects(sink.record({ ...input, factId: 'fact-2', assignmentId: 'other' }), IngressRefused)
})
test('JSON hashing is deterministic across object-key ordering and distinguishes body values', () => {
  assert.equal(jsonDigest({ z: 1, a: [true, 'value'] }), jsonDigest({ a: [true, 'value'], z: 1 }))
  assert.notEqual(jsonDigest({ a: '43' }), jsonDigest({ a: 43 }))
})
