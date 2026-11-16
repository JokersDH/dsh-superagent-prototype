import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createPersonalEngine } from '../../packages/orchestrator-core/dist/index.js'
import { attachRunnerAttempt } from '../../packages/execution/src/attached-attempt.ts'
import { bindCoreRepositories } from '../../apps/coordinator/main.ts'
import { createStoredRuntimeIngress, storedAttemptPayloads } from '../../apps/coordinator/stored-ingress.ts'
import { serveRunner } from '../../apps/runner/src/runner-service.ts'
import { RunnerPayloadStore } from '../../apps/runner/src/payload-store.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'
import { initialTicket, binding, producer } from './runtime-ingress-fixture.ts'

// Real Store/ingress and service, with a seeded ticket and a controlled decision callback. This is not
// an Application-created Work, QuestionBroker/NativeProductAttempt recovery or vendor execution.
async function fixture(t, { decision = 'allow', foreignFact = false } = {}) {
  const root = mkdtempSync('/tmp/pa-attached-port-')
  const store = new ProductStore({ path: join(root, 'state.sqlite'), artifactsRoot: join(root, 'artifacts') })
  store.domain.tickets.save(initialTicket())
  store.authority.enable(binding.contract)
  store.bindings.record(structuredClone(binding))
  store.bindings.setCurrent(binding.ticketId, binding.attemptId)
  const policy = () => ({
    version: 'v1', paused: false, evalTimeoutMs: 1000,
    gate: () => ({ admissible: false, reason: 'fixture' }),
    revalidate: () => true, admitsInferred: () => false,
  })
  const core = createPersonalEngine({
    repo: bindCoreRepositories(store), policy,
    scope: { scope: () => ({ listened: true, observed: false }) },
    assessor: { request: () => {} },
    executor: { start: () => {}, deliver: () => {}, stop: () => {} },
    outbox: { send: () => {}, withdraw: () => {}, status: () => undefined },
    completionPolicy: () => { throw new Error('Preseeded attached-port fixture does not complete Work') },
    isCurrentContract: ref => store.authority.isCurrent(ref),
  })
  const ingress = createStoredRuntimeIngress(store, core, policy).bind(producer)
  const payloads = storedAttemptPayloads(store)
  const originalBody = { message: 'original immutable Store body', decision }
  const originalRef = store.payloads.write(originalBody).ref
  const spec = makeAttemptSpec()
  const input = new PassThrough()
  const frames = []
  const observed = { references: [], facts: [], guardCalls: 0, effects: 0 }
  let result
  let release
  const held = new Promise(resolve => { release = resolve })
  let attached
  const serving = serveRunner({
    input,
    write: frame => frames.push(frame),
    recoveryRoot: join(root, 'recovery'),
    payloads: { read: async () => { throw new Error('No implicit payload reader') } },
    createDriver: (_attempt, hooks) => ({
      inspect: async () => { throw new Error('No native inspection in this fixture') },
      reconcile: async () => { throw new Error('No native reconciliation in this fixture') },
      serve: async (_attempt, io) => {
        try {
          const body = await io.payloads.read(originalRef)
          const payloadRef = await io.payloads.store({
            kind: 'turn.ended',
            value: { nativeTurnRef: 'attached-port-turn', outcome: 'completed', candidateAvailable: false, evidenceRefs: [] },
          }, 'critical')
          const receipt = await io.record({
            ...producer.attempt, factId: 'attached-port-fact', kind: 'turn.ended', payloadRef,
            source: foreignFact ? 'foreign-source' : producer.source,
          })
          let admission
          try {
            await hooks.beforeNativeWrite(makeCommand('answer'))
            observed.effects += 1
            admission = 'allowed'
          } catch (error) {
            admission = error.code ?? 'refused'
          }
          result = { body, receipt, admission }
        } catch (error) {
          result = { error: error.message, code: error.code }
        }
        await held
        return { reason: 'terminal', evidenceRefs: ['controlled-attached-port'] }
      },
    }),
  })
  const send = frame => input.write(Buffer.from(JSON.stringify({ v: 1, ...frame }) + '\n'))
  t.after(async () => {
    attached?.stop()
    release()
    send({ type: 'shutdown', id: 'cleanup' })
    input.end()
    try {
      const handle = await serving
      await handle.shutdown()
      await handle.done
    } finally {
      store.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
  send({
    type: 'bootstrap', id: 'bootstrap', spec,
    payloadRoot: join(root, 'payloads'), journalPath: join(root, 'journal'),
    producer: { source: producer.source, runnerIdentityRef: producer.runnerIdentityRef },
  })
  const readyDeadline = Date.now() + 2000
  while (!frames.some(frame => frame.type === 'ready') && Date.now() < readyDeadline)
    await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(frames.some(frame => frame.type === 'ready'))
  const directory = endpointDirectory(join(root, 'recovery'), spec.attemptId)
  const socketPath = join(directory, 'runner.sock')
  const stat = lstatSync(socketPath)
  const attachPort = {
    registration: { socketPath, credentialPath: join(directory, 'runner.credential'), socketIdentity: { dev: stat.dev, ino: stat.ino } },
    producer: structuredClone(producer),
  }
  const local = new RunnerPayloadStore(join(root, 'payloads'))
  attached = attachRunnerAttempt({
    endpoint: attachPort.registration, producer: attachPort.producer, leaseId: 'attached-port-owner',
    callbacks: {
      payload: async request => {
        observed.references.push(request.reference)
        return payloads.read(request.reference)
      },
      fact: async fact => {
        observed.facts.push(fact.factId)
        const restored = store.payloads.write(local.read(fact.payloadRef))
        assert.equal(restored.ref, fact.payloadRef)
        return ingress.record(fact)
      },
      ...(decision !== 'missing-guard' ? {
        nativeWrite: async intent => {
          observed.guardCalls += 1
          assert.equal(intent.command.id, 'cmd-answer')
          return { allowed: decision === 'allow', reason: 'controlled-decision' }
        },
      } : {}),
    },
  })
  return {
    store, frames, observed, originalBody, originalRef, attached,
    get result() { return result },
    async run() {
      await attached.pollOnce()
      send({ type: 'command', id: 'begin', command: makeCommand('begin') })
      const deadline = Date.now() + 2000
      while (!result && Date.now() < deadline) {
        await attached.pollOnce()
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      assert.ok(result, 'the controlled callbacks settle within the finite deadline')
    },
  }
}

for (const decision of ['allow', 'deny', 'missing-guard']) {
  test(`attached main port preserves Store payload/receipt and controlled ${decision} admission`, { timeout: 5000 }, async t => {
    const h = await fixture(t, { decision })
    await h.run()
    assert.equal(h.result.error, undefined)
    assert.deepEqual(h.observed.references, [h.originalRef])
    assert.deepEqual(h.result.body, h.originalBody)
    assert.deepEqual(h.observed.facts, ['attached-port-fact'])
    const persisted = h.store.facts.get('attached-port-fact')
    assert.ok(persisted)
    assert.equal(h.result.receipt.factId, 'attached-port-fact')
    assert.equal(h.result.receipt.persisted, true)
    assert.equal(h.result.receipt.seq, persisted.seq)
    assert.match(persisted.payloadDigest, /^[a-f0-9]{64}$/)
    assert.equal(h.observed.effects, decision === 'allow' ? 1 : 0)
    assert.equal(h.observed.guardCalls, decision === 'missing-guard' ? 0 : 1)
    assert.equal(h.result.admission, decision === 'allow' ? 'allowed' : 'refused')
    assert.deepEqual(h.attached.served, { facts: 1, payloads: 1, nativeWrites: 1, refused: 0, errors: 0 })
    assert.equal(h.frames.filter(frame => ['fact', 'payload-read', 'native-write-intent'].includes(frame.type)).length, 0)
  })
}

test('attached main port refuses a foreign fact before authoritative Store receipt or write admission', { timeout: 5000 }, async t => {
  const h = await fixture(t, { foreignFact: true })
  await h.run()
  assert.equal(h.result.code, 'identity_mismatch')
  assert.equal(h.store.facts.get('attached-port-fact'), undefined)
  assert.deepEqual(h.observed.facts, [])
  assert.equal(h.observed.guardCalls, 0)
  assert.equal(h.observed.effects, 0)
  assert.equal(h.attached.served.payloads, 1)
  assert.equal(h.attached.served.facts, 0)
  assert.equal(h.attached.served.nativeWrites, 0)
})
