import assert from 'node:assert/strict'
import { parentPort, workerData } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { key } from '../../../packages/orchestrator-core/dist/index.js'

const { root, projectPath, stage, mode } = workerData
let serial = 0, originalSink, originalOptions
const pending = new Map()
const call = (method, value) => new Promise((resolve, reject) => {
  const id = ++serial; pending.set(id, { resolve, reject }); parentPort.postMessage({ type: 'call', id, method, value })
})
parentPort.on('message', async message => {
  if (message.type === 'exit-owner') process.exit(0)
  if (message.type === 'result') {
    const waiter = pending.get(message.id); pending.delete(message.id)
    message.error ? waiter?.reject(new Error(message.error)) : waiter?.resolve(message.value)
  } else if (message.type === 'callback') {
    try {
      const value = await (message.method === 'fact' ? originalSink(message.value)
        : message.method === 'payload' ? originalOptions.payloads.read(message.value)
        : originalOptions.beforeNativeWrite(message.value))
      parentPort.postMessage({ type: 'callback-result', id: message.id, value })
    } catch (error) { parentPort.postMessage({ type: 'callback-result', id: message.id, error: String(error.message) }) }
  }
})
const until = async (read, accepts, label) => {
  const deadline = Date.now() + 12000
  let last
  while (Date.now() < deadline) {
    last = await read(); if (accepts(last)) return last
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`)
}
const profile = { id: 'controlled-original-recovery', revision: stage === 'successor' && mode === 'profile-changed' ? 2 : 1,
  driverId: 'codex-native', driverApiMajor: 1, driverRelease: '0.1.0-test', executable: process.execPath, argv: [],
  expectedVersion: process.version, nativeConfigRef: 'controlled-config', permissionPolicyRevision: 'controlled-policy', requiredFeatures: [] }
const scope = { projectId: 'one', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }
const store = new ProductStore({ path: join(root, 'db.sqlite') })
if (stage === 'successor' && mode === 'terminal-proof-missing') {
  const get = store.facts.get.bind(store.facts)
  store.facts.get = id => store.observations.get(id)?.kind === 'turn.ended' ? undefined : get(id)
}
const principal = { userId: 'recovery-user', authorityRef: 'recovery-authority' }
let suppressedSignals = 0
process.kill = () => { suppressedSignals++; return true }
const product = createProductRuntime({ store, stateRoot: root, scratchProject: projectPath, principal,
  actionSecret: Buffer.alloc(32, 51), projects: [{ id: 'one', displayName: 'Original recovery', scope }],
  nativeRunnerLinkFactory: options => ({ async spawnAttempt(spec, sink) {
    assert.equal(stage, 'primary', 'a successor must never spawn another Runner')
    originalOptions = options; originalSink = sink
    const value = await call('spawn', { spec, options: { stateRoot: options.stateRoot, env: options.env, producer: options.producer } })
    return { ...value, command: command => call('command', command), waitExit: () => call('waitExit'), close: () => call('close') }
  } }),
  native: { profile, approvalPolicy: stage === 'successor' && mode === 'policy-changed' ? 'never' : 'on-request', projects: [{ id: 'one', path: projectPath,
    check: { id: 'output-check', revision: 1, executable: process.execPath,
      argv: ['-e', "if(require('node:fs').readFileSync('src/controlled-output.txt','utf8')!=='Beta\\n')process.exit(1)"],
      deadlineMs: 1000, outputLimitBytes: 1024 } }] } })
const api = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
  mode: 'fixture', allowedOrigins: [], read: product.read, operations: product.operations })
const post = async value => {
  const response = await api.request('http://127.0.0.1/v1/commands', { method: 'POST',
    headers: { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: 'original', ...value }) })
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result
}
try {
  product.start()
  if (stage === 'primary') {
    const created = await post({ kind: 'create_work', commandId: 'recovery-create', projectId: 'one', profileId: profile.id,
      goal: 'Continue this same Work after its coordinator disappears', scope,
      criteria: [{ id: 'machine', kind: 'machine', required: true, description: 'Selected output', checkDefinitionRef: 'output-check' },
        { id: 'human', kind: 'human', required: true, description: 'Review frozen patch' }] })
    assert.equal(created.status, 'recorded')
    const waiting = await until(() => product.application.inspect({ workId: created.workId }), value => value.questions.length === 1, 'original question')
    const question = waiting.questions[0], target = question.targets[0]
    assert.equal(store.bindings.binding(target.attemptId).state, 'active')
    parentPort.postMessage({ type: 'primary-ready', value: { workId: created.workId, question, target } })
    if (['terminal-acked', 'terminal-proof-missing', 'answer-written-reply-lost'].includes(mode)) {
      assert.equal((await post({ kind: 'answer_question', commandId: 'recovery-answer', questionId: question.id,
        expectedVersion: question.version, answer: { kind: 'form', values: { 'field-0': 'option-1' } } })).status, 'recorded')
      // The parent interrupts at the chosen original effect/terminal boundary, without calling close.
      await new Promise(() => {})
    }
    // Deliberately bypass product.close: only this isolated coordinator thread exits. The parent-owned
    // original virtual Runner stays alive; no process signal or graceful resource cancellation occurs.
    process.exit(0)
  }
  const { workId, question, target } = workerData.original
  if (!['resume', 'terminal-acked', 'answer-written-reply-lost'].includes(mode)) {
    await until(() => store.bindings.binding(target.attemptId), value => value.state !== 'active', 'recovery refused')
    if (mode === 'terminal-proof-missing') {
      const view = (await product.application.inspect({ workId })).works[0]
      assert.equal(view.actions.available.includes('accept_candidate'), false)
      assert.notEqual(view.phase, 'delivered')
      await product.close(); store.close()
      parentPort.postMessage({ type: 'done', value: { mode, rejected: true, terminalProofRejected: true, suppressedSignals } })
      process.exit(0)
    }
    const rejected = await post({ kind: 'answer_question', commandId: 'recovery-answer', questionId: question.id,
      expectedVersion: question.version, answer: { kind: 'form', values: { 'field-0': 'option-1' } } })
    assert.equal(rejected.status, 'rejected')
    await product.close(); store.close()
    parentPort.postMessage({ type: 'done', value: { mode, rejected: true, suppressedSignals } })
    process.exit(0)
  }
  if (mode !== 'terminal-acked') await until(async () => {
    const failure = store.commands.get(key('product-runtime-failure', target.attemptId))
    if (failure) throw new Error(`Original recovery held: ${JSON.stringify(failure.result)}`)
    return { view: await product.application.inspect({ workId }), fence: product.execution.nativeFence(target) }
  },
    value => value.fence === 'current' && (mode === 'answer-written-reply-lost' || value.view.questions.some(q => q.id === question.id)), 'same question reattached')
  const answered = await post({ kind: 'answer_question', commandId: 'recovery-answer', questionId: question.id,
    expectedVersion: question.version, answer: { kind: 'form', values: { 'field-0': 'option-1' } } })
  assert.equal(answered.status, 'recorded')
  if (mode === 'answer-written-reply-lost') await call('release-resolution')
  const ready = await until(() => product.application.inspect({ workId }),
    value => value.works[0]?.actions.available.includes('accept_candidate'), 'recovered original candidate')
  assert.equal(product.application.questions.currentDeliveries(question.id)[0].status, 'native_applied')
  const view = ready.works[0], verify = await product.read.verification(view.actions.currentVerificationId)
  assert.equal(verify.results.find(row => row.criterionId === 'machine').outcome, 'PASS')
  assert.equal(view.actions.currentCandidate.assignmentId, target.assignmentId)
  const location = await product.read.workLocation(workId)
  assert.equal(readFileSync(join(location.workspacePath, 'src/controlled-output.txt'), 'utf8'), 'Beta\n')
  assert.equal((await post({ kind: 'accept_candidate', commandId: 'recovery-accept', candidate: view.actions.currentCandidate })).status, 'recorded')
  const delivered = (await product.application.inspect({ workId })).works[0]
  assert.equal(delivered.phase, 'delivered'); assert.equal(delivered.work.id, workId)
  for (const id of delivered.artifactIds) assert.ok(store.artifacts.read(id).data.length > 0)
  assert.equal(store.bindings.binding(target.attemptId).state, 'ended')
  await product.close(); store.close()
  const reopened = new ProductStore({ path: join(root, 'db.sqlite') })
  for (const id of delivered.artifactIds) assert.ok(reopened.artifacts.read(id).data.length > 0)
  reopened.close()
  parentPort.postMessage({ type: 'done', value: { workId, attemptId: target.attemptId, phase: delivered.phase,
    artifacts: delivered.artifactIds.length, originalQuestionId: question.id, suppressedSignals } })
  process.exit(0)
} catch (error) {
  parentPort.postMessage({ type: 'error', error: String(error.stack ?? error) })
  // Test-owned parent host remains responsible for its own virtual service cleanup.
  process.exit(1)
}
