import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, readFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRunnerCredential, serveRunnerRecovery, connectRunnerRecovery } from '../../apps/coordinator/runner-link.ts'
import { registerRecoveryRunner, loadRecoveryRunner, runnerRegistrationId, adoptRegisteredRunnerResources, RunnerRegistrationError } from '../../apps/coordinator/runner-registry.ts'
import { reconcileRegisteredRunner } from '../../apps/coordinator/reconcile-runner.ts'
import { handleRunnerRecovery } from '../../apps/coordinator/recovery-effects.ts'
import { Effects } from '../../packages/effects/dist/index.js'
import { openRecoveryFixture } from './recovery-fixture.mjs'
import { binding, producer } from './runtime-ingress-fixture.ts'

const live = () => ({ state: 'serving', admission: 'open', coverage: 'complete_owned_resources', resources: binding.resources.map(resource => ({ ...resource, writer: 'active', evidence: ['owned-running'] })), evidence: ['fixture-owned-inventory'] })
const stopped = () => ({ ...live(), state: 'terminated', admission: 'closed', resources: live().resources.map(resource => ({ ...resource, writer: 'quiescent', evidence: ['group-quiescent'] })) })
async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'pa-reg-')), credentialPath = join(directory, 'runner.key')
  createRunnerCredential(credentialPath)
  let h = openRecoveryFixture(directory), state = live(), inspections = 0
  const cancelIds = []
  const service = await serveRunnerRecovery({ credentialPath, socketPath: join(directory, 'runner.sock') }, options.producer ?? producer, {
    inspect: async () => { inspections++; options.onInspect?.(h.store); return structuredClone(state) },
    cancel: async command => { cancelIds.push(command.id); options.onCancel?.(h.store, command); if (options.failCancel) throw new Error('backend uncertain'); state = stopped(); return state },
  })
  t.after(async () => { await service.close(); h.close(); rmSync(directory, { recursive: true, force: true }) })
  const client = () => connectRunnerRecovery(service.endpoint, options.producer ?? producer)
  return { directory, service, client, cancelIds, inspections: () => inspections, setState: value => { state = value },
    get store() { return h.store }, get core() { return h.core }, get ingress() { return h.ingress },
    reopen: () => { h.close(); h = openRecoveryFixture(directory) },
    register: async () => registerRecoveryRunner(h.store, await client().inspect()),
    hold: () => h.store.uow.atomic(() => h.store.bindings.record({ ...h.store.bindings.binding(binding.attemptId), state: 'stopping' })),
    reconcile: () => reconcileRegisteredRunner(h.store, binding.attemptId),
  }
}
test('fresh launcher registration persists through SQLite reopen and exact endpoint re-registration is idempotent', async t => {
  const h = await fixture(t), first = await h.register(), loaded = loadRecoveryRunner(h.store, binding.attemptId)
  assert.equal(loaded.receiptSeq, first.seq)
  assert.deepEqual(loaded.body.endpoint, h.service.endpoint)
  const again = await h.register(); assert.equal(again.replayed, true); assert.equal(again.seq, first.seq)
  h.reopen()
  assert.deepEqual(loadRecoveryRunner(h.store, binding.attemptId), loaded)
  const audit = JSON.stringify({ events: h.store.events.after(0), payload: await h.store.payloads.read(loaded.proofRef) })
  assert.equal(audit.includes(readFileSync(h.service.endpoint.credentialPath, 'utf8')), false)
  assert.equal(audit.includes(h.service.endpoint.credentialPath), false)
})
test('plain JSON and unknown producer proofs cannot create trusted registrations', async t => {
  const h = await fixture(t), proof = await h.client().inspect()
  assert.throws(() => registerRecoveryRunner(h.store, JSON.parse(JSON.stringify(proof))))
  const other = await fixture(t, { producer: { ...producer, attempt: { ...producer.attempt, attemptId: 'unknown-attempt' } } })
  const unknown = await other.client().inspect()
  assert.throws(() => registerRecoveryRunner(other.store, unknown), error => error instanceof RunnerRegistrationError && error.code === 'unknown_binding')
  const stale = await fixture(t, { producer: { ...producer, attempt: { ...producer.attempt, fenceEpoch: 2 } } })
  const staleProof = await stale.client().inspect()
  assert.throws(() => registerRecoveryRunner(stale.store, staleProof), error => error.code === 'identity_mismatch')
})
test('an endpoint cannot replace another endpoint for the same attempt', async t => {
  const h = await fixture(t); await h.register()
  const credentialPath = join(h.directory, 'replacement.key'); createRunnerCredential(credentialPath)
  const replacement = await serveRunnerRecovery({ credentialPath, socketPath: join(h.directory, 'replacement.sock') }, producer, { inspect: async () => live(), cancel: async () => stopped() })
  try {
    const proof = await connectRunnerRecovery(replacement.endpoint, producer).inspect()
    assert.throws(() => registerRecoveryRunner(h.store, proof), /different digest/)
    assert.deepEqual(loadRecoveryRunner(h.store, binding.attemptId).body.endpoint, h.service.endpoint)
  } finally { await replacement.close() }
})
test('new registration is refused for an ended binding', async t => {
  const h = await fixture(t), proof = await h.client().inspect()
  h.store.bindings.end(binding.attemptId)
  assert.throws(() => registerRecoveryRunner(h.store, proof), error => error.code === 'ended_binding')
  assert.equal(loadRecoveryRunner(h.store, binding.attemptId), undefined)
})
test('registration receipt failure rolls back the registration event and leaves recovery held', async t => {
  const h = await fixture(t), proof = await h.client().inspect(), cursor = h.store.events.cursor()
  h.store.db.exec("CREATE TRIGGER fail_registration BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, 'registration receipt failure'); END")
  assert.throws(() => registerRecoveryRunner(h.store, proof), /registration receipt failure/)
  assert.equal(h.store.events.cursor(), cursor)
  assert.equal(loadRecoveryRunner(h.store, binding.attemptId), undefined)
  assert.deepEqual(await h.reconcile(), { status: 'held', attemptId: binding.attemptId, reason: 'registration_missing' })
  assert.equal(h.cancelIds.length, 0)
})
test('recovery of a running registered attempt is read-only and never resumes business', async t => {
  const h = await fixture(t); await h.register(); h.reopen()
  const cursor = h.store.events.cursor()
  assert.deepEqual(await h.reconcile(), { status: 'running', attemptId: binding.attemptId, businessResumed: false })
  assert.equal(h.cancelIds.length, 0); assert.equal(h.store.events.cursor(), cursor)
  assert.equal(h.store.bindings.binding(binding.attemptId).state, 'active')
})
test('stopping recovery commits its stable cancellation identity before peer I/O and confirms physical quiescence only', async t => {
  const h = await fixture(t, { onCancel: (store, command) => {
    assert.equal(store.uow.nesting, 0)
    assert.equal(store.commands.get(command.id).result.command.id, command.id)
  } })
  await h.register(); h.hold()
  const result = await h.reconcile()
  assert.equal(result.status, 'quiescent'); assert.equal(h.cancelIds.length, 1)
  const event = h.store.events.after(result.barrier.result.confirmedEventSeq - 1, 1)[0]
  assert.deepEqual(event.payload.attempt, producer.attempt)
  assert.equal(event.payload.writerFactId, result.barrier.result.writerFactId)
  assert.deepEqual(h.store.commands.get(event.payload.barrierCommandId).result, result.barrier.result)
  assert.equal(h.store.bindings.binding(binding.attemptId).state, 'ended')
  assert.equal(h.store.domain.tickets.get(binding.ticketId).ended, undefined)
  const cursor = h.store.events.cursor(), payloads = h.store.db.prepare('SELECT COUNT(*) AS n FROM ingress_payloads').get().n
  h.reopen()
  const again = await h.reconcile()
  assert.equal(again.barrier.replayed, true); assert.equal(again.barrier.seq, result.barrier.seq)
  assert.equal(h.cancelIds.length, 1); assert.equal(h.store.events.cursor(), cursor)
  assert.equal(h.store.db.prepare('SELECT COUNT(*) AS n FROM ingress_payloads').get().n, payloads)
})
test('cancel intent receipt failure prevents sending cancellation and keeps the attempt occupied', async t => {
  const h = await fixture(t); await h.register(); h.hold()
  h.store.db.exec("CREATE TRIGGER fail_cancel_intent BEFORE INSERT ON command_receipts WHEN json_extract(NEW.result, '$.kind') = 'runner-cancel-intent/1' BEGIN SELECT RAISE(ABORT, 'intent receipt failure'); END")
  await assert.rejects(h.reconcile(), /intent receipt failure/)
  assert.equal(h.cancelIds.length, 0); assert.equal(h.store.bindings.binding(binding.attemptId).state, 'stopping')
})
test('an unknown cancellation outcome stays held and all retries reuse the same peer command', async t => {
  const h = await fixture(t, { failCancel: true }); await h.register(); h.hold()
  const first = await h.reconcile(); h.reopen(); const second = await h.reconcile()
  assert.equal(first.status, 'held'); assert.equal(second.status, 'held')
  assert.equal(first.cancelCommandId, second.cancelCommandId)
  assert.equal(h.cancelIds.length, 1)
  assert.equal(h.store.bindings.binding(binding.attemptId).state, 'stopping')
})
test('failure after peer stop rolls back the barrier and the next recovery inspects without another cancellation', async t => {
  const h = await fixture(t); await h.register(); h.hold()
  h.store.db.exec("CREATE TRIGGER fail_recovery_barrier BEFORE INSERT ON command_receipts WHEN json_extract(NEW.result, '$.scope') = 'registered_owned_resources_only' BEGIN SELECT RAISE(ABORT, 'barrier receipt failure'); END")
  await assert.rejects(h.reconcile(), /barrier receipt failure/)
  assert.equal(h.cancelIds.length, 1); assert.equal(h.store.bindings.binding(binding.attemptId).state, 'stopping')
  assert.equal(h.store.observations.forAttempt(binding.attemptId).length, 0)
  h.store.db.exec('DROP TRIGGER fail_recovery_barrier'); h.reopen()
  assert.equal((await h.reconcile()).status, 'quiescent'); assert.equal(h.cancelIds.length, 1)
})
test('a changed registered manifest remains held after peer cancellation', async t => {
  const h = await fixture(t); await h.register(); h.hold()
  h.store.bindings.record({ ...h.store.bindings.binding(binding.attemptId), resources: [...binding.resources, { ref: 'late-resource', ownership: 'spawned_process' }] })
  const result = await h.reconcile()
  assert.equal(result.status, 'held'); assert.equal(result.reason, 'resource_manifest_changed')
  assert.equal(h.store.bindings.binding(binding.attemptId).state, 'stopping')
})
test('a pinned Runner inventory can add later preparation children before confirming a complete stop', async t => {
  const h = await fixture(t); await h.register(); h.hold()
  const late = { ref: 'late-preparation-process', ownership: 'spawned_process', writer: 'quiescent', evidence: ['owned-preparation-stopped'] }
  h.setState({ ...stopped(), resources: [...stopped().resources, late] })
  const result = await h.reconcile()
  assert.equal(result.status, 'quiescent')
  assert.ok(h.store.bindings.binding(binding.attemptId).resources.some(resource => resource.ref === late.ref))
  assert.equal(h.cancelIds.length, 0)
  h.reopen()
  assert.equal((await h.reconcile()).barrier.replayed, true)
})
test('late inventory adoption rejects another endpoint and a known ownership replacement', async t => {
  const h = await fixture(t); await h.register()
  const credentialPath = join(h.directory, 'other-inventory.key'); createRunnerCredential(credentialPath)
  const other = await serveRunnerRecovery({ credentialPath, socketPath: join(h.directory, 'other-inventory.sock') }, producer, { inspect: async () => stopped(), cancel: async () => stopped() })
  try {
    const proof = await connectRunnerRecovery(other.endpoint, producer).inspect()
    assert.throws(() => adoptRegisteredRunnerResources(h.store, proof), error => error.code === 'invalid_registration')
  } finally { await other.close() }
  const original = h.store.bindings.binding(binding.attemptId)
  h.setState({ ...stopped(), resources: stopped().resources.map(resource => ({ ...resource, ownership: resource.ownership === 'spawned_process' ? 'shared_service_session' : 'spawned_process' })) })
  const proof = await h.client().inspect()
  assert.throws(() => adoptRegisteredRunnerResources(h.store, proof), error => error.code === 'identity_mismatch')
  assert.deepEqual(h.store.bindings.binding(binding.attemptId), original)
})
test('old registered cleanup preserves a newer current attempt and its authority', async t => {
  const h = await fixture(t); await h.register(); h.hold()
  const newer = { ...binding, attemptId: 'attempt-2', fenceEpoch: 2, assignmentId: 'assignment-2', runnerIdentityRef: 'runner-2' }
  h.store.bindings.record(newer); h.store.bindings.setCurrent(binding.ticketId, newer.attemptId)
  h.store.authority.disable(binding.contract)
  assert.equal((await h.reconcile()).status, 'quiescent')
  assert.deepEqual(h.store.bindings.current(binding.ticketId), newer)
  assert.equal(h.store.authority.isCurrent(binding.contract), false)
})
test('partial or indeterminate running inspections do not resume or release an attempt', async t => {
  const h = await fixture(t); await h.register()
  for (const change of [{ coverage: 'partial' }, { resources: [] }, { resources: live().resources.map(resource => ({ ...resource, writer: 'indeterminate' })) }]) {
    h.setState({ ...live(), ...change })
    assert.equal((await h.reconcile()).status, 'held')
    assert.equal(h.store.bindings.binding(binding.attemptId).state, 'active')
  }
  assert.equal(h.cancelIds.length, 0)
})
test('corrupt registration metadata is held without contacting a guessed endpoint', async t => {
  const h = await fixture(t); await h.register()
  h.store.db.prepare('UPDATE command_receipts SET payload_digest = ? WHERE command_id = ?').run('f'.repeat(64), runnerRegistrationId(binding.attemptId))
  const before = h.inspections(), result = await h.reconcile()
  assert.equal(result.status, 'held'); assert.equal(result.reason, 'invalid_registration')
  assert.equal(h.inspections(), before); assert.equal(h.cancelIds.length, 0)
})
test('missing credentials and a changed socket permission remain held without cancel or release', async t => {
  const h = await fixture(t); await h.register(); h.hold()
  chmodSync(h.service.endpoint.socketPath, 0o666)
  assert.equal((await h.reconcile()).reason, 'identity_mismatch')
  chmodSync(h.service.endpoint.socketPath, 0o600)
  rmSync(h.service.endpoint.credentialPath)
  assert.equal((await h.reconcile()).reason, 'connection_unavailable')
  assert.equal(h.cancelIds.length, 0); assert.equal(h.store.bindings.binding(binding.attemptId).state, 'stopping')
})
test('a terminal peer with partial coverage cannot release the occupied attempt', async t => {
  const h = await fixture(t); await h.register(); h.hold()
  h.setState({ ...stopped(), coverage: 'partial' })
  assert.equal((await h.reconcile()).reason, 'not_quiescent')
  assert.equal(h.cancelIds.length, 0); assert.equal(h.store.bindings.binding(binding.attemptId).state, 'stopping')
})
test('a stop persisted during asynchronous inspection is re-read before deciding to leave work running', async t => {
  let count = 0
  const h = await fixture(t, { onInspect: store => { if (++count === 2) store.bindings.record({ ...store.bindings.binding(binding.attemptId), state: 'stopping' }) } })
  await h.register()
  assert.equal((await h.reconcile()).status, 'quiescent')
  assert.equal(h.cancelIds.length, 1)
})
test('registration and recovery refuse a caller-owned transaction before external I/O', async t => {
  const h = await fixture(t), proof = await h.client().inspect()
  h.store.uow.atomic(() => assert.throws(() => registerRecoveryRunner(h.store, proof), error => error.code === 'invalid_transaction'))
  let work
  h.store.uow.atomic(() => { work = h.reconcile() })
  await assert.rejects(work, error => error.code === 'invalid_transaction')
  assert.equal(h.cancelIds.length, 0)
})
test('a real config-change fact queues valid JSON and the existing Effects queue drives physical recovery', async t => {
  const h = await fixture(t); await h.register()
  h.core.reportAssignment(binding.ticketId, binding.assignmentId, { state: 'ready', summary: 'candidate' })
  const payload = { kind: 'config.changed', value: { previousFingerprint: 'a'.repeat(64), observedFingerprint: 'b'.repeat(64), detection: 'watch', evidenceRefs: ['config-evidence'] } }
  const fact = { ...producer.attempt, source: producer.source, factId: 'config-reconcile-1', kind: payload.kind, payloadRef: h.store.payloads.write(payload).ref }
  assert.equal((await h.ingress.recordFenced(fact, producer)).accepted, true)
  const row = h.store.queue.dueRows('runtime.reconcile', 0, 10)[0]
  assert.equal(JSON.parse(row.payload), fact.payloadRef)
  assert.equal(h.core.completionCandidate(binding.ticketId), undefined)
  const effects = new Effects(h.store.queue); handleRunnerRecovery(effects, h.store); effects.start()
  try { await effects.idle(); assert.equal(effects.pending('runtime.reconcile'), false) }
  finally { await effects.drain() }
  assert.equal(h.cancelIds.length, 1)
  assert.equal(h.store.bindings.binding(binding.attemptId).state, 'ended')
  assert.equal(h.store.domain.tickets.get(binding.ticketId).ended, undefined)
})
test('a held recovery row survives reopen with bounded retry and retains one cancellation identity', async t => {
  const h = await fixture(t, { failCancel: true }); await h.register(); h.hold()
  const first = new Effects(h.store.queue, undefined, () => 0); handleRunnerRecovery(first, h.store)
  h.store.uow.atomic(() => first.enqueue('runtime.reconcile', binding.attemptId, 'reason-1')); first.start()
  await first.idle(); await first.drain()
  assert.equal(h.store.queue.oldestRow('runtime.reconcile').due, 2000)
  h.reopen()
  const second = new Effects(h.store.queue, undefined, () => 3000); handleRunnerRecovery(second, h.store); second.start()
  try { await second.idle() } finally { await second.drain() }
  const waiting = h.store.queue.oldestRow('runtime.reconcile')
  assert.equal(waiting.attempts, 2); assert.equal(waiting.due, 7000)
  assert.match(waiting.error, /Runtime recovery held: unknown_outcome/)
  assert.equal(h.cancelIds.length, 1)
  assert.equal(h.store.bindings.binding(binding.attemptId).state, 'stopping')
})
test('reconciliation coalesced during peer inspection survives the older queue generation completing', async t => {
  let reads = 0
  const h = await fixture(t, { onInspect: store => {
    if (++reads === 2) store.uow.atomic(() => store.queue.enqueue('runtime.reconcile', binding.attemptId, JSON.stringify('reason-2'), store.queue.maxSeq() + 1, 0, new Date().toISOString()))
  } })
  await h.register(); h.hold()
  const effects = new Effects(h.store.queue); handleRunnerRecovery(effects, h.store)
  h.store.uow.atomic(() => effects.enqueue('runtime.reconcile', binding.attemptId, 'reason-1')); effects.start()
  try { await effects.idle(); assert.equal(effects.pending('runtime.reconcile'), false) }
  finally { await effects.drain() }
  assert.equal(reads, 3); assert.equal(h.cancelIds.length, 1)
  assert.equal(h.store.events.after(0).filter(event => event.topic === 'runtime.barrier.confirmed').length, 1)
})
test('malformed queue payloads fail before contacting a peer and do not release their binding', async t => {
  const h = await fixture(t); await h.register(); h.hold()
  const before = h.inspections(), effects = new Effects(h.store.queue, undefined, () => 0)
  handleRunnerRecovery(effects, h.store)
  h.store.uow.atomic(() => effects.enqueue('runtime.reconcile', binding.attemptId, { endpoint: 'not-authority' })); effects.start()
  try { await effects.idle() } finally { await effects.drain() }
  assert.equal(h.store.queue.oldestRow('runtime.reconcile').attempts, 1)
  assert.equal(h.inspections(), before); assert.equal(h.cancelIds.length, 0)
  assert.equal(h.store.bindings.binding(binding.attemptId).state, 'stopping')
})
