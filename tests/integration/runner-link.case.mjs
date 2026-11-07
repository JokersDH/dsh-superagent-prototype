import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, chmodSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRunnerCredential, serveRunnerRecovery, connectRunnerRecovery, verifiedRunnerInspection, RunnerLinkError } from '../../apps/coordinator/runner-link.ts'
import { confirmOwnedQuiescence, ResourceBarrierError } from '../../apps/coordinator/resource-barrier.ts'
import { openRecoveryFixture } from './recovery-fixture.mjs'
import { binding, producer } from './runtime-ingress-fixture.ts'

const live = () => ({ state: 'serving', admission: 'open', coverage: 'complete_owned_resources', resources: binding.resources.map(resource => ({ ...resource, writer: 'active', evidence: ['owned-process-running'] })), evidence: ['owned-resource-scan'] })
const stopped = () => ({ state: 'terminated', admission: 'closed', coverage: 'complete_owned_resources', resources: binding.resources.map(resource => ({ ...resource, writer: 'quiescent', evidence: ['group-quiescent'] })), evidence: ['admission-closed', 'owned-resource-scan'] })
const cancel = (id = 'cancel-1') => ({ ...producer.attempt, id, kind: 'cancel' })
async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'pa-link-'))
  const credentialPath = join(directory, 'runner.key'), socketPath = join(directory, 'runner.sock')
  createRunnerCredential(credentialPath)
  let state = live(), calls = 0
  const backend = { inspect: async () => options.state?.() ?? state, cancel: async () => { calls++; if (options.failCancel) throw new Error('opaque backend failure'); state = stopped(); return state } }
  const service = await serveRunnerRecovery({ socketPath, credentialPath }, producer, backend)
  const h = openRecoveryFixture(directory, options.binding ?? binding)
  t.after(async () => { await service.close(); h.close(); rmSync(directory, { recursive: true, force: true }) })
  return { directory, service, ...h, credentialPath, socketPath, connect: () => connectRunnerRecovery(service.endpoint, producer), calls: () => calls, setState: next => { state = next } }
}
test('a fresh authenticated connection can inspect a still-running registered Runner without starting work', async t => {
  const h = await fixture(t), first = await h.connect().inspect(), second = await h.connect().inspect()
  assert.equal(first.inspection.state, 'serving'); assert.equal(second.inspection.runnerIdentityRef, producer.runnerIdentityRef)
  assert.equal(h.calls(), 0)
  assert.equal(verifiedRunnerInspection(second).value.attempt.attemptId, binding.attemptId)
})
test('cancel is once-only across new client connections and concurrent retries', async t => {
  const h = await fixture(t)
  const [a, b] = await Promise.all([h.connect().cancel(cancel()), h.connect().cancel(cancel())])
  assert.equal(a.inspection.state, 'terminated'); assert.equal(b.inspection.admission, 'closed'); assert.equal(h.calls(), 1)
})
test('a wrong credential, stale attempt and changed socket identity cannot reach cancellation', async t => {
  const h = await fixture(t), wrongKey = join(h.directory, 'wrong.key'); createRunnerCredential(wrongKey)
  await assert.rejects(connectRunnerRecovery({ ...h.service.endpoint, credentialPath: wrongKey }, producer).inspect(), error => error instanceof RunnerLinkError && error.code === 'auth_failed')
  await assert.rejects(connectRunnerRecovery(h.service.endpoint, { ...producer, attempt: { ...producer.attempt, fenceEpoch: 2 } }).inspect(), RunnerLinkError)
  await assert.rejects(connectRunnerRecovery({ ...h.service.endpoint, socketIdentity: { ...h.service.endpoint.socketIdentity, ino: 0 } }, producer).inspect(), RunnerLinkError)
  await assert.rejects(h.connect().cancel({ ...cancel(), assignmentId: 'other' }), RunnerLinkError)
  assert.equal(h.calls(), 0)
})
test('the recovery endpoint rejects begin/deliver and conflicting same-ID controls', async t => {
  const h = await fixture(t)
  await assert.rejects(h.connect().cancel({ ...cancel(), kind: 'begin', inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }), RunnerLinkError)
  await h.connect().cancel(cancel())
  await assert.rejects(h.connect().cancel({ ...cancel(), contract: { ...binding.contract, revision: 2 } }), RunnerLinkError)
  assert.equal(h.calls(), 1)
})
test('an unknown cancel outcome is cached and never blindly re-executed on retry', async t => {
  const h = await fixture(t, { failCancel: true })
  await assert.rejects(h.connect().cancel(cancel()), RunnerLinkError)
  await assert.rejects(h.connect().cancel(cancel()), RunnerLinkError)
  assert.equal(h.calls(), 1)
})
test('credentials require a private regular owned file and cannot be overwritten', async t => {
  const h = await fixture(t)
  assert.throws(() => createRunnerCredential(h.credentialPath))
  chmodSync(h.credentialPath, 0o644); assert.throws(() => h.connect(), RunnerLinkError)
  chmodSync(h.credentialPath, 0o600)
  const link = join(h.directory, 'linked.key'); symlinkSync(h.credentialPath, link)
  assert.throws(() => connectRunnerRecovery({ ...h.service.endpoint, credentialPath: link }, producer), RunnerLinkError)
})
test('existing socket paths are not unlinked or replaced', async t => {
  const h = await fixture(t)
  const path = join(h.directory, 'someone-elses-file'); writeFileSync(path, 'preserve')
  await assert.rejects(serveRunnerRecovery({ socketPath: path, credentialPath: h.credentialPath }, producer, { inspect: async () => live(), cancel: async () => stopped() }))
  assert.equal(readFileSync(path, 'utf8'), 'preserve')
})
test('only fresh peer proofs with closed admission, complete ownership and quiescence can confirm a barrier', async t => {
  const h = await fixture(t)
  await assert.rejects(async () => confirmOwnedQuiescence(h.store, await h.connect().inspect()), ResourceBarrierError)
  const proof = await h.connect().cancel(cancel())
  assert.throws(() => confirmOwnedQuiescence(h.store, JSON.parse(JSON.stringify(proof))), RunnerLinkError)
  assert.throws(() => confirmOwnedQuiescence(h.store, proof, 0), RunnerLinkError)
  const result = confirmOwnedQuiescence(h.store, proof)
  assert.equal(result.result.scope, 'registered_owned_resources_only')
  assert.equal(h.store.bindings.binding(binding.attemptId).state, 'ended')
  assert.equal(h.store.observations.summarize(binding.attemptId).resources[0].quiescence, 'observed_quiescent')
  const again = confirmOwnedQuiescence(h.store, proof)
  assert.equal(again.replayed, true); assert.equal(again.seq, result.seq)
  assert.equal(h.store.domain.tickets.get(binding.ticketId).ended, undefined)
})
test('partial/unknown coverage, open admission, missing resources or absent evidence never release a binding', async t => {
  const h = await fixture(t)
  for (const change of [{ coverage: 'partial' }, { admission: 'open' }, { state: 'unknown' }, { resources: [] }, { resources: stopped().resources.map(resource => ({ ...resource, evidence: [] })) }]) {
    h.setState({ ...stopped(), ...change })
    const proof = await h.connect().inspect()
    assert.throws(() => confirmOwnedQuiescence(h.store, proof), ResourceBarrierError)
    assert.equal(h.store.bindings.binding(binding.attemptId).state, 'active')
  }
})
test('a resource registered after inspection invalidates the proof and leaves the binding occupied', async t => {
  const h = await fixture(t), proof = await h.connect().cancel(cancel())
  h.store.bindings.record({ ...binding, resources: [...binding.resources, { ref: 'late-resource', ownership: 'spawned_process' }] })
  assert.throws(() => confirmOwnedQuiescence(h.store, proof), error => error instanceof ResourceBarrierError && error.code === 'resource_manifest_changed')
  assert.equal(h.store.bindings.binding(binding.attemptId).state, 'active')
})
test('receipt failure rolls back the binding, observations and events together', async t => {
  const h = await fixture(t), proof = await h.connect().cancel(cancel()), cursor = h.store.events.cursor()
  h.store.db.exec("CREATE TRIGGER fail_barrier_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END")
  assert.throws(() => confirmOwnedQuiescence(h.store, proof), /injected receipt failure/)
  assert.equal(h.store.bindings.binding(binding.attemptId).state, 'active')
  assert.equal(h.store.events.cursor(), cursor)
  assert.equal(h.store.observations.forAttempt(binding.attemptId).length, 0)
  assert.equal(h.store.db.prepare('SELECT COUNT(*) AS n FROM fact_receipts').get().n, 0)
  h.store.db.exec('DROP TRIGGER fail_barrier_receipt')
  assert.equal(confirmOwnedQuiescence(h.store, proof).replayed, false)
})
test('mutating the public proof view cannot change authenticated evidence; credentials never enter persisted proofs', async t => {
  const h = await fixture(t), liveProof = await h.connect().inspect()
  Object.assign(liveProof.inspection, stopped())
  assert.throws(() => confirmOwnedQuiescence(h.store, liveProof), ResourceBarrierError)
  const proof = await h.connect().cancel(cancel()), result = confirmOwnedQuiescence(h.store, proof)
  const saved = await h.store.payloads.read(result.result.proofRef), text = JSON.stringify(saved)
  assert.equal(text.includes(readFileSync(h.credentialPath, 'utf8')), false)
  assert.equal(text.includes(h.credentialPath), false)
  assert.equal(saved.value.inspection.state, 'terminated')
})
test('an unresponsive backend is bounded by an absolute client deadline and errors redact credentials', async t => {
  const h = await fixture(t, { state: () => new Promise(() => {}) })
  await assert.rejects(connectRunnerRecovery(h.service.endpoint, producer, 30).inspect(), error => {
    assert.equal(String(error).includes(readFileSync(h.credentialPath, 'utf8')), false)
    return error instanceof RunnerLinkError && error.code === 'timeout'
  })
})
test('oversized inspections and control bodies are rejected before becoming proofs or actions', async t => {
  const state = { ...stopped(), resources: Array.from({ length: 64 }, (_, i) => ({ ref: `res-${i}`, ownership: 'spawned_process', writer: 'quiescent', evidence: Array(32).fill('x'.repeat(100)) })) }
  const h = await fixture(t, { state: () => state })
  await assert.rejects(h.connect().inspect(), RunnerLinkError)
  await assert.rejects(h.connect().cancel({ ...cancel(), id: 'x'.repeat(65536) }), RunnerLinkError)
  assert.equal(h.calls(), 0)
})
test('confirming an old known attempt never changes the newer current attempt or completes its Ticket', async t => {
  const h = await fixture(t), proof = await h.connect().cancel(cancel())
  const newer = { ...binding, attemptId: 'attempt-2', assignmentId: 'assignment-2', fenceEpoch: 2, runnerIdentityRef: 'runner-2', resources: [{ ref: 'res-2', ownership: 'spawned_process' }] }
  h.store.bindings.record(newer); h.store.bindings.setCurrent(binding.ticketId, newer.attemptId)
  confirmOwnedQuiescence(h.store, proof)
  assert.equal(h.store.bindings.binding(binding.attemptId).state, 'ended')
  assert.deepEqual(h.store.bindings.current(binding.ticketId), newer)
  assert.equal(h.store.domain.tickets.get(binding.ticketId).ended, undefined)
})
test('a complete empty inventory still needs terminal closed peer proof and produces no empty writer fact', async t => {
  const h = await fixture(t, { binding: { ...binding, resources: [] }, state: () => ({ ...stopped(), resources: [] }) })
  const receipt = confirmOwnedQuiescence(h.store, await h.connect().inspect())
  assert.equal(receipt.result.writerFactId, undefined)
  assert.equal(h.store.observations.forAttempt(binding.attemptId).length, 0)
  assert.equal(h.store.bindings.binding(binding.attemptId).state, 'ended')
  assert.equal(h.store.domain.tickets.get(binding.ticketId).ended, undefined)
})
