/**
 * wave-34 outcome I1 — the unique channel's three callbacks via main's ORIGINAL methods.
 *
 * The callbacks are `NativeProductAttempt.recordFact` / `readPayload` / `nativeWriteDecision` — the
 * exact methods that `RunningAttempt.attachCallbacks` closes over. The driver is the real service; the
 * caller is main's `attachRunnerAttempt`. No launch/spawn occurs: the post-registration endpoint is
 * supplied to the class, which is the state `launch()` would have established.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { attachRunnerAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import { NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { openProductIngress } from './product-ingress-harness.ts'
import { startNativeCallbacks, ATTEMPT } from './native-callbacks-harness.ts'
import { makeCommand } from '../../../../packages/testing/src/index.ts'

const VALUE = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-orig', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['evidence-orig'] } } as Json

function commandFor(id: string) {
  return makeCommand('answer', { ...ATTEMPT, id, nativeBindingRef: 'binding-orig', answerRef: 'answer-orig' })
}

test('I1: original fact/payload/native methods serve the real channel end to end', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const intentOutcomes: string[] = []
  const seen: { localRef?: string; body?: unknown; seq?: number } = {}
  let caller: ReturnType<typeof attachRunnerAttempt> | undefined

  const h = await startNativeCallbacks(t, ingress, async ({ hooks, io }) => {
    const localRef = await io.payloads.store(VALUE, 'critical')
    seen.localRef = localRef
    // A reference only the coordinator Store has: exercises the original readPayload callback.
    const storedRef = ingress.putPayload({ stored: 'only-in-store' } as Json)
    seen.body = await io.payloads.read(storedRef)
    const receipt = await io.record(h.h.fact({ factId: 'fact-orig', kind: 'turn.ended', payloadRef: localRef }))
    seen.seq = receipt.seq
    for (const id of ['cmd-orig-1', 'cmd-orig-1']) {
      try {
        await hooks.beforeNativeWrite(commandFor(id))
        intentOutcomes.push('allowed')
      } catch (error) {
        intentOutcomes.push((error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'refused'))
      }
    }
    return { reason: 'terminal', evidenceRefs: ['orig'] }
  })

  // The caller-side original fact path reads its own local payload store; content addressing makes
  // the reference identical to the Driver's, so pre-writing the same value is the exact identity.
  const callerLocalRef = h.putLocalPayload(VALUE)
  // Original command indexing + one-shot live admission, exactly what main sets before a write.
  h.indexCommand(commandFor('cmd-orig-1'))
  h.permit('cmd-orig-1')

  caller = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'lease-orig',
    callbacks: {
      fact: fact => h.callbacks.recordFact(fact),
      payload: request => h.callbacks.readPayload(request.reference),
      nativeWrite: intent => h.callbacks.nativeWrite(intent.command),
    },
    timeoutMs: 3000,
  })
  const running = caller.run({ pollMs: 5, deadlineMs: 20_000 }).catch(() => undefined)
  h.activate()
  h.h.command(h.h.begin('prepared-policy-orig'))
  await h.h.done
  caller.stop()
  await running

  // fact: original Store ACK (row sequence) and the caller-local immutable identity agree.
  const row = ingress.store.facts.get('fact-orig') as { seq?: number } | undefined
  assert.ok(row, 'the original Store persisted the fact')
  assert.equal(row!.seq, seen.seq, 'the receipt is the original Store row sequence')
  assert.deepEqual(h.sinkCalls, ['fact-orig'])
  assert.match(String(seen.localRef), /^payload:/)
  assert.equal(seen.localRef, callerLocalRef, 'the immutable payload identity is shared')
  // payload: the original body came back, not a chunk envelope.
  assert.deepEqual(seen.body, { stored: 'only-in-store' })
  // native: one permit allows exactly one intent; the reused business command is refused.
  assert.deepEqual(intentOutcomes, ['allowed', 'native_write_denied'])
  assert.equal(caller.served.facts, 1)
  assert.ok(caller.served.payloads >= 1)
})

test('I1: the original fact method refuses a foreign producer and never reaches a receipt', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const h = await startNativeCallbacks(t, ingress, async () => ({ reason: 'terminal', evidenceRefs: ['foreign'] }))
  await assert.rejects(async () => h.callbacks.recordFact({
    ...h.h.fact({ factId: 'fact-foreign-orig', kind: 'turn.ended', payloadRef: 'payload:absent' }),
    source: 'intruder-source',
  }))
  assert.deepEqual(h.sinkCalls, [], 'no sink call for a foreign fact')
  assert.equal(ingress.store.facts.get('fact-foreign-orig'), undefined)
})

test('I1: a missing indexed command or stale current state yields a denial, not an allow', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const h = await startNativeCallbacks(t, ingress, async () => ({ reason: 'terminal', evidenceRefs: ['guard'] }))

  // No indexed command and no admission: denied.
  assert.deepEqual(await h.callbacks.nativeWrite(commandFor('cmd-missing-index')), { allowed: false })
  // Indexed but no live admission: denied.
  h.indexCommand(commandFor('cmd-no-admission'))
  assert.deepEqual(await h.callbacks.nativeWrite(commandFor('cmd-no-admission')), { allowed: false })
  // Indexed, admitted, but no longer current: denied and the admission is not consumed as allowed.
  h.indexCommand(commandFor('cmd-not-current'))
  h.permit('cmd-not-current')
  h.setCurrent(false)
  assert.deepEqual(await h.callbacks.nativeWrite(commandFor('cmd-not-current')), { allowed: false })
  h.setCurrent(true)
})
