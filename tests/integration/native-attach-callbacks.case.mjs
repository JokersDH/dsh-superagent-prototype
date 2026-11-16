import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { key } from '../../packages/orchestrator-core/dist/index.js'
import { JsonSchema } from '../../packages/contracts/src/schemas.ts'
import { canonicalDigest } from '../../packages/contracts/src/canonical.ts'
import { NativeProductAttempt } from '../../apps/coordinator/product/native-attempt.ts'
import { RunnerPayloadStore } from '../../apps/runner/src/payload-store.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'
import { binding, producer } from './runtime-ingress-fixture.ts'

// These are real NativeProductAttempt methods over a real Store, without launch(), fake running
// handles or registration proof. The current predicate/admission callback is controlled; this does not
// claim an Application/QuestionBroker recovery or an actual native write.
function fixture(t) {
  const root = mkdtempSync('/tmp/pa-native-attach-callbacks-')
  const store = new ProductStore({ path: join(root, 'state.sqlite'), artifactsRoot: join(root, 'artifacts') })
  store.authority.enable(binding.contract)
  store.bindings.record(structuredClone(binding))
  store.bindings.setCurrent(binding.ticketId, binding.attemptId)
  let current = true
  let sinkCalls = 0
  const runtime = new NativeProductAttempt(
    makeAttemptSpec(), store, root, join(root, 'runner-state'), producer,
    { record: async () => { sinkCalls += 1; throw new Error('No receipt without original registration') } },
    () => current && store.bindings.current(binding.ticketId)?.state === 'active' && store.authority.isCurrent(binding.contract),
  )
  t.after(async () => {
    // No Runner was launched. End the fixture binding so ordinary dispose only removes its own root.
    store.bindings.record({ ...binding, state: 'ended' })
    await runtime.dispose()
    store.close()
    rmSync(root, { recursive: true, force: true })
  })
  const command = id => makeCommand('answer', { ...producer.attempt, id, nativeBindingRef: 'binding-original', answerRef: 'answer-original' })
  const index = value => {
    const record = { command: value, inputIds: [] }
    store.commands.record(key('product-command', value.id), canonicalDigest(JsonSchema.parse(record)), () => record)
  }
  return {
    root, store, runtime, command, index,
    setCurrent(value) { current = value },
    get sinkCalls() { return sinkCalls },
  }
}

test('normal void guard and attached decision share the original one-shot answer map', async t => {
  const h = fixture(t)
  let admitted = 0
  const normal = h.command('normal-original-guard')
  h.index(normal)
  h.runtime.allowAnswer(normal.id, () => { admitted += 1 })
  assert.equal(await h.runtime.beforeNativeWrite(normal), undefined)
  assert.deepEqual(await h.runtime.nativeWriteDecision(normal), { allowed: false })
  assert.equal(admitted, 1)

  const attached = h.command('attached-original-guard')
  h.index(attached)
  h.runtime.allowAnswer(attached.id, () => { admitted += 1 })
  assert.deepEqual(await h.runtime.nativeWriteDecision(attached), { allowed: true })
  await assert.rejects(() => h.runtime.beforeNativeWrite(attached), /no live write admission/)
  assert.equal(admitted, 2, 'neither path can reuse the other path\'s successful admission')
})

for (const mode of ['missing-command', 'missing-admission', 'wrong-body', 'not-current', 'guard-throws']) {
  test(`attached original guard refuses ${mode} without manufacturing approval`, async t => {
    const h = fixture(t)
    const command = h.command(`refused-${mode}`)
    let called = 0
    if (mode !== 'missing-command') h.index(mode === 'wrong-body' ? { ...command, answerRef: 'different-recorded-answer' } : command)
    if (mode !== 'missing-admission') h.runtime.allowAnswer(command.id, () => {
      called += 1
      if (mode === 'guard-throws') throw new Error('Original live admission refused')
    })
    if (mode === 'not-current') h.setCurrent(false)
    assert.deepEqual(await h.runtime.nativeWriteDecision(command), { allowed: false })
    assert.equal(called, mode === 'guard-throws' ? 1 : 0)
    assert.equal(h.sinkCalls, 0)
  })
}

test('late callback rechecks current binding instead of capturing an earlier allowed boolean', async t => {
  const h = fixture(t)
  const command = h.command('late-original-current')
  h.index(command)
  let called = 0
  h.runtime.allowAnswer(command.id, () => { called += 1 })
  const late = () => h.runtime.nativeWriteDecision(command)
  h.store.bindings.record({ ...binding, state: 'stopping' })
  assert.deepEqual(await late(), { allowed: false })
  assert.equal(called, 0)
})

test('wrong command body does not consume the original live admission', async t => {
  const h = fixture(t)
  const command = h.command('body-then-original')
  h.index(command)
  let called = 0
  h.runtime.allowAnswer(command.id, () => { called += 1 })
  assert.deepEqual(await h.runtime.nativeWriteDecision({ ...command, answerRef: 'foreign-answer' }), { allowed: false })
  assert.equal(called, 0)
  assert.deepEqual(await h.runtime.nativeWriteDecision(command), { allowed: true })
  assert.equal(called, 1)
})

test('shared payload callback reads the original immutable Store body and refuses a missing reference', async t => {
  const h = fixture(t)
  const body = { source: 'original-store', nested: { value: 7 } }
  const original = h.store.payloads.write(body)
  assert.deepEqual(await h.runtime.readPayload(original.ref), body)
  await assert.rejects(() => h.runtime.readPayload('payload:missing-original'))
  assert.equal(h.sinkCalls, 0)
})

test('shared fact callback rejects foreign source before copying, registration, receipt or readiness', async t => {
  const h = fixture(t)
  const local = new RunnerPayloadStore(join(h.root, 'local-payloads'))
  const payload = { kind: 'turn.ended', value: { nativeTurnRef: 'original-fact', outcome: 'completed', candidateAvailable: false, evidenceRefs: [] } }
  const payloadRef = local.write(payload, 'critical')
  let prepared = 0
  await assert.rejects(() => h.runtime.recordFact({
    ...producer.attempt, factId: 'foreign-native-fact', source: 'foreign-source', kind: 'turn.ended', payloadRef,
  }, local, () => { prepared += 1 }), /another producer/)
  await assert.rejects(() => h.runtime.readPayload(payloadRef))
  assert.equal(h.sinkCalls, 0)
  assert.equal(prepared, 0)
  assert.equal(h.runtime.preparedPolicyRef, undefined)
})

test('matching fact preserves copy identity but missing original registration refuses receipt and readiness', async t => {
  const h = fixture(t)
  const local = new RunnerPayloadStore(join(h.root, 'local-payloads'))
  const payload = { kind: 'turn.ended', value: { nativeTurnRef: 'needs-real-registration', outcome: 'completed', candidateAvailable: false, evidenceRefs: [] } }
  const payloadRef = local.write(payload, 'critical')
  let prepared = 0
  await assert.rejects(() => h.runtime.recordFact({
    ...producer.attempt, factId: 'unregistered-native-fact', source: producer.source, kind: 'turn.ended', payloadRef,
  }, local, () => { prepared += 1 }))
  assert.deepEqual(await h.runtime.readPayload(payloadRef), payload)
  assert.equal(h.store.payloads.write(payload).ref, payloadRef)
  assert.equal(h.sinkCalls, 0)
  assert.equal(prepared, 0)
  assert.equal(h.runtime.preparedPolicyRef, undefined)
  assert.equal(h.store.facts.get('unregistered-native-fact'), undefined)
})
