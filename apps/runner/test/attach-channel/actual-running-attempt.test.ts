/**
 * wave-35 outcome I1 — the unique channel consumes the shape `runtime.launch` returns.
 *
 * The launch-shaped handle carries `attachPort` + `attachCallbacks`; the guard validates the handle
 * identity, the immutable producer tuple, the registration and the three callbacks BEFORE any endpoint
 * is opened. The consumer is main's `attachRunnerAttempt`; callbacks are the original
 * `NativeProductAttempt` methods. No launch/spawn occurs: the endpoint comes from the real in-process
 * service and the class is given that post-registration endpoint as an explicitly labelled component
 * injection, not as a claim that the factory ran.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { attachRunnerAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import { connectRunnerRecovery } from '../../../../packages/execution/src/recovery-transport.ts'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import { inspectRunningAttempt, type RunningAttemptExpectation } from '../../src/attach-channel/running-attempt.ts'
import { NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { openProductIngress } from './product-ingress-harness.ts'
import { launchShape, startNativeCallbacks, ATTEMPT } from './native-callbacks-harness.ts'

const VALUE = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-run', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['evidence-run'] } } as Json

function commandFor(id: string) {
  return makeCommand('answer', { ...ATTEMPT, id, nativeBindingRef: 'binding-run', answerRef: 'answer-run' })
}

function expectationOf(spec: { ticketId: string; assignmentId: string; attemptId: string; fenceEpoch: number; contract: AttemptContract }): RunningAttemptExpectation {
  return { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
}

type AttemptContract = { workId: string; revision: number; digest: string }

test('I1: a launch-shaped handle passes the identity guard and serves the real three callbacks', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const outcomes: string[] = []
  const seen: { body?: unknown; localRef?: string } = {}

  const h = await startNativeCallbacks(t, ingress, async ({ hooks, io }) => {
    const localRef = await io.payloads.store(VALUE, 'critical')
    seen.localRef = localRef
    seen.body = await io.payloads.read(ingress.putPayload({ stored: 'launch-shape' } as Json))
    await io.record(h.h.fact({ factId: 'fact-run', kind: 'turn.ended', payloadRef: localRef }))
    for (const id of ['cmd-run-1', 'cmd-run-1']) {
      try {
        await hooks.beforeNativeWrite(commandFor(id))
        outcomes.push('allowed')
      } catch (error) {
        outcomes.push((error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'refused'))
      }
    }
    return { reason: 'terminal', evidenceRefs: ['launch-shape'] }
  })

  const running = launchShape(h)
  const inspected = inspectRunningAttempt(running, expectationOf(h.spec))
  assert.equal(inspected.ok, true, 'the matching launch-shaped handle is admitted')
  if (!inspected.ok) return
  assert.equal(inspected.value.attemptId, h.spec.attemptId)
  assert.equal(inspected.value.port.producer.attempt.attemptId, h.spec.attemptId, 'handle and producer name the same attempt')
  assert.equal(inspected.value.port.producer.attempt.contract.digest, h.spec.contract.digest, 'the contract tuple is the current one')

  h.putLocalPayload(VALUE)
  h.indexCommand(commandFor('cmd-run-1'))
  h.permit('cmd-run-1')

  const caller = attachRunnerAttempt({
    endpoint: inspected.value.port.registration,
    producer: inspected.value.port.producer,
    leaseId: 'lease-run',
    callbacks: inspected.value.callbacks,
    timeoutMs: 3000,
  })
  const runningLoop = caller.run({ pollMs: 5, deadlineMs: 20_000 }).catch(() => undefined)
  h.activate()
  h.h.command(h.h.begin('prepared-policy-run'))
  await h.h.done
  caller.stop()
  await runningLoop

  const row = ingress.store.facts.get('fact-run') as { seq?: number } | undefined
  assert.ok(row, 'the original Store persisted the fact through the launch-shaped callbacks')
  assert.deepEqual(seen.body, { stored: 'launch-shape' }, 'payload is the original body, not a chunk envelope')
  assert.deepEqual(outcomes, ['allowed', 'native_write_denied'], 'one live admission, then refusal')
  assert.equal(caller.served.facts, 1)
  assert.ok(caller.served.payloads >= 1)
  assert.ok(caller.served.nativeWrites >= 1)
})

test('I1: every incomplete or mismatched handle is refused before an endpoint is opened', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const h = await startNativeCallbacks(t, ingress, async () => ({ reason: 'terminal', evidenceRefs: ['refusals'] }))
  const good = launchShape(h) as unknown as Record<string, unknown>
  const port = good.attachPort as { registration: Record<string, unknown>; producer: Record<string, unknown> }

  const cases: Array<{ label: string; value: unknown; refusal: string }> = [
    { label: 'not an object', value: 'running', refusal: 'handle_missing' },
    { label: 'no handle id', value: { ...good, attemptId: '' }, refusal: 'handle_missing' },
    { label: 'no port', value: { ...good, attachPort: undefined }, refusal: 'port_missing' },
    {
      label: 'registration without identity',
      value: { ...good, attachPort: { ...port, registration: { socketPath: '/tmp/x', credentialPath: '/tmp/y' } } },
      refusal: 'registration_incomplete',
    },
    {
      label: 'attempt without contract',
      value: { ...good, attachPort: { ...port, producer: { ...port.producer, attempt: { ticketId: 't', assignmentId: 'a' } } } },
      refusal: 'attempt_incomplete',
    },
    { label: 'mismatched handle', value: { ...good, attemptId: 'different-attempt-id' }, refusal: 'handle_producer_mismatch' },
    { label: 'missing callbacks', value: { ...good, attachCallbacks: { fact: () => undefined } }, refusal: 'callbacks_missing' },
  ]
  for (const entry of cases) {
    const result = inspectRunningAttempt(entry.value, expectationOf(h.spec))
    assert.equal(result.ok, false, `${entry.label} must be refused`)
    if (result.ok) continue
    assert.equal(result.refusal, entry.refusal, entry.label)
    assert.ok(result.message.length > 0 && result.message.length <= 240, 'diagnostics stay bounded')
  }

  // A handle for another binding is refused even when its own tuple is internally consistent.
  const foreignBinding = inspectRunningAttempt(good, { ...expectationOf(h.spec), ticketId: 'ticket-other' })
  assert.equal(foreignBinding.ok, false)
  if (!foreignBinding.ok) assert.equal(foreignBinding.refusal, 'binding_mismatch')

  // The refusal is identity, not connectivity: the same endpoint is live for the real producer.
  const client = connectRunnerRecovery(h.endpoint, h.h.producer, 3000)
  const state = await client.channelState!()
  assert.equal(typeof state.generation, 'number', 'the endpoint this handle pointed at is reachable')
})
