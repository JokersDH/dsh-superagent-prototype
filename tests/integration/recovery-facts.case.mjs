import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FactRecoveryError } from '../../apps/coordinator/recover-facts.ts'
import { binding, turnPayload, exitPayload } from './runtime-ingress-fixture.ts'
import { openRecoveryFixture, recoveryRecord as record } from './recovery-fixture.mjs'
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'g1-fact-recovery-'))
  let current = openRecoveryFixture(directory)
  t.after(() => { current.close(); rmSync(directory, { recursive: true, force: true }) })
  return {
    get store() { return current.store }, get core() { return current.core },
    run(records, integrity = 'verified_snapshot') { return current.run(records, integrity) },
    reopen() { current.close(); current = openRecoveryFixture(directory) },
  }
}
test('restores a lost payload from the journal before strict admission into production receipts/observations', async t => {
  const h = fixture(t), entry = record(turnPayload)
  await assert.rejects(h.store.payloads.read(entry.fact.payloadRef))
  const result = await h.run([entry])
  assert.equal(result.accepted, 1); assert.equal(result.failures.length, 0)
  assert.deepEqual((await h.store.payloads.read(entry.fact.payloadRef)).value, turnPayload)
  assert.equal(h.store.observations.forAttempt(binding.attemptId).length, 1)
  assert.ok(h.store.domain.tickets.get(binding.ticketId).assignments[0].idleAt)
  assert.equal(h.store.domain.tickets.get(binding.ticketId).ended, undefined)
})
test('reopen after an ACK gap returns the original receipt with no duplicate observation or core effect', async t => {
  const h = fixture(t), entry = record(turnPayload)
  await h.run([entry]); const receipt = h.store.facts.get(entry.fact.factId), cursor = h.store.events.cursor()
  h.reopen(); const result = await h.run([entry, entry])
  assert.equal(result.replayed, 1); assert.equal(result.exactLocalDuplicates, 1)
  assert.equal(h.store.facts.get(entry.fact.factId).seq, receipt.seq)
  assert.equal(h.store.observations.forAttempt(binding.attemptId).length, 1)
  assert.equal(h.store.events.cursor(), cursor)
})
test('preflight rejects same-ID conflicts before applying even the valid prefix', async t => {
  const h = fixture(t), first = record(turnPayload), conflict = record({ ...turnPayload, value: { ...turnPayload.value, nativeTurnRef: 'changed' } })
  await assert.rejects(h.run([first, conflict]), error => error instanceof FactRecoveryError && error.code === 'fact_conflict')
  assert.equal(h.store.facts.get(first.fact.factId), undefined)
  assert.equal(h.store.observations.forAttempt(binding.attemptId).length, 0)
})
test('gapped/corrupt snapshots cannot be promoted into verified replay', async t => {
  const h = fixture(t)
  for (const integrity of ['gapped', 'corrupt']) await assert.rejects(h.run([record(turnPayload)], integrity), FactRecoveryError)
  assert.equal(h.store.events.cursor(), 0)
})
test('original refs, strict payloads and authenticated producer must all match', async t => {
  const h = fixture(t), entry = record(turnPayload)
  for (const invalid of [
    { ...entry, fact: { ...entry.fact, payloadRef: 'opaque-ref' } },
    { ...entry, fact: { ...entry.fact, assignmentId: 'other-assignment' } },
    { ...entry, payload: { nativeTurnRef: 'no-envelope' } },
  ]) await assert.rejects(h.run([invalid]))
  assert.equal(h.store.observations.forAttempt(binding.attemptId).length, 0)
})
test('stopped old business facts are refused while known physical exits are restored and retained', async t => {
  const h = fixture(t)
  h.core.stopTicket(binding.ticketId); h.store.bindings.end(binding.attemptId)
  const result = await h.run([record(turnPayload), record(exitPayload, 'exit-1')])
  assert.equal(result.refused.length, 1); assert.equal(result.accepted, 1)
  const summary = h.store.observations.summarize(binding.attemptId)
  assert.equal(summary.resources[0].exit.observed, true)
  assert.equal(summary.resources[0].quiescence, 'unknown')
  assert.equal(h.store.domain.tickets.get(binding.ticketId).ended.outcome, 'stopped')
})
test('a real receipt failure rolls observations/core back and stops replay past the unknown gap', async t => {
  const h = fixture(t), first = record(turnPayload)
  h.store.db.exec("CREATE TRIGGER fail_replay_receipt BEFORE INSERT ON fact_receipts BEGIN SELECT RAISE(ABORT, 'replay receipt failure'); END")
  const result = await h.run([first, record(exitPayload, 'exit-1')])
  assert.equal(result.failures.length, 1); assert.equal(result.accepted, 0)
  assert.equal(h.store.observations.forAttempt(binding.attemptId).length, 0)
  assert.equal(h.store.domain.tickets.get(binding.ticketId).assignments[0].idleAt, undefined)
})
