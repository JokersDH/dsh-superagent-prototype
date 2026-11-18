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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { nativeCallbackLink } from '../../integration/fixtures/native-callback-link.ts'

const WORKER = new URL('./combined-recovery-worker.mjs', import.meta.url)

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
            const trace = { virtualResources: 0, nativeEffects: 0, stdioFacts: [], stdioPayloads: 0, stdioGuards: 0, protocolMethods: [], errors: [], closers: [], inventoryUnknown: spawnIndex > 0 }
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
      const verifications = store.db.prepare('SELECT id, assignment_id, candidate_generation, results FROM completion_verifications WHERE ticket_id = ?').all(original.works[0].target.ticketId)
      const acceptances = store.db.prepare('SELECT id, assignment_id, candidate_generation, criterion_ids, actor_ref FROM completion_acceptances WHERE ticket_id = ?').all(original.works[0].target.ticketId)
      readback = {
        workId: work?.id ?? null, questionId: question?.id ?? null, validity: question?.validity ?? null,
        targetBinding: store.bindings.binding(successor.target.attemptId)?.state ?? null,
        fillerBinding: store.bindings.binding(filler.target.attemptId)?.state ?? null,
        nextQuestionId: nextQuestion?.id ?? null, nextValidity: nextQuestion?.validity ?? null,
        command: store.commands.get('combined-answer-target')?.status ?? null,
        verification: verifications[0] === undefined ? null : { id: String(verifications[0].id), results: JSON.parse(String(verifications[0].results)) },
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
      oneRunnerPerCapacityWork: handles.size === capacity && spawnIndex === capacity,
      targetReceiverBeginOnce: targetBegin === 1,
      targetReceiverAnswerOnce: targetAnswer === 1,
      fillerNoAnswer: fillerBegin === 1 && receiver.filter(row => row.kind === 'answer' && row.attemptId === original.works[1].target.attemptId).length === 0,
      targetDelivered: successor.phase === 'delivered',
      targetQuestionAnswered: readback.questionId === successor.target.questionId && readback.validity === 'answered',
      targetBindingEnded: readback.targetBinding === 'ended',
      fillerUnknownRetained: ['active','stopping'].includes(readback.fillerBinding) && ['active','stopping'].includes(successor.fillerState) && successor.held === 'held',
      machineCheckPassed: readback.verification?.results?.some(row => row.criterionId === 'machine' && row.outcome === 'PASS') === true,
      candidateAssignmentMatches: successor.target.candidate.assignmentId === successor.target.assignmentId,
      acceptanceRecorded: readback.acceptance !== null && readback.acceptance.criterionIds.includes('human'),
      exactArtifactsReadable: readback.artifacts.length === 3 && readback.artifacts.every(entry => entry.bytes > 0),
      nextWorkProgressed: readback.nextQuestionId === successor.nextQuestion && readback.nextValidity === 'open',
      noNewWork: readback.workCount === capacity + 1,
      nativeEffectOnlyTarget: totalNativeEffects === 1,
      commandRecorded: readback.command === 'recorded',
    }
    return { protocol: 'combined-recovery-capacity/1', capacity, original, successor, receiver: { targetBegin, targetAnswer, fillerBegin, rows: receiver.length }, totalNativeEffects, readback, checks, gap: successor.nextProgressed ? null : { stage: 'next_work_progress', observed: successor.nextError, note: 'target delivered and binding ended; filler held UNKNOWN; next Work question did not appear', minimalRepro: 'same-run combined consumer capacity='+capacity }, layers: { source: 'main e2261ef5 ProductRuntime/recovery/capacity', controlled: 'virtual ProcessHost per Work', native: 0, physical: 'NOT_TESTED', ackLost: 'not part of capacity run', schedulerSlots: 'original ProductExecution maxActiveAttempts only; OS resources NOT_TESTED' } }
  } finally {
    for (const close of closers) { try { await close() } catch { /* virtual */ } }
    process.env.PA_RUNNER_RECEIVER_LOG = priorLog ?? ''
    if (priorLog === undefined) delete process.env.PA_RUNNER_RECEIVER_LOG
    for (const path of recoveryRoots) rmSync(path, { recursive: true, force: true })
  }
}
