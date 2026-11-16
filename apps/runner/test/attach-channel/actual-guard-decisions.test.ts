/**
 * wave-35 outcome I2 — every native intent asks the original guard afresh.
 *
 * The decision is per intent: a denied intent does not poison the business command, an allowed one is
 * consumed exactly once, and no decision is cached across intents. `current` is evaluated when the
 * decision is made; flipping it afterwards refuses the NEXT intent instead of retroactively rewriting
 * an already-made decision.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attachRunnerAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import { NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { openProductIngress } from './product-ingress-harness.ts'
import { startNativeCallbacks, ATTEMPT } from './native-callbacks-harness.ts'

function commandFor(id: string) {
  return makeCommand('answer', { ...ATTEMPT, id, nativeBindingRef: 'binding-fresh', answerRef: 'answer-fresh' })
}

test('I2: deny does not poison a command; approval is per intent and never cached', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const outcomes: string[] = []
  const guardCalls: string[] = []

  const h = await startNativeCallbacks(t, ingress, async ({ hooks }) => {
    for (const id of ['cmd-fresh', 'cmd-fresh', 'cmd-fresh']) {
      try {
        await hooks.beforeNativeWrite(commandFor(id))
        outcomes.push('allowed')
      } catch (error) {
        outcomes.push((error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'refused'))
      }
    }
    return { reason: 'terminal', evidenceRefs: ['per-intent'] }
  })

  // Indexed but NOT admitted yet: the first decision must be a denial.
  h.indexCommand(commandFor('cmd-fresh'))
  const caller = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'lease-fresh',
    callbacks: {
      fact: async fact => h.callbacks.recordFact(fact),
      payload: async () => null,
      nativeWrite: async intent => {
        guardCalls.push(intent.command.id)
        // Grant the live admission only after the first denial is observed, i.e. between intents.
        if (guardCalls.length === 2) h.permit('cmd-fresh')
        return h.callbacks.nativeWrite(intent.command)
      },
    },
    timeoutMs: 3000,
  })
  const loop = caller.run({ pollMs: 5, deadlineMs: 20_000 }).catch(() => undefined)
  // Bind before any business feed, exactly as main does after launch: a native intent that exists
  // while the stdio lease is still current cannot migrate, so ordering is part of the contract.
  await caller.pollOnce().catch(() => undefined)
  h.activate()
  h.h.command(h.h.begin('prepared-policy-fresh'))
  await h.h.done
  caller.stop()
  await loop

  assert.deepEqual(
    outcomes,
    ['native_write_denied', 'allowed', 'native_write_denied'],
    'denied, then allowed for the same command, then consumed',
  )
  assert.deepEqual(guardCalls, ['cmd-fresh', 'cmd-fresh', 'cmd-fresh'], 'the guard saw each intent exactly once')
  // No decision was transferred: a later direct decision for the same command is denied again.
  assert.deepEqual(await h.callbacks.nativeWrite(commandFor('cmd-fresh')), { allowed: false })
})

test('I2: current is evaluated at decision time; a later flip refuses the next intent only', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const h = await startNativeCallbacks(t, ingress, async () => ({ reason: 'terminal', evidenceRefs: ['ordering'] }))

  h.indexCommand(commandFor('cmd-before-flip'))
  h.indexCommand(commandFor('cmd-after-flip'))
  // The admission itself flips current as its final step: the decision already taken stands.
  h.runtime.allowAnswer('cmd-before-flip', () => h.setCurrent(false))
  h.permit('cmd-after-flip')
  assert.deepEqual(await h.callbacks.nativeWrite(commandFor('cmd-before-flip')), { allowed: true })
  // The next intent is refused by the current check before its own admission is consulted, so that
  // admission is *not* consumed by this refusal.
  assert.deepEqual(await h.callbacks.nativeWrite(commandFor('cmd-after-flip')), { allowed: false })
  h.setCurrent(true)
  // Restoring current lets the still-live admission decide once; after that it is spent.
  assert.deepEqual(await h.callbacks.nativeWrite(commandFor('cmd-after-flip')), { allowed: true })
  assert.deepEqual(await h.callbacks.nativeWrite(commandFor('cmd-after-flip')), { allowed: false })
})
