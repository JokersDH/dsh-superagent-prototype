/**
 * Recovery milestone H: independent consumer of main's owner-exit original Work takeover.
 *
 * H owns the parent host for the single virtual Runner, runs the main recovery worker (coordinator
 * process.exit without close), then reopens the SAME Store and independently reads the original Work,
 * question, command receipt, verification, acceptance and artifacts. No main test assertion is trusted
 * as our result. The ProcessHost is virtual; no OS process/model/vendor/signal is used.
 */
import { Worker } from 'node:worker_threads'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { nativeCallbackLink } from '../../integration/fixtures/native-callback-link.ts'

const WORKER = new URL('../../../tests/integration/fixtures/original-recovery-worker.mjs', import.meta.url)

export async function runMainRecovery({ root }) {
  mkdirSync(join(root, 'project', 'src'), { recursive: true }); mkdirSync(join(root, 'state'), { mode: 0o700 })
  writeFileSync(join(root, 'project', 'src/base.txt'), 'Base\n')
  const git = args => execFileSync('git', args, { cwd: join(root, 'project'), stdio: 'pipe' })
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=H Recovery', '-c', 'user.email=h@localhost', 'commit', '-qm', 'base'])
  const trace = { virtualResources: 0, nativeEffects: 0, stdioFacts: [], stdioPayloads: 0, stdioGuards: 0, protocolMethods: [], errors: [], closers: [] }
  const recoveryRoots = []
  let handle, serial = 0
  const run = (stage, original) => new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, { workerData: { root: join(root, 'state'), projectPath: join(root, 'project'), stage, mode: 'resume', original } })
    const callbacks = new Map(); let result, error
    const callback = (method, value) => new Promise((res, rej) => { const id = ++serial; callbacks.set(id, { resolve: res, reject: rej }); worker.postMessage({ type: 'callback', id, method, value }) })
    worker.on('message', async message => {
      if (message.type === 'callback-result') { const waiter = callbacks.get(message.id); callbacks.delete(message.id); message.error ? waiter?.reject(new Error(message.error)) : waiter?.resolve(message.value) }
      else if (message.type === 'primary-ready' || message.type === 'done') result = message.value
      else if (message.type === 'error') error = new Error(message.error)
      else if (message.type === 'call') {
        try {
          let value
          if (message.method === 'spawn') {
            if (trace.virtualResources !== 0) throw new Error('H consumer expected exactly one original Runner')
            const { options, spec } = message.value; recoveryRoots.push(options.env.PA_RUNNER_RECOVERY_ROOT)
            handle = await nativeCallbackLink(trace)({ ...options, payloads: { read: reference => callback('payload', reference) }, beforeNativeWrite: command => callback('guard', command) }).spawnAttempt(spec, fact => callback('fact', fact))
            value = { pid: handle.pid, stateRoot: handle.stateRoot, journalPath: handle.journalPath, receipts: [], progress: [] }
          } else if (message.method === 'command') value = await handle.command(message.value)
          else if (message.method === 'waitExit') value = await handle.waitExit()
          else if (message.method === 'close') value = await handle.close()
          worker.postMessage({ type: 'result', id: message.id, value })
        } catch (caught) { worker.postMessage({ type: 'result', id: message.id, error: String(caught.message) }) }
      }
    })
    worker.once('error', reject)
    worker.once('exit', code => { for (const waiter of callbacks.values()) waiter.reject(new Error('coordinator exited')); if (code !== 0 || error || !result) reject(error ?? new Error(`worker exit ${code}`)); else resolve(result) })
  })
  try {
    const original = await run('primary')
    const between = new ProductStore({ path: join(root, 'state', 'db.sqlite') })
    const bindingBefore = between.bindings.binding(original.target.attemptId)
    between.close()
    const successor = await run('successor', original)
    const store = new ProductStore({ path: join(root, 'state', 'db.sqlite') })
    let readback
    try {
      const work = store.product.works.get(original.workId) ?? store.product.works.get(successor.workId)
      const question = store.product.questions.get(original.question.id)
      const command = store.commands.get('recovery-answer')
      const verifications = store.db.prepare('SELECT id, assignment_id, candidate_generation, results FROM completion_verifications WHERE ticket_id = ? ORDER BY created_at DESC').all(original.target.ticketId)
      const acceptances = store.db.prepare('SELECT id, assignment_id, candidate_generation, criterion_ids, actor_ref FROM completion_acceptances WHERE ticket_id = ? ORDER BY accepted_at DESC').all(original.target.ticketId)
      const artifacts = successor.artifacts === undefined ? [] : store.db.prepare('SELECT id FROM artifacts').all().map(row => String(row.id)).slice(-successor.artifacts)
      const openedArtifacts = artifacts.map(id => ({ id, bytes: store.artifacts.read(id)?.data?.length ?? 0 }))
      readback = {
        workId: work?.id ?? null, questionId: question?.id ?? null, questionValidity: question?.validity ?? null,
        bindingAfter: store.bindings.binding(original.target.attemptId)?.state ?? null,
        commandReceipt: command === undefined ? null : { status: command.status, seq: command.seq, result: command.result },
        verification: verifications[0] === undefined ? null : { id: String(verifications[0].id), results: JSON.parse(String(verifications[0].results)) },
        acceptance: acceptances[0] === undefined ? null : { id: String(acceptances[0].id), criterionIds: JSON.parse(String(acceptances[0].criterion_ids)), actorRef: String(acceptances[0].actor_ref) },
        artifactCount: openedArtifacts.length, artifacts: openedArtifacts,
        workCount: store.product.works.listByProject('one', { limit: 10 }).length,
      }
    } finally { store.close() }
    const verificationRows = readback.verification?.results ?? []
    const checks = {
      bindingWasActiveBeforeTakeover: bindingBefore?.state === 'active',
      oneVirtualRunner: trace.virtualResources === 1,
      oneTurnStartNoBeginReplay: trace.protocolMethods.filter(value => value === 'turn/start').length === 1,
      nativeEffectAppliedOnce: trace.nativeEffects === 1,
      originalReturned: successor.workId === original.workId && successor.attemptId === original.target.attemptId && successor.originalQuestionId === original.question.id,
      deliveredThreeArtifacts: successor.phase === 'delivered' && successor.artifacts === 3,
      sameStoreWork: readback.workId === original.workId && readback.workCount === 1,
      questionAnswered: readback.questionId === original.question.id && readback.questionValidity === 'answered',
      bindingEnded: readback.bindingAfter === 'ended',
      commandRecorded: readback.commandReceipt?.status === 'recorded',
      machineCheckPassed: Array.isArray(verificationRows) && verificationRows.some(row => row.criterionId === 'machine' && row.outcome === 'PASS'),
      acceptanceRecorded: readback.acceptance !== null && readback.acceptance.actorRef.length > 0,
      allArtifactsReadable: readback.artifacts.length === 3 && readback.artifacts.every(entry => entry.bytes > 0),
      noProtocolErrors: trace.errors.length === 0,
    }
    return {
      protocol: 'main-original-recovery-consumer/1', root, original, successor, trace: { virtualResources: trace.virtualResources, nativeEffects: trace.nativeEffects, turnStarts: trace.protocolMethods.filter(v => v === 'turn/start').length, errors: trace.errors }, readback, checks,
      layers: { source: 'main d6244e63 owner-exit takeover + main recovery worker', controlled: 'parent-owned virtual Runner; no OS process', native: 0, physical: 'NOT_TESTED', recovered: 'CONTROLLED_TAKEOVER', ackLost: 'NOT_TESTED', schedulerSlots: 'NOT_TESTED' },
    }
  } finally {
    await Promise.all(trace.closers.map(close => close()))
    for (const path of recoveryRoots) rmSync(path, { recursive: true, force: true })
  }
}
