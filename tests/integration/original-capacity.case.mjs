import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { reconcileRegisteredRunner } from '../../apps/coordinator/reconcile-runner.ts'
import { nativeCallbackLink } from './fixtures/native-callback-link.ts'

const until = async (read, accepts, label) => {
  const deadline = Date.now() + 12000
  let last
  while (Date.now() < deadline) {
    last = await read(); if (accepts(last)) return last
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`)
}
for (const capacity of [2, 4]) test(`original queue capacity ${capacity}: UNKNOWN retains occupancy, original barrier releases the next Work`, { timeout: 25000 }, async () => {
  const root = mkdtempSync('/tmp/pa-original-capacity-'), projectPath = join(root, 'project'), stateRoot = join(root, 'state')
  mkdirSync(join(projectPath, 'src'), { recursive: true }); mkdirSync(stateRoot)
  writeFileSync(join(projectPath, 'src/base.txt'), 'Base\n')
  const git = args => execFileSync('git', args, { cwd: projectPath, stdio: 'pipe' })
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'initial'])
  const trace = { virtualResources: 0, nativeEffects: 0, stdioFacts: [], stdioPayloads: 0, stdioGuards: 0,
    protocolMethods: [], errors: [], closers: [] }
  const store = new ProductStore({ path: join(stateRoot, 'db.sqlite') })
  const principal = { userId: 'capacity-user', authorityRef: 'capacity-authority' }
  const scope = { projectId: 'one', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }
  const profile = { id: 'controlled-original-capacity', revision: 1, driverId: 'codex-native', driverApiMajor: 1,
    driverRelease: '0.1.0-test', executable: process.execPath, argv: [], expectedVersion: process.version,
    nativeConfigRef: 'controlled-config', permissionPolicyRevision: 'controlled-policy', requiredFeatures: [] }
  const originalKill = process.kill
  process.kill = () => { throw new Error('This virtual capacity test must not signal any process') }
  const product = createProductRuntime({ store, stateRoot, scratchProject: projectPath, principal,
    actionSecret: Buffer.alloc(32, 61), maxActiveAttempts: capacity,
    projects: [{ id: 'one', displayName: 'Capacity', scope }], nativeRunnerLinkFactory: nativeCallbackLink(trace),
    native: { profile, approvalPolicy: 'on-request', projects: [{ id: 'one', path: projectPath,
      check: { id: 'output-check', revision: 1, executable: process.execPath,
        argv: ['-e', "if(require('node:fs').readFileSync('src/controlled-output.txt','utf8')!=='Beta\\n')process.exit(1)"],
        deadlineMs: 1000, outputLimitBytes: 1024 } }] } })
  const api = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    mode: 'fixture', allowedOrigins: [], read: product.read, operations: product.operations })
  const post = async value => {
    const response = await api.request('http://127.0.0.1/v1/commands', { method: 'POST',
      headers: { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'capacity', ...value }) })
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.status, 'recorded', JSON.stringify(result)); return result
  }
  const workIds = []
  const create = async index => {
    const result = await post({ kind: 'create_work', commandId: `capacity-create-${index}`, projectId: 'one', profileId: profile.id,
      goal: `Original capacity Work ${index}`, scope,
      criteria: [{ id: 'machine', kind: 'machine', required: true, description: 'Selected output', checkDefinitionRef: 'output-check' },
        { id: 'human', kind: 'human', required: true, description: 'Review patch' }] })
    workIds.push(result.workId)
    return result.workId
  }
  const binding = async workId => {
    const view = (await product.application.inspect({ workId })).works[0]
    return store.bindings.current(view.links[0].ticketId)
  }
  try {
    product.start()
    for (let index = 0; index < capacity; index++) {
      const id = await create(index)
      await until(() => product.application.inspect({ workId: id }), value => value.questions.length === 1, 'original question')
    }
    const first = await binding(workIds[0])
    const second = await binding(workIds[1])
    const next = await create(capacity)
    await product.execution.effects.idle('application.execute')
    assert.equal(await binding(next), undefined)
    assert.equal(trace.virtualResources, capacity)
    trace.inventoryUnknown = true
    await post({ kind: 'stop_work', commandId: 'capacity-stop-first', workId: workIds[0] })
    await until(() => store.bindings.binding(first.attemptId), value => value.state === 'stopping', 'original stopping binding')
    assert.equal((await reconcileRegisteredRunner(store, first.attemptId)).status, 'held')
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.equal(store.bindings.binding(first.attemptId).state, 'stopping', 'UNKNOWN never ended the original binding')
    assert.equal(await binding(next), undefined, 'UNKNOWN does not release capacity')
    assert.equal(trace.virtualResources, capacity)
    trace.inventoryUnknown = false
    // UNKNOWN on the first Work remains held. A DIFFERENT Work can safely release its own slot;
    // the first must never borrow that second Work's physical proof.
    await post({ kind: 'stop_work', commandId: 'capacity-stop-second', workId: workIds[1] })
    const released = await until(() => reconcileRegisteredRunner(store, second.attemptId),
      value => value.status === 'quiescent', 'second original resource barrier')
    assert.equal(released.status, 'quiescent', JSON.stringify(released))
    assert.equal(store.bindings.binding(second.attemptId).state, 'ended')
    assert.equal(store.bindings.binding(first.attemptId).state, 'stopping', 'another Work proof cannot release UNKNOWN')
    product.execution.effects.kick()
    await until(() => product.application.inspect({ workId: next }), value => value.questions.length === 1, 'next original Work progressed')
    assert.equal(trace.virtualResources, capacity + 1)
    for (const id of workIds.slice(2, capacity)) assert.equal((await binding(id)).state, 'active', 'other original slots unaffected')
    assert.equal(trace.nativeEffects, 0)
    console.log(JSON.stringify({ scope: 'original ProductExecution/Store bindings/queue/authenticated barrier with virtual resources',
      capacity, originalWorkCount: workIds.length, unknownRetained: true, originalBarrierReleased: true,
      nextWorkProgressed: true, retainedUnknownState: root, realSignals: 0, realModelNativeTurns: 0, physicalProof: false }))
  } finally {
    trace.inventoryUnknown = false
    try { await product.close(); await Promise.all(trace.closers.map(close => close())) }
    finally {
      process.kill = originalKill
      const unknown = store.domain.tickets.list().some(ticket => {
        const known = store.bindings.current(ticket.id); return known && known.state !== 'ended'
      })
      store.close()
      if (!unknown) rmSync(root, { recursive: true, force: true })
      else console.log(`UNKNOWN original capacity material retained: ${root}`)
    }
  }
})
