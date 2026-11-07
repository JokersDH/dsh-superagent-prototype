import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createPersonalEngine } from '../../packages/orchestrator-core/dist/index.js'
import { ExecutionInputSchema, PreparedExecutionPolicySchema } from '../../packages/contracts/dist/index.js'
import { bindCoreRepositories } from '../../apps/coordinator/main.ts'
import { createStoredRuntimeIngress, storedAttemptPayloads } from '../../apps/coordinator/stored-ingress.ts'
import { ProcessHost, ControlledRunnerHost } from '../../apps/runner/src/index.ts'
import { AttemptSupervisor } from '../../packages/execution/src/index.ts'
import { FakeDriver } from '../../packages/testing/src/fake-driver.ts'
import { makeAttemptSpec } from '../../packages/testing/src/fixtures.ts'
import { initialTicket, binding as fixtureBinding, producer as fixtureProducer } from './runtime-ingress-fixture.ts'

const binding = { ...fixtureBinding, source: 'fake-driver' }
const producer = { ...fixtureProducer, source: binding.source }

async function until(predicate, timeout = 3000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  throw new Error('Integration condition did not arrive before its deadline')
}
async function bounded(promise, timeout = 5000) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Runtime integration timeout')), timeout) })]) }
  finally { clearTimeout(timer) }
}
function fixture(t, scenario = 'happy') {
  const directory = mkdtempSync(join(tmpdir(), 'g1-production-runtime-'))
  const receiptsPath = join(directory, 'native-receipts.jsonl')
  let store = new ProductStore({ path: join(directory, 'state.sqlite'), artifactsRoot: join(directory, 'artifacts') })
  let policyAllowed = true
  const policy = () => ({ version: 'v1', paused: false, evalTimeoutMs: 1000, gate: () => ({ admissible: false, reason: 'fixture' }), revalidate: () => policyAllowed, admitsInferred: () => false })
  store.domain.tickets.save(initialTicket()); store.authority.enable(binding.contract)
  const createCore = () => createPersonalEngine({
    repo: bindCoreRepositories(store),
    policy,
    scope: { scope: () => ({ listened: true, observed: false }) }, assessor: { request: () => {} },
    executor: { start: () => {}, deliver: () => {}, stop: () => {} }, outbox: { send: () => {}, withdraw: () => {}, status: () => undefined },
    completionPolicy: () => { throw new Error('Preseeded integration only') }, isCurrentContract: ref => store.authority.isCurrent(ref),
  })
  let core = createCore()
  const ingress = createStoredRuntimeIngress(store, core, policy)
  const spec = makeAttemptSpec()
  const initialInputRef = store.payloads.write(ExecutionInputSchema.parse({ inputId: 'initial-input-1', contract: binding.contract, text: 'Controlled fixture operation only.', contextRefs: [], sourceMessageRefs: ['request-1'], provenance: 'authorized_work_input' })).ref
  // A structural fixture policy, not evidence of any vendor's permission enforcement.
  const preparedPolicyRef = store.payloads.write(PreparedExecutionPolicySchema.parse({ ...producer.attempt, requestedPolicyRevision: spec.profile.permissionPolicyRevision, nativeAppliedSettingsRef: 'fixture-settings-1', effectiveConfigFingerprint: 'b'.repeat(64), enforcement: 'advisory', verification: 'passed', evidenceRef: 'fixture-preparation-1' })).ref
  const observedFacts = [], observedReceipts = []
  const bound = ingress.bind(producer)
  const sink = { record: async input => { const receipt = await bound.record(input); observedFacts.push(input); observedReceipts.push(receipt); return receipt } }
  class RegisteredProcessHost extends ProcessHost {
    async spawn(spec) {
      const resource = await super.spawn(spec)
      try {
        store.uow.atomic(() => {
          const known = store.bindings.binding(binding.attemptId)
          if (!known) throw new Error('No trusted binding before process launch')
          store.bindings.record({ ...known, resources: [...known.resources, { ref: resource.resourceRef, ownership: 'spawned_process' }] })
        })
      } catch (error) { await super.stopOwned(resource.resourceRef, 1000); throw error }
      return resource
    }
  }
  const processes = new RegisteredProcessHost({ resolveCwd: () => directory, resolveEnv: () => ({ ...process.env, FAKE_AGENT_RECEIPTS: receiptsPath }) })
  const host = new ControlledRunnerHost(requested => ({ spec: requested, options: { payloads: storedAttemptPayloads(store), factSink: sink, processHost: processes } }), () => new FakeDriver({ scenario, preparedPolicyRef }))
  const supervisor = new AttemptSupervisor({
    runner: host, sink, preparedPolicyRef, stopDeadlineMs: 500,
    bindings: {
      current: ticketId => store.bindings.current(ticketId),
      save: value => store.uow.atomic(() => {
        const known = store.bindings.binding(value.attemptId)
        store.bindings.record({ ...value, runnerIdentityRef: producer.runnerIdentityRef, source: producer.source, resources: known?.resources ?? [] })
        if (store.bindings.current(value.ticketId)?.attemptId !== value.attemptId) store.bindings.setCurrent(value.ticketId, value.attemptId)
      }),
    },
  })
  const frames = () => existsSync(receiptsPath) ? readFileSync(receiptsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
  t.after(async () => { await processes.stopAll(1000); store.close(); rmSync(directory, { recursive: true, force: true }) })
  return {
    get store() { return store }, get core() { return core }, ingress, processes, host, spec, supervisor, frames, observedFacts, observedReceipts, policy,
    revokePolicy: () => { policyAllowed = false },
    start: () => supervisor.start({ ...spec, spec, initialInputRef }),
    reopen: () => { store.close(); store = new ProductStore({ path: join(directory, 'state.sqlite'), artifactsRoot: join(directory, 'artifacts') }); core = createCore(); return store },
  }
}

test('production tables + controlled fake child persist strict turn/exit facts and ACKs without completing the Ticket', async t => {
  const h = fixture(t)
  await h.start(); const exit = await bounded(h.supervisor.waitExit(h.spec.ticketId))
  assert.equal(exit.reason, 'terminal')
  assert.ok(h.observedFacts.some(input => input.kind === 'turn.ended'))
  assert.ok(h.observedFacts.some(input => input.kind === 'runtime.exited'))
  for (const receipt of h.observedReceipts) assert.equal(h.store.facts.get(receipt.factId).seq, receipt.seq)
  const summary = h.store.observations.summarize(h.spec.attemptId)
  assert.equal(summary.resources[0].exit.observed, true)
  assert.equal(summary.resources[0].quiescence, 'unknown')
  assert.equal(h.store.domain.tickets.get(h.spec.ticketId).ended, undefined)
  assert.equal(h.core.completionCandidate(h.spec.ticketId), undefined)
  assert.equal(h.frames().filter(frame => frame.type === 'begin.accepted').length, 1)
  const input = h.observedFacts.find(item => item.kind === 'turn.ended'), old = h.observedReceipts[h.observedFacts.indexOf(input)]
  const reopened = h.reopen()
  const replay = createStoredRuntimeIngress(reopened, h.core, h.policy).bind(producer)
  assert.deepEqual(await replay.record(input), old)
  assert.equal(h.frames().filter(frame => frame.type === 'begin.accepted').length, 1)
})
test('logical stop precedes physical cleanup; old physical exit still persists through the authoritative sink', async t => {
  const h = fixture(t, 'ignore-cancel')
  await h.start()
  await until(() => h.frames().some(frame => frame.type === 'begin.accepted'))
  h.core.stopTicket(h.spec.ticketId)
  assert.equal(h.store.domain.tickets.get(h.spec.ticketId).ended.outcome, 'stopped')
  const stopped = await bounded(h.supervisor.stop(h.spec.ticketId, 'user-stop'))
  assert.equal(stopped.quiescence, 'confirmed')
  await bounded(h.supervisor.waitExit(h.spec.ticketId))
  assert.equal(h.store.bindings.current(h.spec.ticketId).state, 'ended')
  assert.ok(h.observedFacts.some(input => input.kind === 'runtime.exited'))
  assert.equal(h.store.domain.tickets.get(h.spec.ticketId).ended.outcome, 'stopped')
})
function drift(h, id) {
  const payload = { kind: 'config.changed', value: { previousFingerprint: 'a'.repeat(64), observedFingerprint: 'b'.repeat(64), detection: 'watch', evidenceRefs: ['evidence-1'] } }
  return { ...producer.attempt, factId: id, source: producer.source, kind: payload.kind, payloadRef: h.store.payloads.write(payload).ref }
}
test('configuration drift atomically invalidates the candidate, holds the binding and queues reconciliation', async t => {
  const h = fixture(t)
  h.store.bindings.record(binding); h.store.bindings.setCurrent(binding.ticketId, binding.attemptId)
  h.core.reportAssignment(binding.ticketId, binding.assignmentId, { state: 'ready', summary: 'Candidate' })
  assert.equal((await h.ingress.recordFenced(drift(h, 'config-fact-1'), producer)).accepted, true)
  assert.equal(h.core.completionCandidate(binding.ticketId), undefined)
  assert.equal(h.store.bindings.current(binding.ticketId).state, 'stopping')
  assert.equal(h.store.queue.dueRows('runtime.reconcile', 0, 10).length, 1)
})
test('refusing the last receipt write rolls production core, binding, queued reconcile and observations back together', async t => {
  const h = fixture(t)
  h.store.bindings.record(binding); h.store.bindings.setCurrent(binding.ticketId, binding.attemptId)
  h.core.reportAssignment(binding.ticketId, binding.assignmentId, { state: 'ready', summary: 'Candidate' })
  const candidate = h.core.completionCandidate(binding.ticketId), input = drift(h, 'config-fact-fail'), cursor = h.store.events.cursor()
  h.store.db.exec("CREATE TRIGGER fail_production_fact BEFORE INSERT ON fact_receipts BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END")
  await assert.rejects(h.ingress.recordFenced(input, producer), /injected receipt failure/)
  assert.deepEqual(h.core.completionCandidate(binding.ticketId), candidate)
  assert.equal(h.store.bindings.current(binding.ticketId).state, 'active')
  assert.equal(h.store.queue.dueRows('runtime.reconcile', 0, 10).length, 0)
  assert.equal(h.store.events.cursor(), cursor)
  assert.equal(h.store.observations.get(input.factId), undefined)
})
test('an enabled contract does not override current Policy revocation', async t => {
  const h = fixture(t)
  h.store.bindings.record(binding); h.store.bindings.setCurrent(binding.ticketId, binding.attemptId)
  h.revokePolicy()
  const input = drift(h, 'revoked-policy-fact'), cursor = h.store.events.cursor()
  assert.deepEqual(await h.ingress.recordFenced(input, producer), { accepted: false, reason: 'stale_contract' })
  assert.equal(h.store.facts.get(input.factId), undefined)
  assert.equal(h.store.events.cursor(), cursor)
})
