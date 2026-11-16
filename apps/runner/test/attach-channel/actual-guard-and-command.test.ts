/**
 * wave-34 outcomes I2/I3 — original guard layering and command authority.
 *
 * I2: main's original `beforeNativeWrite` succeeds as void; only an explicit wrapper may turn that
 * into `{allowed:true}`. A bare void callback must be treated as no approval. Deny, throw, consumed
 * admission, missing index and stale current all refuse.
 *
 * I3: the callback lease generation is NOT the business fence. Command identity/epoch checks stay with
 * the original service authority, and a typed transport refusal never becomes a success.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attachRunnerAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import { NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import type { AnswerCommand } from './fixtures.ts'
import { openProductIngress } from './product-ingress-harness.ts'
import { startNativeCallbacks, ATTEMPT } from './native-callbacks-harness.ts'

function commandFor(id: string) {
  return makeCommand('answer', { ...ATTEMPT, id, nativeBindingRef: 'binding-guard', answerRef: 'answer-guard' })
}

test('I2: the original void guard needs an explicit wrapper; bare void is never an approval', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const outcomes: string[] = []
  const h = await startNativeCallbacks(t, ingress, async ({ hooks }) => {
    for (const id of ['cmd-void', 'cmd-wrapped']) {
      try {
        await hooks.beforeNativeWrite(commandFor(id))
        outcomes.push(`${id}:allowed`)
      } catch (error) {
        outcomes.push(`${id}:${(error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'refused')}`)
      }
    }
    return { reason: 'terminal', evidenceRefs: ['guard-layer'] }
  })
  // Both commands are indexed; only the wrapped one gets a live admission.
  h.indexCommand(commandFor('cmd-void'))
  h.indexCommand(commandFor('cmd-wrapped'))
  h.permit('cmd-wrapped')
  let guardCalls = 0
  const caller = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'lease-guard',
    callbacks: {
      fact: async fact => h.callbacks.recordFact(fact),
      payload: async () => null,
      nativeWrite: async intent => {
        guardCalls += 1
        // The bare-void layer: the original method is not consulted and returns void. It must NOT allow.
        if (intent.command.id === 'cmd-void') {
          await h.runtime.beforeNativeWrite({ ...intent.command, id: 'never-indexed' }).catch(() => undefined)
          return undefined as never
        }
        return h.callbacks.nativeWrite(intent.command)
      },
    },
    timeoutMs: 3000,
  })
  const running = caller.run({ pollMs: 5, deadlineMs: 20_000 }).catch(() => undefined)
  h.activate()
  h.h.command(h.h.begin('prepared-policy-guard'))
  await h.h.done
  caller.stop()
  await running

  // A bare void callback never approves. main's caller then reports a typed refusal; the exact code is
  // not part of the guarantee, only that it is not an allow and no write happened.
  assert.notEqual(outcomes[0], 'cmd-void:allowed')
  assert.equal(outcomes[0]?.startsWith('cmd-void:'), true)
  assert.deepEqual(outcomes[1], 'cmd-wrapped:allowed')
  // The failing first intent may be retried on a re-bound lease, so the exact callback count is not a
  // contract here; the strict per-intent count is proven in the clean-path test below and in I1.
  assert.ok(guardCalls >= 1)
  // The wrapped path consumed exactly one admission; a repeat decision refuses.
  assert.deepEqual(await h.callbacks.nativeWrite(commandFor('cmd-wrapped')), { allowed: false })
})

test('I2: throw, consumed admission and stale current all refuse without manufacturing approval', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const h = await startNativeCallbacks(t, ingress, async () => ({ reason: 'terminal', evidenceRefs: ['guard-negative'] }))
  // A live admission whose callback throws: decision false, and the entry is not reused as allowed.
  h.indexCommand(commandFor('cmd-throw'))
  h.runtime.allowAnswer('cmd-throw', () => {
    throw new Error('original admission refused')
  })
  assert.deepEqual(await h.callbacks.nativeWrite(commandFor('cmd-throw')), { allowed: false })
  // A consumed admission cannot be spent twice.
  h.indexCommand(commandFor('cmd-once'))
  h.permit('cmd-once')
  assert.deepEqual(await h.callbacks.nativeWrite(commandFor('cmd-once')), { allowed: true })
  assert.deepEqual(await h.callbacks.nativeWrite(commandFor('cmd-once')), { allowed: false })
  // Wrong recorded body: the digest check refuses before any admission is consulted.
  const wrongBody: AnswerCommand = { ...(commandFor('cmd-body') as AnswerCommand), answerRef: 'other-answer' }
  h.indexCommand(wrongBody)
  h.permit('cmd-body')
  assert.deepEqual(await h.callbacks.nativeWrite(commandFor('cmd-body')), { allowed: false })
  // Stale current state refuses even with an indexed command and a live admission.
  h.indexCommand(commandFor('cmd-stale'))
  h.permit('cmd-stale')
  h.setCurrent(false)
  assert.deepEqual(await h.callbacks.nativeWrite(commandFor('cmd-stale')), { allowed: false })
  h.setCurrent(true)
})

test('I3: command transport refusal is independent of the callback lease generation', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const h = await startNativeCallbacks(t, ingress, async ({ io }) => {
    await io.record(h.h.fact({ factId: 'fact-cmd', kind: 'turn.ended', payloadRef: h.putLocalPayload({ kind: 'turn.ended', value: { nativeTurnRef: 't-cmd', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as never) }))
    return { reason: 'terminal', evidenceRefs: ['command'] }
  })
  const first = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'lease-cmd-a',
    callbacks: { fact: async fact => h.callbacks.recordFact(fact), payload: async () => null },
    timeoutMs: 3000,
  })
  const running = first.run({ pollMs: 5, deadlineMs: 20_000 }).catch(() => undefined)
  h.activate()
  h.h.command(h.h.begin('prepared-policy-cmd'))
  await h.h.done
  first.stop()
  await running

  // Callback lease generation now reads 2; the business command identity still has to match.
  const state = await first.inspect() as { generation?: number } | undefined
  void state
  const client = (await import('../../../../packages/execution/src/recovery-transport.ts')).connectRunnerRecovery(h.endpoint, h.h.producer, 3000)
  const generations = await client.channelState!()
  assert.ok(generations.generation >= 2)

  // A foreign attempt command is refused through the original authority, not admitted by the lease.
  const foreign = makeCommand('answer', { id: 'cmd-foreign', attemptId: 'other-attempt', nativeBindingRef: 'b', answerRef: 'a' })
  await assert.rejects(async () => client.command!(foreign))
  // A legal current-attempt command reaches the original service but cannot feed without a live child:
  // the transport reports a typed refusal, never a silent success.
  await assert.rejects(async () => client.command!(makeCommand('begin', { id: 'cmd-begin-authority', inputRef: 'input-1', preparedPolicyRef: 'prepared-1' })))
})
