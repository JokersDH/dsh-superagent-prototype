import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { nativeCallbackLink } from './fixtures/native-callback-link.ts'

// The Runner/protocol host lives outside both coordinator threads. Coordinator A exits without close,
// its Store closes, then B opens the same database and original production registration. This proves
// controlled coordinator-owner failure/takeover, not a real native OS process/SIGKILL resource claim.
for (const mode of ['resume', 'terminal-acked', 'answer-written-reply-lost', 'terminal-proof-missing', 'revoked', 'profile-changed', 'policy-changed', 'resource-unknown']) test(`original Work coordinator takeover: ${mode}`, { timeout: 25000 }, async () => {
  const root = mkdtempSync('/tmp/pa-original-recover-'), projectPath = join(root, 'project'), stateRoot = join(root, 'state')
  mkdirSync(join(projectPath, 'src'), { recursive: true }); mkdirSync(stateRoot)
  writeFileSync(join(projectPath, 'src/base.txt'), 'Base\n')
  const git = args => execFileSync('git', args, { cwd: projectPath, stdio: 'pipe' })
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'initial'])
  const trace = { virtualResources: 0, nativeEffects: 0, stdioFacts: [], stdioPayloads: 0, stdioGuards: 0,
    protocolMethods: [], errors: [], closers: [] }
  const recoveryRoots = []
  const priorReceiverLog = process.env.PA_RUNNER_RECEIVER_LOG
  process.env.PA_RUNNER_RECEIVER_LOG = join(root, 'receiver.jsonl')
  let handle, serial = 0
  let primaryWorker, releaseResolution
  if (mode === 'answer-written-reply-lost') trace.afterNativeEffect = async () => {
    primaryWorker.postMessage({ type: 'exit-owner' })
    await new Promise(resolve => { releaseResolution = resolve })
  }
  const run = (stage, original) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./fixtures/original-recovery-worker.mjs', import.meta.url), {
      workerData: { root: stateRoot, projectPath, stage, mode, original } })
    if (stage === 'primary') primaryWorker = worker
    const callbacks = new Map()
    let result, error
    const callback = (method, value) => new Promise((res, rej) => {
      const id = ++serial; callbacks.set(id, { resolve: res, reject: rej })
      worker.postMessage({ type: 'callback', id, method, value })
    })
    worker.on('message', async message => {
      if (message.type === 'callback-result') {
        const waiter = callbacks.get(message.id); callbacks.delete(message.id)
        message.error ? waiter?.reject(new Error(message.error)) : waiter?.resolve(message.value)
      } else if (message.type === 'primary-ready' || message.type === 'done') result = message.value
      else if (message.type === 'error') error = new Error(message.error)
      else if (message.type === 'call') {
        try {
          let value
          if (message.method === 'spawn') {
            assert.equal(trace.virtualResources, 0, 'exactly one original Runner')
            const { options, spec } = message.value
            recoveryRoots.push(options.env.PA_RUNNER_RECOVERY_ROOT)
            handle = await nativeCallbackLink(trace)({ ...options,
              payloads: { read: reference => callback('payload', reference) },
              beforeNativeWrite: command => callback('guard', command) }).spawnAttempt(spec, fact => callback('fact', fact))
            value = { pid: handle.pid, stateRoot: handle.stateRoot, journalPath: handle.journalPath, receipts: [], progress: [] }
          } else if (message.method === 'command') value = await handle.command(message.value)
          else if (message.method === 'waitExit') {
            value = await handle.waitExit()
            if (stage === 'primary' && ['terminal-acked', 'terminal-proof-missing'].includes(mode)) { worker.postMessage({ type: 'exit-owner' }); return }
          }
          else if (message.method === 'close') value = await handle.close()
          else if (message.method === 'release-resolution') releaseResolution()
          worker.postMessage({ type: 'result', id: message.id, value })
        } catch (caught) { worker.postMessage({ type: 'result', id: message.id, error: String(caught.message) }) }
      }
    })
    worker.once('error', reject)
    worker.once('exit', code => {
      for (const waiter of callbacks.values()) waiter.reject(new Error('Original coordinator exited'))
      if (code !== 0 || error || !result) reject(error ?? new Error(`coordinator exited ${code}`))
      else resolve(result)
    })
  })
  try {
    const original = await run('primary')
    const between = new ProductStore({ path: join(stateRoot, 'db.sqlite') })
    assert.equal(between.bindings.binding(original.target.attemptId).state, 'active', 'no graceful close or synthetic ended->active')
    if (mode === 'revoked') between.authority.disable(original.question.contract)
    between.close()
    if (mode === 'resource-unknown') trace.inventoryUnknown = true
    const result = await run('successor', original)
    assert.equal(trace.virtualResources, 1, 'no replacement attempt/Runner')
    assert.equal(trace.protocolMethods.filter(value => value === 'turn/start').length, 1, 'no begin replay')
    const positive = ['resume', 'terminal-acked', 'answer-written-reply-lost'].includes(mode)
    assert.equal(trace.nativeEffects, positive || mode === 'terminal-proof-missing' ? 1 : 0)
    const receiver = readFileSync(join(root, 'receiver.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    assert.equal(receiver.filter(value => value.kind === 'begin').length, 1, 'original Runner received one begin command')
    assert.equal(receiver.filter(value => value.kind === 'answer').length, positive || mode === 'terminal-proof-missing' ? 1 : 0,
      'original Runner received no duplicate answer command')
    for (const value of receiver) {
      assert.equal(value.attemptId, original.target.attemptId)
      assert.equal(value.body.assignmentId, original.target.assignmentId)
      assert.deepEqual(value.body.contract, original.question.contract)
    }
    assert.deepEqual(trace.errors, [])
    if (positive) {
      assert.equal(result.phase, 'delivered'); assert.equal(result.artifacts, 3)
      assert.equal(result.attemptId, original.target.attemptId)
      console.log(JSON.stringify({ scope: 'actual original ProductRuntime/Native.resume/Application/Broker controlled owner-exit takeover',
        ...result, faultWindow: mode, runnerCount: 1, beginCount: 1, virtualNativeEffects: 1,
        physicalQuiescenceProven: false, originalTwoFourSlotsProven: false, realSignals: 0, realModelNativeTurns: 0 }))
    } else assert.equal(result.rejected, true)
  } finally {
    releaseResolution?.()
    // Both workers exit themselves. Never use Worker.terminate or a process signal to finish this test.
    await Promise.all(trace.closers.map(close => close()))
    for (const path of recoveryRoots) rmSync(path, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    if (priorReceiverLog === undefined) delete process.env.PA_RUNNER_RECEIVER_LOG
    else process.env.PA_RUNNER_RECEIVER_LOG = priorReceiverLog
  }
})
