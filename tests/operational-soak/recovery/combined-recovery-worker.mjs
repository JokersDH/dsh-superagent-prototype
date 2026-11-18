/**
 * H combined recovery/capacity worker. Parent host owns all virtual native Runners; this worker only
 * opens the original Store/ProductRuntime. Primary creates `capacity` original native Works (A target
 * plus fillers) and one queued next Work, then exits without close. Successor recovers A to delivered,
 * keeps filler B UNKNOWN/stopping, and proves the queued next Work progresses only after A's own slot is
 * released. Virtual ProcessHost only; no OS process/model/signal.
 */
import assert from 'node:assert/strict'
import { parentPort, workerData } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { reconcileRegisteredRunner } from '../../../apps/coordinator/reconcile-runner.ts'

const { root, projectPath, stage, capacity, original } = workerData
let serial = 0
const pending = new Map()
const sinks = new Map()
const optionMap = new Map()
const workHandles = new Map()
const call = (method, value) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); parentPort.postMessage({ type: 'call', id, method, value }) })
parentPort.on('message', async message => {
  if (message.type === 'result') { const waiter = pending.get(message.id); pending.delete(message.id); message.error ? waiter?.reject(new Error(message.error)) : waiter?.resolve(message.value) }
  else if (message.type === 'callback') {
    try {
      const attemptId = message.value.attemptId
      const value = await (message.method === 'fact' ? sinks.get(attemptId)(message.value.fact)
        : message.method === 'payload' ? optionMap.get(attemptId).payloads.read(message.value.reference)
        : optionMap.get(attemptId).beforeNativeWrite(message.value.command))
      parentPort.postMessage({ type: 'callback-result', id: message.id, value })
    } catch (error) { parentPort.postMessage({ type: 'callback-result', id: message.id, error: String(error.message) }) }
  }
})
const until = async (read, accepts, label) => { const deadline = Date.now() + 20000; let last; while (Date.now() < deadline) { last = await read(); if (accepts(last)) return last; await new Promise(r => setTimeout(r, 20)) } throw new Error(`${label}: ${JSON.stringify(last).slice(0, 500)}`) }
const scope = { projectId: 'one', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }
const profile = { id: 'controlled-original-combined', revision: 1, driverId: 'codex-native', driverApiMajor: 1, driverRelease: '0.1.0-test', executable: process.execPath, argv: [], expectedVersion: process.version, nativeConfigRef: 'controlled-config', permissionPolicyRevision: 'controlled-policy', requiredFeatures: [] }
const store = new ProductStore({ path: join(root, 'db.sqlite') })
const principal = { userId: 'combined-recovery-user', authorityRef: 'combined-recovery-authority' }
let suppressedSignals = 0
process.kill = () => { suppressedSignals++; return true }
const product = createProductRuntime({ store, stateRoot: root, scratchProject: projectPath, principal, actionSecret: Buffer.alloc(32, 71), maxActiveAttempts: capacity,
  projects: [{ id: 'one', displayName: 'Combined recovery', scope }],
  nativeRunnerLinkFactory: options => ({ async spawnAttempt(spec, sink) { assert.equal(stage, 'primary', 'successor must not spawn'); sinks.set(spec.attemptId, sink); optionMap.set(spec.attemptId, options); const value = await call('spawn', { spec, options: { stateRoot: options.stateRoot, env: options.env, producer: options.producer, attemptId: spec.attemptId } }); const handle = { ...value, command: command => call('command', command), waitExit: () => call('waitExit', { attemptId: spec.attemptId }), close: () => call('close', { attemptId: spec.attemptId }) }; workHandles.set(spec.attemptId, handle); return handle } }),
  native: { profile, approvalPolicy: 'on-request', projects: [{ id: 'one', path: projectPath, check: { id: 'output-check', revision: 1, executable: process.execPath, argv: ['-e', "if(require('node:fs').readFileSync('src/controlled-output.txt','utf8')!=='Beta\\n')process.exit(1)"], deadlineMs: 1000, outputLimitBytes: 1024 } }] } })
const api = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64), mode: 'fixture', allowedOrigins: [], read: product.read, operations: product.operations })
const post = async value => { const response = await api.request('http://127.0.0.1/v1/commands', { method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }, body: JSON.stringify({ conversationId: 'combined', ...value }) }); const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result }
try {
  product.start()
  if (stage === 'primary') {
    const works = []
    for (let index = 0; index < capacity; index++) {
      const created = await post({ kind: 'create_work', commandId: `combined-create-${index}`, projectId: 'one', profileId: profile.id, goal: `Combined Work ${index}`, scope, criteria: [{ id: 'machine', kind: 'machine', required: true, description: 'Selected output', checkDefinitionRef: 'output-check' }, { id: 'human', kind: 'human', required: true, description: 'Review patch' }] })
      const waiting = await until(() => product.application.inspect({ workId: created.workId }), value => value.questions.length === 1, `question ${index}`)
      works.push({ workId: created.workId, question: waiting.questions[0], target: waiting.questions[0].targets[0] })
    }
    const next = await post({ kind: 'create_work', commandId: `combined-create-${capacity}`, projectId: 'one', profileId: profile.id, goal: `Combined queued Work ${capacity}`, scope, criteria: [{ id: 'machine', kind: 'machine', required: true, description: 'Selected output', checkDefinitionRef: 'output-check' }] })
    parentPort.postMessage({ type: 'primary-ready', value: { works, nextWorkId: next.workId, capacity } })
    process.exit(0)
  }
  const { works, nextWorkId } = original
  const target = works[0]
  const filler = works[1]
  await until(async () => ({ view: await product.application.inspect({ workId: target.workId }), fence: product.execution.nativeFence(target.target) }), value => value.fence === 'current' && value.view.questions.some(q => q.id === target.question.id), 'target question reattached')
  // Keep filler B as UNKNOWN/stopping; its own proof is absent and must not be borrowed.
  let held = { status: 'not_attempted' }
  try { held = await reconcileRegisteredRunner(store, filler.target.attemptId) } catch (error) { held = { status: 'refused', reason: String(error.message) } }
  const fillerStateAfterStop = store.bindings.binding(filler.target.attemptId)?.state ?? null
  const answered = await post({ kind: 'answer_question', commandId: 'combined-answer-target', questionId: target.question.id, expectedVersion: target.question.version, answer: { kind: 'form', values: { 'field-0': 'option-1' } } })
  assert.equal(answered.status, 'recorded')
  const ready = await until(() => product.application.inspect({ workId: target.workId }), value => value.works[0]?.actions?.available?.includes('accept_candidate') === true, 'target candidate')
  const view = ready.works[0]
  assert.equal(product.application.questions.currentDeliveries(target.question.id)[0].status, 'native_applied')
  const verification = await product.read.verification(view.actions.currentVerificationId)
  assert.equal(verification.results.find(row => row.criterionId === 'machine').outcome, 'PASS')
  assert.equal(view.actions.currentCandidate.assignmentId, target.target.assignmentId)
  const accepted = await post({ kind: 'accept_candidate', commandId: 'combined-accept-target', candidate: view.actions.currentCandidate })
  assert.equal(accepted.status, 'recorded')
  const delivered = (await product.application.inspect({ workId: target.workId })).works[0]
  assert.equal(delivered.phase, 'delivered')
  assert.equal(delivered.work.id, target.workId)
  for (const id of view.artifactIds) assert.ok(store.artifacts.read(id).data.length > 0)
  assert.equal(store.bindings.binding(target.target.attemptId).state, 'ended')
  // Filler UNKNOWN remains; the delivered target's own Runner is closed and its own resource barrier is reconciled.
  try { await workHandles.get(target.target.attemptId)?.close(); await workHandles.get(target.target.attemptId)?.waitExit() } catch { /* virtual runner close retained */ }
  try { await reconcileRegisteredRunner(store, target.target.attemptId) } catch { /* target binding is already ended */ }
  await product.execution.effects.idle('application.execute')
  product.execution.effects.kick()
  let progressed = null
  let nextError = null
  try { progressed = await until(() => product.application.inspect({ workId: nextWorkId }), value => value.questions.length === 1, 'next queued Work progressed') } catch (error) { nextError = String(error.message) }
  const nextProgressed = progressed !== null
  assert.ok(['active','stopping'].includes(fillerStateAfterStop), String(fillerStateAfterStop))
  const targetBindingAfter = store.bindings.binding(target.target.attemptId)?.state
  const fillerBindingAfter = store.bindings.binding(filler.target.attemptId)?.state
  await product.close(); store.close()
  parentPort.postMessage({ type: 'done', value: { target: { workId: target.workId, attemptId: target.target.attemptId, questionId: target.question.id, assignmentId: target.target.assignmentId, candidate: view.actions.currentCandidate }, phase: delivered.phase, artifacts: view.artifactIds, verification: { id: view.actions.currentVerificationId, results: verification.results }, acceptance: accepted.status, fillerState: fillerStateAfterStop, held: held.status, suppressedSignals, nextWorkId, nextQuestion: progressed?.questions?.[0]?.id ?? null, nextProgressed, nextError, targetBindingAfter, fillerBindingAfter } })
  process.exit(0)
} catch (error) { parentPort.postMessage({ type: 'error', error: String(error.stack ?? error) }); process.exit(1) }
