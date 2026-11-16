/**
 * wave-33 outcome 2 — temporary detach, terminal close and business succession together.
 *
 * Two real callers (`attachRunnerAttempt`) serve the same attempt across a lease handover: data keeps
 * its original ids/references, a pending native intent does not migrate, and the replaced caller is
 * fenced out. A terminal service closes the channel, so a pending callback fails `closed` and a late
 * reply cannot revive it. `not_seen` / `observed` / `unknown` are kept distinct: a timeout or a
 * terminal close never means "not written".
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { attachRunnerAttempt, type AttachedAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import type { RunnerEndpoint } from '../../../../packages/execution/src/recovery-transport.ts'
import { producer as fixtureProducer } from '../../../../tests/integration/runtime-ingress-fixture.ts'
import { NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { startService, type DriverContext, type ServiceOptions } from './actual-harness.ts'
import { openProductIngress, type ProductIngress } from './product-ingress-harness.ts'
import { answerCommand, factOf } from './fixtures.ts'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }
function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => {
    resolve = settle
  })
  return { promise, resolve }
}

async function startWithEndpoint(t: import('node:test').TestContext, ingress: ProductIngress, run: (context: DriverContext) => ReturnType<NonNullable<ServiceOptions['run']>>) {
  const h = await startService(t, {
    source: fixtureProducer.source,
    runnerIdentityRef: fixtureProducer.runnerIdentityRef,
    recovery: true,
    payloads: ingress.payloads,
    run,
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const endpoint = await h.waitEndpoint()
  return { h, endpoint }
}

type CallerOverrides = {
  fact?: (fact: { factId: string }) => Promise<{ factId: string; persisted: true; seq: number }>
  nativeWrite?: (intent: { id: string; command: { id: string } }) => Promise<{ allowed: boolean; reason?: string }>
}

function attach(h: Awaited<ReturnType<typeof startService>>, ingress: ProductIngress, endpoint: RunnerEndpoint, leaseId: string, overrides: CallerOverrides = {}): AttachedAttempt {
  return attachRunnerAttempt({
    endpoint,
    producer: h.producer,
    leaseId,
    callbacks: {
      fact: overrides.fact ?? (async fact => ingress.sink.record(fact as never)),
      payload: async request => ingress.payloads.read(request.reference),
      nativeWrite: overrides.nativeWrite ?? (async () => ({ allowed: true })),
    },
    timeoutMs: 3000,
  })
}

test('outcome2: a successor caller continues data while the replaced caller is fenced', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const payloadRef = ingress.putPayload({ kind: 'turn.ended', value: { nativeTurnRef: 'turn-succ', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json)
  const firstFactAcked = defer<void>()
  const secondAllowed = defer<void>()
  const { h, endpoint } = await startWithEndpoint(t, ingress, async ({ io }) => {
    await io.record(h.fact({ factId: 'fact-succ-1', kind: 'turn.ended', payloadRef }))
    await firstFactAcked.promise
    // Do not create the second fact until the successor owns the lease.
    await secondAllowed.promise
    await io.record(h.fact({ factId: 'fact-succ-2', kind: 'turn.ended', payloadRef }))
    return { reason: 'terminal', evidenceRefs: ['succession'] }
  })
  h.command(h.begin('prepared-policy-succ'))

  const a = attach(h, ingress, endpoint, 'lease-succ-a', {
    fact: async fact => {
      const receipt = await ingress.sink.record(fact as never)
      firstFactAcked.resolve()
      return receipt
    },
  })
  const runningA = a.run({ pollMs: 5, deadlineMs: 15_000 }).catch(() => undefined)
  await firstFactAcked.promise
  await new Promise(resolve => setTimeout(resolve, 50))

  // Successor binds with the current generation and continues the same attempt.
  const b = attach(h, ingress, endpoint, 'lease-succ-b')
  const runningB = b.run({ pollMs: 5, deadlineMs: 15_000 }).catch(() => undefined)
  for (let index = 0; index < 400 && b.generation < 3; index += 1) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(b.generation, 3, 'the successor bound with the current generation')
  secondAllowed.resolve()
  await h.done
  a.stop()
  b.stop()
  await Promise.all([runningA, runningB])

  assert.deepEqual(a.served.facts >= 1, true, 'the replaced caller served the first fact')
  assert.deepEqual(b.served.facts, 1, 'the successor served the second fact')
  assert.ok(a.served.errors >= 1 || a.served.refused >= 1 || a.generation > 0, 'the replaced caller is fenced or reports the refusal')
  const receipts = [ingress.store.facts.get('fact-succ-1'), ingress.store.facts.get('fact-succ-2')]
  assert.equal(receipts.filter(Boolean).length, 2, 'both original fact ids reached the original Store')
})

test('outcome2: a pending native intent across detach is indeterminate and its old approval is rejected', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const payloadRef = ingress.putPayload({ kind: 'turn.ended', value: { nativeTurnRef: 'turn-detach', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json)
  const intentSeen = defer<void>()
  const releaseIntent = defer<{ allowed: boolean }>()
  const outcomes: string[] = []
  const freshSeen = defer<void>()
  const { h, endpoint } = await startWithEndpoint(t, ingress, async ({ hooks, io }) => {
    await io.record(h.fact({ factId: 'fact-detach', kind: 'turn.ended', payloadRef }))
    try {
      await hooks.beforeNativeWrite(answerCommand('cmd-detach'))
      outcomes.push('allowed')
    } catch (error) {
      outcomes.push((error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'refused'))
    }
    await freshSeen.promise
    try {
      await hooks.beforeNativeWrite(answerCommand('cmd-detach'))
      outcomes.push('fresh-allowed')
    } catch (error) {
      outcomes.push((error as { code?: string }).code ?? 'fresh-refused')
    }
    return { reason: 'terminal', evidenceRefs: ['detach'] }
  })
  h.command(h.begin('prepared-policy-detach'))

  const a = attach(h, ingress, endpoint, 'lease-detach-a', {
    nativeWrite: async () => {
      intentSeen.resolve()
      const decision = await releaseIntent.promise
      return decision
    },
  })
  const runningA = a.run({ pollMs: 5, deadlineMs: 15_000 }).catch(() => undefined)
  await intentSeen.promise

  // Successor takes over while the original caller's callback is still pending.
  const b = attach(h, ingress, endpoint, 'lease-detach-b', {
    nativeWrite: async () => ({ allowed: true }),
  })
  const runningB = b.run({ pollMs: 5, deadlineMs: 15_000 }).catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.deepEqual(outcomes, ['indeterminate'], 'the pending write does not migrate as allowed or as "not sent"')
  releaseIntent.resolve({ allowed: true })
  await new Promise(resolve => setTimeout(resolve, 150))
  // Its late approval cannot settle anything now: the caller reports the refusal, not a served write.
  assert.equal(a.served.nativeWrites, 0)
  assert.ok(a.served.errors >= 1 || a.served.refused >= 1)

  freshSeen.resolve()
  await h.done
  a.stop()
  b.stop()
  await Promise.all([runningA, runningB])
  assert.deepEqual(outcomes.slice(1), ['fresh-allowed'], 'a fresh intent needs and gets its own decision')
})

test('outcome2: terminal close fails a pending callback closed and refuses the late reply', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const payloadRef = ingress.putPayload({ kind: 'turn.ended', value: { nativeTurnRef: 'turn-terminal', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json)
  const storePending = defer<void>()
  const storeEntered = defer<void>()
  const outcomes: string[] = []
  const { h, endpoint } = await startWithEndpoint(t, ingress, async ({ io }) => {
    try {
      await io.record(h.fact({ factId: 'fact-terminal-caller', kind: 'turn.ended', payloadRef }))
      outcomes.push('acked')
    } catch (error) {
      outcomes.push((error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'refused'))
    }
    return { reason: 'cancelled', evidenceRefs: ['terminal'] }
  })
  h.command(h.begin('prepared-policy-terminal-caller'))

  const a = attach(h, ingress, endpoint, 'lease-terminal-caller', {
    fact: async fact => {
      storeEntered.resolve()
      await storePending.promise
      return ingress.sink.record(fact as never)
    },
  })
  const runningA = a.run({ pollMs: 5, deadlineMs: 12_000 }).catch(() => undefined)
  await storeEntered.promise
  h.send({ type: 'shutdown', id: 'shutdown-caller' })
  await new Promise(resolve => setTimeout(resolve, 120))
  storePending.resolve()
  await h.done
  a.stop()
  await runningA
  assert.deepEqual(outcomes, ['closed'], 'a terminal close fails the pending fact closed, never a fake ACK or "not sent"')
  assert.equal(a.served.facts, 0, 'the caller does not count a refused reply as served')
  // A new caller cannot bind or poll the terminal channel either.
  const late = attach(h, ingress, endpoint, 'lease-terminal-late')
  await assert.rejects(async () => late.pollOnce())
  assert.equal(await a.pollOnce(), false)
})
