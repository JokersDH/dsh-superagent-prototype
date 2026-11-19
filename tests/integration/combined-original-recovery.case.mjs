/**
 * H combined same-run recovery + original capacity consumer.
 *
 * For capacity 2 and 4: primary creates capacity original native Works plus one queued Work, then its
 * worker exits without product.close. Parent keeps every virtual Runner alive. Successor reuses the
 * same Store, resumes Work A to delivered/check/accept/artifacts while filler B is stopped and held
 * UNKNOWN; only A's own ended binding lets the queued next Work progress. All resources are virtual.
 */
import { Worker } from 'node:worker_threads'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { loadRecoveryRunner } from '../../apps/coordinator/runner-registry.ts'
import { nativeCallbackLink } from './fixtures/native-callback-link.ts'

const WORKER = new URL('./fixtures/combined-recovery-worker.mjs', import.meta.url)

export async function runCombined(capacity, root) {
  const projectPath = join(root, 'project'), stateRoot = join(root, 'state')
  mkdirSync(join(projectPath, 'src'), { recursive: true }); mkdirSync(stateRoot, { mode: 0o700 })
  writeFileSync(join(projectPath, 'src/base.txt'), 'Base\n')
  const git = args => execFileSync('git', args, { cwd: projectPath, stdio: 'pipe' })
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=H Combined', '-c', 'user.email=h@localhost', 'commit', '-qm', 'base'])
  const receiverLog = join(root, 'receiver.jsonl')
  const priorLog = process.env.PA_RUNNER_RECEIVER_LOG
  process.env.PA_RUNNER_RECEIVER_LOG = receiverLog
  const traces = new Map(), handles = new Map(), closers = [], recoveryRoots = []
  let serial = 0, spawnIndex = 0
  const run = (stage, originalValue) => new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, { workerData: { root: stateRoot, projectPath, stage, capacity, original: originalValue } })
    const callbacks = new Map(); let result, error
    const callback = (method, value, attemptId) => new Promise((res, rej) => { const id = ++serial; callbacks.set(id, { resolve: res, reject: rej }); worker.postMessage({ type: 'callback', id, method, value: { ...value, attemptId } }) })
    worker.on('message', async message => {
      if (message.type === 'callback-result') { const waiter = callbacks.get(message.id); callbacks.delete(message.id); message.error ? waiter?.reject(new Error(message.error)) : waiter?.resolve(message.value) }
      else if (message.type === 'primary-ready' || message.type === 'done') result = message.value
      else if (message.type === 'error') error = new Error(message.error)
      else if (message.type === 'call') {
        try {
          let value
          if (message.method === 'spawn') {
            const { spec, options } = message.value
            const attemptId = spec.attemptId
            const trace = { virtualResources: 0, nativeEffects: 0, stdioFacts: [], stdioPayloads: 0, stdioGuards: 0, protocolMethods: [], errors: [], closers: [], inventoryUnknown: spawnIndex > 0 && spawnIndex < capacity }
            traces.set(attemptId, trace); spawnIndex += 1
            recoveryRoots.push(options.env.PA_RUNNER_RECOVERY_ROOT)
            const handle = await nativeCallbackLink(trace)({ ...options,
              payloads: { read: reference => callback('payload', { reference }, attemptId) },
              beforeNativeWrite: command => callback('guard', { command }, attemptId),
            }).spawnAttempt(spec, fact => callback('fact', { fact }, attemptId))
            handles.set(attemptId, handle); closers.push(() => handle.close())
            value = { pid: handle.pid, stateRoot: handle.stateRoot, journalPath: handle.journalPath, receipts: [], progress: [] }
          } else if (message.method === 'command') {
            const handle = handles.get(message.value.attemptId); if (handle === undefined) throw new Error(`no handle for ${message.value.attemptId}`); value = await handle.command(message.value)
          } else if (message.method === 'waitExit') {
            const handle = handles.get(message.value?.attemptId); if (handle === undefined) throw new Error(`no handle for waitExit ${message.value?.attemptId}`); value = await handle.waitExit()
          } else if (message.method === 'close') {
            const handle = handles.get(message.value?.attemptId); value = handle === undefined ? 0 : await handle.close()
          }
          worker.postMessage({ type: 'result', id: message.id, value })
        } catch (caught) { worker.postMessage({ type: 'result', id: message.id, error: String(caught.message) }) }
      }
    })
    worker.once('error', reject)
    worker.once('exit', code => { for (const waiter of callbacks.values()) waiter.reject(new Error('coordinator exit')); if (code !== 0 || error || !result) reject(error ?? new Error(`worker exit ${code}`)); else resolve(result) })
  })
  try {
    const original = await run('primary')
    const successor = await run('successor', original)
    const store = new ProductStore({ path: join(stateRoot, 'db.sqlite') })
    let readback
    try {
      const work = store.product.works.get(successor.target.workId)
      const question = store.product.questions.get(successor.target.questionId)
      const filler = original.works[1]
      const nextQuestion = store.product.questions.get(successor.nextQuestion)
      const targetCandidate = successor.target.candidate
      const verifications = store.db.prepare('SELECT id, assignment_id, candidate_generation, results FROM completion_verifications WHERE ticket_id = ? AND assignment_id = ? AND candidate_generation = ?').all(original.works[0].target.ticketId, targetCandidate.assignmentId, targetCandidate.candidateGeneration)
      const acceptances = store.db.prepare('SELECT id, assignment_id, candidate_generation, criterion_ids, actor_ref FROM completion_acceptances WHERE ticket_id = ? AND assignment_id = ? AND candidate_generation = ?').all(original.works[0].target.ticketId, targetCandidate.assignmentId, targetCandidate.candidateGeneration)
      readback = {
        workId: work?.id ?? null, questionId: question?.id ?? null, validity: question?.validity ?? null,
        targetBinding: store.bindings.binding(successor.target.attemptId)?.state ?? null,
        fillerBinding: store.bindings.binding(filler.target.attemptId)?.state ?? null,
        nextQuestionId: nextQuestion?.id ?? null, nextValidity: nextQuestion?.validity ?? null,
        nextQuestionWorkId: nextQuestion?.contract.workId ?? null,
        command: store.commands.get('combined-answer-target')?.status ?? null,
        verification: verifications[0] === undefined ? null : { id: String(verifications[0].id), results: JSON.parse(String(verifications[0].results)) },
        exactVerificationCount: verifications.length, exactAcceptanceCount: acceptances.length,
        acceptance: acceptances[0] === undefined ? null : { criterionIds: JSON.parse(String(acceptances[0].criterion_ids)), actorRef: String(acceptances[0].actor_ref) },
        artifacts: successor.artifacts.map(id => ({ id, bytes: store.artifacts.read(id)?.data?.length ?? 0 })),
        workCount: store.product.works.listByProject('one', { limit: 20 }).length,
      }
    } finally { store.close() }
    const receiver = readFileSync(receiverLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    const targetBegin = receiver.filter(row => row.kind === 'begin' && row.attemptId === successor.target.attemptId).length
    const targetAnswer = receiver.filter(row => row.kind === 'answer' && row.attemptId === successor.target.attemptId).length
    const fillerBegin = receiver.filter(row => row.kind === 'begin' && row.attemptId === original.works[1].target.attemptId).length
    const totalNativeEffects = [...traces.values()].reduce((sum, trace) => sum + trace.nativeEffects, 0)
    const checks = {
      oneRunnerPerOriginalWork: handles.size === capacity + 1 && spawnIndex === capacity + 1,
      targetReceiverBeginOnce: targetBegin === 1,
      targetReceiverAnswerOnce: targetAnswer === 1,
      fillerNoAnswer: fillerBegin === 1 && receiver.filter(row => row.kind === 'answer' && row.attemptId === original.works[1].target.attemptId).length === 0,
      targetDelivered: successor.phase === 'delivered',
      targetStoreIdentity: readback.workId === original.works[0].workId && successor.target.candidate.contract.workId === readback.workId,
      targetQuestionAnswered: readback.questionId === successor.target.questionId && readback.validity === 'answered',
      targetBindingEnded: readback.targetBinding === 'ended',
      fillerUnknownRetained: ['active','stopping'].includes(readback.fillerBinding) && ['active','stopping'].includes(successor.fillerState) && successor.held === 'held',
      machineCheckPassed: readback.verification?.results?.some(row => row.criterionId === 'machine' && row.outcome === 'PASS') === true,
      candidateAssignmentMatches: successor.target.candidate.assignmentId === successor.target.assignmentId,
      exactCurrentCandidateEvidence: readback.exactVerificationCount === 1 && readback.exactAcceptanceCount === 1 && readback.verification?.id === successor.verification.id,
      acceptanceRecorded: readback.acceptance !== null && readback.acceptance.criterionIds.includes('human'),
      exactArtifactsReadable: readback.artifacts.length === 3 && readback.artifacts.every(entry => entry.bytes > 0),
      nextWorkProgressed: readback.nextQuestionId === successor.nextQuestion && readback.nextValidity === 'open' && readback.nextQuestionWorkId === original.nextWorkId,
      noNewWork: readback.workCount === capacity + 1,
      nativeEffectOnlyTarget: totalNativeEffects === 1,
      commandRecorded: readback.command === 'recorded',
    }
    return { protocol: 'combined-recovery-capacity/1', capacity, original, successor, receiver: { targetBegin, targetAnswer, fillerBegin, rows: receiver.length }, totalNativeEffects, readback, checks, gap: successor.nextProgressed ? null : { stage: 'next_work_progress', observed: successor.nextError, note: 'target delivered and binding ended; filler held UNKNOWN; next Work question did not appear', minimalRepro: 'same-run combined consumer capacity='+capacity }, layers: { source: 'main e2261ef5 ProductRuntime/recovery/capacity', controlled: 'virtual ProcessHost per Work', native: 0, physical: 'NOT_TESTED', ackLost: 'not part of capacity run', schedulerSlots: 'original ProductExecution maxActiveAttempts only; OS resources NOT_TESTED' } }
  } finally {
    const inspectStore = new ProductStore({ path: join(stateRoot, 'db.sqlite') })
    const unknownCredentials = []
    try {
      for (const ticket of inspectStore.domain.tickets.list()) {
        const binding = inspectStore.bindings.current(ticket.id)
        if (binding && binding.state !== 'ended') {
          const registration = loadRecoveryRunner(inspectStore, binding.attemptId)
          if (registration) unknownCredentials.push(registration.body.endpoint.credentialPath)
        }
      }
    } finally { inspectStore.close() }
    for (const close of closers) { try { await close() } catch { /* virtual */ } }
    process.env.PA_RUNNER_RECEIVER_LOG = priorLog ?? ''
    if (priorLog === undefined) delete process.env.PA_RUNNER_RECEIVER_LOG
    for (const credential of unknownCredentials) assert.ok(existsSync(credential), 'Original UNKNOWN credential must survive transport cleanup')
    console.log(`Retained combined original state: ${root}`)
  }
}

import assert from 'node:assert/strict'
import { test } from 'node:test'
for (const capacity of [2, 4]) test(`combined original owner-exit delivery and capacity ${capacity}`, { timeout: 45000 }, async () => {
  const root = mkdtempSync('/tmp/pa-combined-original-')
  const result = await runCombined(capacity, root)
  for (const [name, passed] of Object.entries(result.checks)) assert.equal(passed, true, name)
  assert.equal(result.gap, null)
  assert.equal(result.successor.nextWorkId, result.original.nextWorkId)
  assert.equal(result.readback.workCount, capacity + 1)
  console.log(JSON.stringify({ capacity, sameOriginalTarget: result.successor.target.workId,
    phase: result.successor.phase, targetBegin: result.receiver.targetBegin, targetAnswer: result.receiver.targetAnswer,
    fillerHeld: result.successor.held, nextWorkProgressed: result.successor.nextProgressed,
    virtualResourceScope: true, physicalProof: false, retainedUnknownRoot: root }))
})
