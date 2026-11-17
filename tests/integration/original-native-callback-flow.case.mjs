import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { loadRecoveryRunner } from '../../apps/coordinator/runner-registry.ts'
import { connectRunnerRecovery } from '../../apps/coordinator/runner-link.ts'
import { nativeCallbackLink } from './fixtures/native-callback-link.ts'

const principal = { userId: 'original-callback-user', authorityRef: 'original-callback-authority' }
async function until(read, predicate, label) {
  const deadline = Date.now() + 12000
  let last
  while (Date.now() < deadline) {
    last = await read(); if (predicate(last)) return last
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`)
}
for (const revoked of [false, true]) test(revoked
  ? 'original attached Work refuses a question answer after original Store authority is revoked'
  : 'original Native.launch and Application/Broker use attached callbacks through delivered Work and original data reopen', { timeout: 20000 }, async t => {
  const root = mkdtempSync('/tmp/pa-original-callback-'), projectPath = join(root, 'project'), stateRoot = join(root, 'state')
  mkdirSync(join(projectPath, 'src'), { recursive: true }); mkdirSync(stateRoot)
  writeFileSync(join(projectPath, 'src/base.txt'), 'Base\n')
  const git = args => execFileSync('git', args, { cwd: projectPath, stdio: 'pipe' })
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'initial'])
  const trace = { virtualResources: 0, nativeEffects: 0, stdioFacts: [], stdioPayloads: 0, stdioGuards: 0, protocolMethods: [], errors: [], closers: [] }
  const originalKill = process.kill, suppressedSignals = []
  process.kill = (pid, signal) => { suppressedSignals.push({ pid, signal }); return true }
  const path = join(stateRoot, 'db.sqlite'), store = new ProductStore({ path })
  const profile = { id: 'profile-controlled-native-protocol', revision: 1, driverId: 'codex-native', driverApiMajor: 1, driverRelease: '0.1.0-test',
    executable: process.execPath, argv: [], expectedVersion: process.version, nativeConfigRef: 'controlled-config', permissionPolicyRevision: 'controlled-policy', requiredFeatures: [] }
  const scope = { projectId: 'one', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }
  const product = createProductRuntime({ store, stateRoot, scratchProject: projectPath, principal, actionSecret: Buffer.alloc(32, 14),
    projects: [{ id: 'one', displayName: 'Original flow', scope }], nativeRunnerLinkFactory: nativeCallbackLink(trace),
    native: { profile, approvalPolicy: 'on-request', projects: [{ id: 'one', path: projectPath,
      check: { id: 'controlled-output-check', revision: 1, executable: process.execPath,
        argv: ['-e', "if(require('node:fs').readFileSync('src/controlled-output.txt','utf8')!=='Beta\\n')process.exit(1);console.log('controlled-check-pass')"],
        deadlineMs: 1000, outputLimitBytes: 1024 } }] } })
  let closed = false
  t.after(async () => {
    try {
      if (!closed) await product.close()
      await Promise.all(trace.closers.map(close => close()))
    } finally {
      process.kill = originalKill
      store.close(); rmSync(root, { recursive: true, force: true })
    }
  })
  const api = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    mode: 'fixture', allowedOrigins: [], read: product.read, operations: product.operations })
  const post = async value => {
    const response = await api.request('http://127.0.0.1/v1/commands', { method: 'POST',
      headers: { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }, body: JSON.stringify({ conversationId: 'conv-main', ...value }) })
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body
  }
  product.start()
  const created = await post({ kind: 'create_work', commandId: 'original-native-create', projectId: 'one', profileId: profile.id,
    goal: 'Produce the selected output in the isolated workspace', scope,
    criteria: [{ id: 'machine-check', kind: 'machine', required: true, description: 'Check selected output', checkDefinitionRef: 'controlled-output-check' },
      { id: 'human-review', kind: 'human', required: true, description: 'Review the selected output and frozen patch' }] })
  assert.equal(created.status, 'recorded', JSON.stringify(created))
  const snapshot = await until(() => product.application.inspect({ workId: created.workId }), value => value.questions.length === 1, 'Original question')
  const question = snapshot.questions[0], target = question.targets[0]
  assert.equal(target.nativeMethod, 'item/tool/requestUserInput')
  assert.deepEqual(target.nativeRequestId, { kind: 'integer', decimal: '42' })
  const registration = loadRecoveryRunner(store, target.attemptId)
  assert.ok(registration)
  const channel = await connectRunnerRecovery(registration.body.endpoint, registration.body.producer).channelState()
  assert.ok(channel.generation >= 2, 'actual original registered service has transferred callbacks from bootstrap stdio')
  assert.equal(trace.nativeEffects, 0)
  assert.equal(trace.stdioFacts.includes('question.opened'), false, 'original question passed through the attached fact callback')
  const answer = { kind: 'answer_question', commandId: 'original-native-answer', questionId: question.id, expectedVersion: question.version,
    answer: { kind: 'form', values: { 'field-0': 'option-1' } } }
  if (revoked) {
    store.authority.disable(question.contract)
    const result = await post(answer)
    assert.equal(result.status, 'rejected', JSON.stringify(result))
    await product.close(); closed = true
    assert.equal(trace.nativeEffects, 0)
    assert.equal(trace.stdioGuards, 0)
    assert.equal(product.application.questions.currentDeliveries(question.id).some(value => value.status === 'native_applied'), false)
    assert.equal(store.authority.isCurrent(question.contract), false)
    return
  }
  assert.equal((await post(answer)).status, 'recorded')
  assert.equal((await post(answer)).status, 'recorded', 'original command receipt replay does not resend the native effect')
  const ready = await until(async () => ({ view: (await product.application.inspect({ workId: created.workId })).works[0],
    deliveries: product.application.questions.currentDeliveries(question.id),
    failures: store.events.after(0).filter(event => event.topic === 'application.execution.held').map(event => event.payload) }),
  value => value.view?.actions.available.includes('accept_candidate'), 'Original ready candidate')
  assert.equal(ready.deliveries[0].status, 'native_applied')
  assert.equal(ready.view.resourceStatus, 'quiescent')
  const verification = await product.read.verification(ready.view.actions.currentVerificationId)
  assert.equal(verification.results.find(result => result.criterionId === 'machine-check').outcome, 'PASS')
  assert.equal(trace.nativeEffects, 1); assert.equal(trace.stdioGuards, 0, 'original live guard ran through the attached native-write callback')
  assert.equal(trace.stdioFacts.includes('answer.observed'), false)
  assert.equal(trace.stdioFacts.includes('turn.ended'), false)
  const location = await product.read.workLocation(created.workId)
  assert.equal(readFileSync(join(location.workspacePath, 'src/controlled-output.txt'), 'utf8'), 'Beta\n')
  assert.equal(readFileSync(join(projectPath, 'src/base.txt'), 'utf8'), 'Base\n')
  assert.equal((await post({ kind: 'accept_candidate', commandId: 'original-native-accept', candidate: ready.view.actions.currentCandidate })).status, 'recorded')
  const delivered = (await product.application.inspect({ workId: created.workId })).works[0]
  assert.equal(delivered.phase, 'delivered'); assert.equal(delivered.work.id, created.workId)
  for (const id of delivered.artifactIds) assert.ok(store.artifacts.read(id).data.length > 0)
  assert.equal(store.bindings.binding(target.attemptId).state, 'ended')
  await product.close(); closed = true
  assert.deepEqual(trace.errors, [])
  const reopened = new ProductStore({ path })
  try {
    assert.equal(reopened.product.works.get(created.workId).projectId, 'one')
    for (const id of delivered.artifactIds) assert.ok(reopened.artifacts.read(id).data.length > 0)
  } finally { reopened.close() }
  console.log(JSON.stringify({ scope: 'Original Native.launch/registered in-process service/production Codex driver/Store/Application/QuestionBroker',
    workId: created.workId, attemptId: target.attemptId, callbackGeneration: channel.generation,
    stdioFacts: trace.stdioFacts, stdioPayloads: trace.stdioPayloads, stdioGuards: trace.stdioGuards, virtualNativeEffects: trace.nativeEffects,
    phase: delivered.phase, artifactCount: delivered.artifactIds.length, originalRegisteredCheckPassed: true,
    suppressedVerifierSignalCalls: suppressedSignals.length, realSignals: 0,
    realOSNativeProcesses: 0, realVendorModelNativeTurns: 0, physicalQuiescenceProven: false,
    crashRecoveryProven: false, schedulerTwoFourSlotsProven: false }))
})
