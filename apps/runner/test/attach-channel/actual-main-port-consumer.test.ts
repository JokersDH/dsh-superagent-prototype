/**
 * wave-33 outcome 1 — main's real attach port/caller with the real Store ingress.
 *
 * The consumer is main's `attachRunnerAttempt` (`packages/execution/src/attached-attempt.ts`) fed with
 * an `AttachedAttemptPort`-shaped registration (endpoint + producer, the same data the optional
 * `RunningAttempt.attachPort` returns). It serves the three original callbacks through the real
 * ProductStore ingress, the original immutable payload reader and a store-backed fresh guard. The port
 * is registration data only: nothing here grants a native write, and the guard is consulted per intent.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AttachedAttemptPort } from '../../../../packages/execution/src/contracts.ts'
import { attachRunnerAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import { key } from '../../../../packages/orchestrator-core/dist/index.js'
import { JsonSchema } from '../../../../packages/contracts/src/schemas.ts'
import { canonicalDigest } from '../../../../packages/contracts/src/canonical.ts'
import { producer as fixtureProducer } from '../../../../tests/integration/runtime-ingress-fixture.ts'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { startService } from './actual-harness.ts'
import { openProductIngress, type ProductIngress } from './product-ingress-harness.ts'
import { answerCommand } from './fixtures.ts'

const ATTEMPT = fixtureProducer.attempt

function recordCommand(ingress: ProductIngress, commandId: string): void {
  const command = { ...ATTEMPT, kind: 'answer' as const, id: commandId, nativeBindingRef: 'binding-1', answerRef: 'answer-1' }
  ingress.store.commands.record(key('product-command', commandId), canonicalDigest(JsonSchema.parse(command)), () => ({ command }))
}

function storeGuard(ingress: ProductIngress, live: Set<string>) {
  const calls: string[] = []
  return {
    calls,
    guard: async (intent: { command: { id: string; [key: string]: unknown } }) => {
      calls.push(intent.command.id)
      const current = ingress.store.bindings.binding(ATTEMPT.attemptId) as { state?: string } | undefined
      if (!current || current.state !== 'active') return { allowed: false, reason: 'binding_not_current' }
      const indexed = ingress.store.commands.get(key('product-command', intent.command.id))?.result as { command?: unknown } | undefined
      if (!indexed?.command || canonicalDigest(JsonSchema.parse(indexed.command)) !== canonicalDigest(JsonSchema.parse(intent.command)))
        return { allowed: false, reason: 'command_mismatch' }
      if (!live.has(intent.command.id)) return { allowed: false, reason: 'no_live_admission' }
      live.delete(intent.command.id)
      return { allowed: true }
    },
  }
}

async function startCaller(t: import('node:test').TestContext, ingress: ProductIngress, options: {
  leaseId: string
  live?: Set<string>
  withGuard?: boolean
  withPayload?: boolean
  source?: string
  record?: { factId: string } | undefined
}) {
  const value = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-main-port', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['evidence-main-port'] } } as Json
  const payloadRef = ingress.putPayload(value)
  const seen: { body?: unknown; receipts: Array<{ factId: string; seq: number }>; intents: string[] } = { receipts: [], intents: [] }
  const guardCounter = options.live ? storeGuard(ingress, options.live) : { calls: [] as string[], guard: async () => ({ allowed: false, reason: 'no_live_admission' }) }
  recordCommand(ingress, 'cmd-main-port')

  const h = await startService(t, {
    source: fixtureProducer.source,
    runnerIdentityRef: fixtureProducer.runnerIdentityRef,
    recovery: true,
    sink: ingress.sink,
    payloads: ingress.payloads,
    run: async ({ hooks, io }) => {
      // The Runner has no local copy: both reads go through the original payload reference/body path.
      seen.body = await io.payloads.read(payloadRef)
      await io.record(h.fact({ factId: options.record?.factId ?? 'fact-main-port', kind: 'turn.ended', payloadRef }))
      try {
        await hooks.beforeNativeWrite(answerCommand('cmd-main-port'))
        seen.intents.push('allowed')
      } catch (error) {
        seen.intents.push((error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'refused'))
      }
      return { reason: 'terminal', evidenceRefs: ['main-port'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')

  // This is exactly the shape `RunningAttempt.attachPort` returns; the caller itself invents nothing.
  const port: AttachedAttemptPort = {
    registration: await h.waitEndpoint(),
    producer: { ...h.producer, source: options.source ?? h.producer.source },
  }
  const attached = attachRunnerAttempt({
    endpoint: port.registration,
    producer: port.producer,
    leaseId: options.leaseId,
    callbacks: {
      fact: async fact => {
        const receipt = await ingress.sink.record(fact)
        seen.receipts.push({ factId: receipt.factId, seq: receipt.seq })
        return receipt
      },
      ...(options.withPayload === false ? {} : { payload: async request => {
        assert.match(request.reference, /^payload:/)
        return ingress.payloads.read(request.reference)
      } }),
      ...(options.withGuard === false ? {} : { nativeWrite: guardCounter.guard }),
    },
    timeoutMs: 3000,
  })
  h.command(h.begin('prepared-policy-main-port'))
  const running = attached.run({ pollMs: 5, deadlineMs: 15_000 }).catch(() => undefined)
  await h.done
  attached.stop()
  await running
  return { h, attached, seen, guardCounter, value, payloadRef }
}

test('outcome1: main port+caller serve fact/payload/intent with real receipts and a per-intent guard', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const live = new Set(['cmd-main-port'])
  const { attached, seen, guardCounter, value } = await startCaller(t, ingress, { leaseId: 'lease-main-port', live })

  assert.deepEqual(seen.body, value, 'payload-read returns the original JSON body, not a chunk envelope')
  assert.deepEqual(seen.receipts.map(receipt => receipt.factId), ['fact-main-port'])
  const stored = ingress.store.facts.get('fact-main-port') as { seq?: number } | undefined
  assert.ok(stored, 'the original ingress persisted the fact')
  assert.equal(stored!.seq, seen.receipts[0]!.seq, 'the receipt is the original Store row sequence')
  assert.deepEqual(guardCounter.calls, ['cmd-main-port'], 'every intent asks the original guard once')
  assert.deepEqual(seen.intents, ['allowed'])
  assert.equal(attached.served.facts, 1)
  assert.ok(attached.served.payloads >= 1)
  assert.equal(attached.generation >= 2, true)
})

test('outcome1: a denying guard and a missing guard both leave zero native writes', { timeout: 40000 }, async t => {
  const denied = openProductIngress()
  const missing = openProductIngress()
  t.after(() => {
    denied.close()
    missing.close()
  })
  const deniedRun = await startCaller(t, denied, { leaseId: 'lease-denied', live: new Set() })
  assert.deepEqual(deniedRun.seen.intents, ['native_write_denied'])
  assert.deepEqual(deniedRun.guardCounter.calls, ['cmd-main-port'])
  const missingRun = await startCaller(t, missing, { leaseId: 'lease-missing', withGuard: false })
  assert.deepEqual(missingRun.seen.intents, ['native_write_denied'])
})

test('outcome1: a foreign producer cannot bind the port registration', { timeout: 30000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const h = await startService(t, {
    source: fixtureProducer.source,
    runnerIdentityRef: fixtureProducer.runnerIdentityRef,
    recovery: true,
    run: async () => ({ reason: 'terminal', evidenceRefs: ['foreign-port'] }),
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const port: AttachedAttemptPort = { registration: await h.waitEndpoint(), producer: { ...h.producer, source: 'intruder-source' } }
  const attached = attachRunnerAttempt({
    endpoint: port.registration,
    producer: port.producer,
    leaseId: 'lease-foreign',
    callbacks: { fact: async fact => ingress.sink.record(fact) },
  })
  await assert.rejects(async () => attached.pollOnce())
})

test('outcome1: without a payload callback the caller refuses the read instead of inventing a body', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const value = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-no-payload', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json
  const payloadRef = ingress.putPayload(value)
  const h = await startService(t, {
    source: fixtureProducer.source,
    runnerIdentityRef: fixtureProducer.runnerIdentityRef,
    recovery: true,
    sink: ingress.sink,
    payloads: ingress.payloads,
    run: async ({ io }) => {
      await io.payloads.read(payloadRef).catch(() => undefined)
      return { reason: 'terminal', evidenceRefs: ['no-payload'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const port: AttachedAttemptPort = { registration: await h.waitEndpoint(), producer: h.producer }
  const attached = attachRunnerAttempt({ endpoint: port.registration, producer: port.producer, leaseId: 'lease-no-payload', callbacks: { fact: async fact => ingress.sink.record(fact) } })
  h.command(h.begin('prepared-policy-no-payload'))
  const running = attached.run({ pollMs: 5, deadlineMs: 8000 }).catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 600))
  attached.stop()
  await running
  assert.ok(attached.served.refused >= 1 || attached.served.errors >= 1, 'the caller reports the refusal, never a fabricated payload')
})
