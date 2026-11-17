/**
 * wave-36 line 2 — a real `launch()` result consumed through the unique channel.
 *
 * `InProcessRunnerHost.launch(spec)` genuinely returns a `RunningAttempt` from an embedding host
 * (real `serveRunner`, real recovery endpoint, real bootstrap/journal) with feed/stop/waitExit and the
 * three callbacks. No child is spawned and no native driver is involved: this is an embedded controlled
 * host, NOT `NativeProductAttempt.launch`, so the original factory's class callbacks stay NOT_REACHED.
 *
 * The consumer validates the handle with `inspectRunningAttempt`, binds BEFORE any business feed, then
 * drives the real service with `running.feed(begin)` while the callbacks serve facts, immutable payloads
 * and per-intent guard decisions.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { criticalFact } from '../../../../packages/driver-kit/src/attempt-io.ts'
import type { Json, RunnerCommand } from '../../../../packages/contracts/src/types.ts'
import { JsonSchema } from '../../../../packages/contracts/src/schemas.ts'
import { canonicalDigest } from '../../../../packages/contracts/src/canonical.ts'
import { key } from '../../../../packages/orchestrator-core/dist/index.js'
import { attachRunnerAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import { makeAttemptSpec, makeCommand } from '../../../../packages/testing/src/index.ts'
import { storedAttemptPayloads } from '../../../../apps/coordinator/stored-ingress.ts'
import { producer as fixtureProducer } from '../../../../tests/integration/runtime-ingress-fixture.ts'
import { createInProcessHost } from '../../src/attach-channel/inprocess-host.ts'
import { inspectRunningAttempt, type RunningAttemptExpectation } from '../../src/attach-channel/running-attempt.ts'
import { NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { openProductIngress, type ProductIngress } from './product-ingress-harness.ts'

const VALUE = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-host', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['host'] } } as Json

function commandTuple(spec: { ticketId: string; assignmentId: string; attemptId: string; fenceEpoch: number; contract: { workId: string; revision: number; digest: string } }) {
  return { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
}

function commandFor(spec: ReturnType<typeof makeAttemptSpec>, id: string): RunnerCommand {
  return makeCommand('answer', { ...commandTuple(spec), id, nativeBindingRef: 'binding-host', answerRef: 'answer-host' })
}

function indexCommand(ingress: ProductIngress, spec: ReturnType<typeof makeAttemptSpec>, id: string): void {
  const command = commandFor(spec, id)
  const record = { command, inputIds: [] }
  ingress.store.commands.record(key('product-command', id), canonicalDigest(JsonSchema.parse(record)), () => record)
}

function expectationOf(spec: ReturnType<typeof makeAttemptSpec>): RunningAttemptExpectation {
  return { ...commandTuple(spec) }
}

test('L2: a real launch result serves three callbacks and drives feed/stop without a native child', { timeout: 45000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const spec = makeAttemptSpec()
  // The Store ingress fences facts by its own registered binding source, so the host must publish the
  // same producer identity it will attach as (fixture binding here; a product host uses its own).
  const source = fixtureProducer.source
  const seen: { body?: unknown; seq?: number; localRef?: string; outcomes: string[] } = { outcomes: [] }
  // The immutable payload must already exist in the coordinator Store for the callback side to accept
  // the fact; content addressing makes the driver-local reference identical.
  const stagedRef = ingress.putPayload(VALUE)
  const live = new Set<string>()

  const guard = async (command: RunnerCommand): Promise<void> => {
    const current = ingress.store.bindings.binding(spec.attemptId) as { state?: string } | undefined
    if (!current || current.state !== 'active') throw new Error('binding_not_current')
    const indexed = ingress.store.commands.get(key('product-command', command.id))?.result as { command?: unknown } | undefined
    if (!indexed?.command || canonicalDigest(JsonSchema.parse(indexed.command)) !== canonicalDigest(JsonSchema.parse(command)))
      throw new Error('command_mismatch')
    if (!live.has(command.id)) throw new Error('no_live_admission')
    live.delete(command.id)
  }

  const host = createInProcessHost({
    source,
    runnerIdentityRef: fixtureProducer.runnerIdentityRef,
    payloads: { read: reference => storedAttemptPayloads(ingress.store).read(reference) },
    createDriver: (_spec, driverHooks) => ({
      inspect: async () => {
        throw new Error('scripted driver has no inspection')
      },
      reconcile: async () => {
        throw new Error('scripted driver has no reconcile')
      },
      serve: async (_attempt, io) => {
        const localRef = await io.payloads.store(VALUE, 'critical')
        seen.localRef = localRef
        seen.seq = (await io.record(criticalFact(spec, { factId: 'facthost', source, kind: 'turn.ended', payloadRef: localRef }))).seq
        seen.body = await io.payloads.read(ingress.putPayload({ stored: 'host-callback' } as Json))
        for (const id of ['cmdhost', 'cmdhost']) {
          try {
            await driverHooks.beforeNativeWrite(commandFor(spec, id))
            seen.outcomes.push('allowed')
          } catch (error) {
            seen.outcomes.push((error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'refused'))
          }
        }
        return { reason: 'terminal', evidenceRefs: ['host-driver'] }
      },
    }),
    callbacks: () => ({
      fact: fact => ingress.sink.record(fact),
      payload: request => storedAttemptPayloads(ingress.store).read(request.reference),
      nativeWrite: async intent => {
        try {
          await guard(intent.command)
          return { allowed: true }
        } catch {
          return { allowed: false }
        }
      },
    }),
  })
  t.after(() => host.shutdown())

  const running = await host.launch(spec)

  // `inspectRunningAttempt` must pass on the actual returned object, and the handle must name the
  // registration producer.
  const inspected = inspectRunningAttempt(running, expectationOf(spec))
  assert.equal(inspected.ok, true, 'the launch-returned running is a trustworthy attach source')
  if (!inspected.ok) return
  assert.equal(inspected.value.port.producer.attempt.attemptId, spec.attemptId)
  assert.equal(running.registration.registration.socketPath, inspected.value.port.registration.socketPath)
  assert.equal(typeof running.attachCallbacks?.fact, 'function')
  assert.equal(typeof running.attachCallbacks?.payload, 'function')
  assert.equal(typeof running.attachCallbacks?.nativeWrite, 'function')

  indexCommand(ingress, spec, 'cmdhost')
  live.add('cmdhost')

  const caller = attachRunnerAttempt({
    endpoint: inspected.value.port.registration,
    producer: inspected.value.port.producer,
    leaseId: 'leasehost',
    callbacks: inspected.value.callbacks,
    timeoutMs: 3000,
  })
  const loop = caller.run({ pollMs: 5, deadlineMs: 40_000 }).catch(() => undefined)
  // Bind before the business feed: a native intent created while stdio still owns the channel cannot
  // migrate, so the ordering is part of the contract.
  await caller.pollOnce()
  await running.feed(makeCommand('begin', { ...commandTuple(spec), id: 'cmdbegin', inputRef: 'input-1', preparedPolicyRef: 'prepared-host' }))
  const exit = await running.waitExit()
  caller.stop()
  await loop

  const row = ingress.store.facts.get('facthost') as { seq?: number } | undefined
  assert.ok(row, 'the original Store persisted the fact through the launch-returned callbacks')
  assert.equal(row!.seq, seen.seq, 'the receipt is the original Store row sequence')
  assert.equal(seen.localRef, stagedRef, 'the driver payload and the Store payload share the immutable reference')
  assert.deepEqual(seen.body, { stored: 'host-callback' }, 'payload is the original body, not a chunk envelope')
  assert.deepEqual(seen.outcomes, ['allowed', 'native_write_denied'], 'one live admission, then a fresh refusal')
  assert.deepEqual(exit.reason, 'terminal', 'the host reports the service own exit')

  // A closed channel is not physical completion: stop() reports indeterminate unless a real barrier
  // confirms it, and never fabricates `confirmed` from the channel state.
  const quiescence = await running.stop(2000)
  assert.equal(quiescence.quiescence, 'indeterminate')
  assert.deepEqual(quiescence.evidenceRefs, ['inprocess-host-shutdown-sent'])

  const frames = running.frames()
  assert.ok(frames.some(frame => frame.type === 'ready'), 'the host observed the real ready frame')
  assert.ok(frames.some(frame => frame.type === 'exited'), 'the host observed the real exit frame')
})

test('L2: the returned handle is bound to its own current binding and never fabricates quiescence', { timeout: 30000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const spec = makeAttemptSpec()
  const host = createInProcessHost({
    source: fixtureProducer.source,
    runnerIdentityRef: fixtureProducer.runnerIdentityRef,
    createDriver: () => ({
      inspect: async () => {
        throw new Error('scripted driver has no inspection')
      },
      reconcile: async () => {
        throw new Error('scripted driver has no reconcile')
      },
      serve: async () => ({ reason: 'terminal', evidenceRefs: ['quick-exit'] }),
    }),
    callbacks: () => ({
      fact: fact => ingress.sink.record(fact),
      payload: request => storedAttemptPayloads(ingress.store).read(request.reference),
      nativeWrite: async () => ({ allowed: false }),
    }),
  })
  t.after(() => host.shutdown())
  const running = await host.launch(spec)

  // A handle from another binding is refused even though the object itself is well formed.
  const foreignBinding = inspectRunningAttempt(running, { ...commandTuple(spec), ticketId: 'ticket-other' })
  assert.equal(foreignBinding.ok, false)
  if (!foreignBinding.ok) assert.equal(foreignBinding.refusal, 'binding_mismatch')

  // Run to a natural exit, then stop(): the channel is gone but quiescence is still not confirmed by
  // a shape. A caller must supply its own physical barrier.
  await running.feed(makeCommand('begin', { ...commandTuple(spec), id: 'cmdquick', inputRef: 'input-1', preparedPolicyRef: 'prepared-quick' }))
  const exit = await running.waitExit()
  assert.equal(exit.reason, 'terminal')
  const quiescence = await running.stop(100)
  assert.equal(quiescence.quiescence, 'indeterminate')
  // Cleanup is idempotent.
  await running.shutdown()
  await running.shutdown()
})
