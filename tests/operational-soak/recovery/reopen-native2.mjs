/**
 * Recovery milestone H: graceful-close counterexample, not crash recovery.
 *
 * Calling product.close() really ends the binding, so the reopened ended Work must not revive the old
 * question. This is retained to prevent treating graceful close as owner-exit takeover.
 *
 * Uses the actual main ProductRuntime/Application/QuestionBroker/Store and the main Node-only virtual
 * native link. A native Work opens its original question, then the first coordinator closes before the
 * answer. A second ProductRuntime over the SAME Store is started and asked to answer the SAME question.
 * The virtual ProcessHost is not an OS process; no model/vendor/native/effect or signal is real.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { loadRecoveryRunner } from '../../../apps/coordinator/runner-registry.ts'
import { nativeCallbackLink } from '../../integration/fixtures/native-callback-link.ts'

const PRINCIPAL = { userId: 'h-recovery-user', authorityRef: 'h-recovery-authority' }
const ACTOR = { ...PRINCIPAL, source: 'local_ui' }
const PROFILE = { id: 'profile-controlled-native-protocol', revision: 1, driverId: 'codex-native', driverApiMajor: 1, driverRelease: '0.1.0-test',
  executable: process.execPath, argv: [], expectedVersion: process.version, nativeConfigRef: 'controlled-config', permissionPolicyRevision: 'controlled-policy', requiredFeatures: [] }
const SCOPE = { projectId: 'one', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }

async function until(read, predicate, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await read(); if (predicate(last)) return last
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`reopen-native condition timeout: ${JSON.stringify(last).slice(0, 400)}`)
}

function setup(root) {
  const projectPath = join(root, 'project'), stateRoot = join(root, 'state')
  mkdirSync(join(projectPath, 'src'), { recursive: true }); mkdirSync(stateRoot, { mode: 0o700 })
  writeFileSync(join(projectPath, 'src/base.txt'), 'Base\n')
  const git = args => execFileSync('git', args, { cwd: projectPath, stdio: 'pipe' })
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=H Recovery', '-c', 'user.email=h@localhost', 'commit', '-qm', 'base'])
  return { projectPath, stateRoot, path: join(stateRoot, 'db.sqlite') }
}

function runtime(store, root, trace) {
  return createProductRuntime({ store, stateRoot: root.stateRoot, scratchProject: root.projectPath, principal: PRINCIPAL, actionSecret: Buffer.alloc(32, 31),
    projects: [{ id: 'one', displayName: 'Recovery', scope: SCOPE }], nativeRunnerLinkFactory: nativeCallbackLink(trace),
    native: { profile: PROFILE, approvalPolicy: 'on-request', projects: [{ id: 'one', path: root.projectPath,
      check: { id: 'controlled-output-check', revision: 1, executable: process.execPath,
        argv: ['-e', "if(require('node:fs').readFileSync('src/controlled-output.txt','utf8')!=='Beta\\n')process.exit(1)"], deadlineMs: 1000, outputLimitBytes: 1024 } }] } })
}

export async function runReopenNative({ outRoot }) {
  mkdirSync(outRoot, { recursive: true, mode: 0o700 })
  const root = setup(outRoot)
  const trace1 = { virtualResources: 0, nativeEffects: 0, stdioFacts: [], stdioPayloads: 0, stdioGuards: 0, protocolMethods: [], errors: [], closers: [] }
  const trace2 = { virtualResources: 0, nativeEffects: 0, stdioFacts: [], stdioPayloads: 0, stdioGuards: 0, protocolMethods: [], errors: [], closers: [] }
  const originalKill = process.kill
  process.kill = () => true
  let store = new ProductStore({ path: root.path })
  let product = runtime(store, root, trace1)
  let closed = false
  const out = { protocol: 'same-work-reopen-failure/1', root, original: null, reopen: null, observations: {}, checks: {}, limits: ['virtual ProcessHost, not OS process', 'no vendor/model/native effect', 'no signal'] }
  try {
    product.start()
    const created = await product.application.dispatch({ commandId: 'h-recovery-create', conversationId: 'conv', kind: 'create_work', projectId: 'one',
      profileId: PROFILE.id, goal: 'Produce the selected output and survive a coordinator restart', scope: SCOPE,
      criteria: [{ id: 'machine-check', kind: 'machine', required: true, description: 'Check selected output', checkDefinitionRef: 'controlled-output-check' },
        { id: 'human-review', kind: 'human', required: true, description: 'Review selected output' }] }, ACTOR)
    if (created.status !== 'recorded') throw new Error(`create failed: ${JSON.stringify(created)}`)
    const waiting = await until(() => product.application.inspect({ workId: created.workId }), value => value.questions.length === 1, 12000)
    const question = waiting.questions[0]
    const bindingBefore = store.bindings.binding(question.targets[0].attemptId)
    out.original = { workId: created.workId, questionId: question.id, version: question.version, attemptId: question.targets[0].attemptId,
      contract: question.contract, target: question.targets[0], bindingBefore, deliveryBefore: product.application.questions.currentDeliveries(question.id).map(d => d.status) }
    // Coordinator stops before the answer: same Store, no answer command has been sent.
    await product.close(); closed = true
    out.observations.afterClose = { binding: store.bindings.binding(question.targets[0].attemptId) }
    store.close(); store = null
    // New coordinator over the SAME Store.
    store = new ProductStore({ path: root.path })
    const registration = loadRecoveryRunner(store, question.targets[0].attemptId)
    out.observations.registrationAfterClose = registration === null ? null : { present: true, bodyKeys: Object.keys(registration.body) }
    product = runtime(store, root, trace2)
    product.start()
    const afterStart = await product.application.inspect({ workId: created.workId }, ACTOR)
    out.reopen = { phase: afterStart.works[0]?.phase, available: afterStart.works[0]?.actions?.available ?? [], questions: afterStart.questions.map(q => ({ id: q.id, version: q.version, validity: q.validity })) }
    out.observations.bindingAfterStart = store.bindings.binding(question.targets[0].attemptId)
    // Attempt to answer the EXACT original question; never re-begin.
    const answerCommand = { commandId: 'h-recovery-answer', conversationId: 'conv', kind: 'answer_question', questionId: question.id,
      expectedVersion: question.version, answer: { kind: 'form', values: { 'field-0': 'option-1' } } }
    let answerResult
    try { answerResult = await product.application.dispatch(answerCommand, ACTOR) } catch (error) { answerResult = { thrown: error?.constructor?.name ?? 'Error', message: String(error?.message ?? error), code: error?.code, reason: error?.reason } }
    out.reopen.answer = answerResult
    out.observations.deliveriesAfterAnswer = product.application.questions.currentDeliveries(question.id)
    out.observations.bindingAfterAnswer = store.bindings.binding(question.targets[0].attemptId)
    out.observations.virtualTrace = { first: { nativeEffects: trace1.nativeEffects, resources: trace1.virtualResources, errors: trace1.errors }, second: { nativeEffects: trace2.nativeEffects, resources: trace2.virtualResources, errors: trace2.errors } }
    out.observations.storeReceipt = store.commands.get('h-recovery-answer')
    // Forward path for the day main provides recovery: the same Work must reach the original
    // check/candidate/available and be accepted explicitly, without a new Work or begin.
    if (answerResult?.status === 'recorded') {
      out.reopen.recoveryPath = { attempted: true, startedAt: new Date().toISOString() }
      try {
        const ready = await until(() => product.application.inspect({ workId: created.workId }), value => value.works[0]?.actions?.available?.includes('accept_candidate') === true, 20000)
        const view = ready.works[0]
        out.reopen.recoveryPath.candidateSeen = view.actions.currentCandidate !== undefined
        out.reopen.recoveryPath.gateObserved = view.actions.available.includes('accept_candidate')
        const accepted = await product.application.dispatch({ commandId: 'h-recovery-accept', conversationId: 'conv', kind: 'accept_candidate', candidate: view.actions.currentCandidate }, ACTOR)
        out.reopen.recoveryPath.accepted = accepted.status
        const delivered = await until(() => product.application.inspect({ workId: created.workId }), value => value.works[0]?.phase === 'delivered', 20000)
        out.reopen.recoveryPath.delivered = delivered.works[0]?.phase
        out.reopen.recoveryPath.artifacts = delivered.works[0]?.artifactIds?.length ?? 0
        out.reopen.recoveryPath.workId = delivered.works[0]?.work?.id
      } catch (error) { out.reopen.recoveryPath.error = String(error?.message ?? error) }
    } else out.reopen.recoveryPath = { attempted: false, reason: `answer_${answerResult?.status ?? 'unknown'}` }
    out.checks = {
      originalQuestionOpened: out.original.questionId.length > 0,
      originalAnswerNativeAppliedAfterRestart: out.observations.deliveriesAfterAnswer.some(d => d.status === 'native_applied'),
      originalQuestionStillOpen: out.reopen.questions.some(q => q.id === question.id && q.validity === 'open'),
      bindingNotStopping: out.observations.bindingAfterAnswer?.state !== 'stopping',
      bindingEndedOrActive: ['active', 'ended'].includes(out.observations.bindingAfterAnswer?.state),
      noNewBeginCommand: !store.events.after(0).some(e => e.topic === 'command' && String(e.entityRef).includes('begin')),
      sameAttempt: out.observations.bindingAfterAnswer?.attemptId === out.original.attemptId,
      noVirtualNativeEffectAfterRestart: trace2.nativeEffects === 0,
      noSyntheticNewWork: store.product.works.listByProject('one', { limit: 10 }).length === 1,
      recoveredAcceptDelivered: out.reopen.recoveryPath?.delivered === 'delivered' && out.reopen.recoveryPath?.artifacts > 0,
    }
    return out
  } finally {
    try { if (!closed) await product?.close() } catch { /* retain */ }
    try { await Promise.all(trace1.closers.map(close => close())) } catch { /* virtual */ }
    try { await Promise.all(trace2.closers.map(close => close())) } catch { /* virtual */ }
    process.kill = originalKill
    try { store?.close() } catch { /* retain */ }
  }
}
