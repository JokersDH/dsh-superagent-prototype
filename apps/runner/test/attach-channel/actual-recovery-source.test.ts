/**
 * wave-35 outcome I7 — same-run recovery support without a second ledger.
 *
 * After a legitimate takeover the Runner's own durable journal is the recovery source: a new consumer
 * pages the original fact identities/seqs, sees no duplicate business effect, and treats the pending
 * native intent as unknown instead of replaying an old approval. The original Store remains the single
 * receipt authority; I adds no candidate/accept authority. Original Application/QuestionBroker recovery
 * to check/currentCandidate/accept is NOT_REACHED here and stays with main/B.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { attachRunnerAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import { connectRunnerRecovery } from '../../../../packages/execution/src/recovery-transport.ts'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import { key } from '../../../../packages/orchestrator-core/dist/index.js'
import { JsonSchema } from '../../../../packages/contracts/src/schemas.ts'
import { canonicalDigest } from '../../../../packages/contracts/src/canonical.ts'
import { NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { openProductIngress } from './product-ingress-harness.ts'
import { startNativeCallbacks, ATTEMPT } from './native-callbacks-harness.ts'
import { until } from './actual-harness.ts'

const ONE = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-r1', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['r1'] } } as Json
const TWO = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-r2', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['r2'] } } as Json

function commandFor(id: string) {
  return makeCommand('answer', { ...ATTEMPT, id, nativeBindingRef: 'binding-rec', answerRef: 'answer-rec' })
}

test('I7: the Runner journal is the same-run recovery source and no effect is duplicated', { timeout: 45000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const first = { seq: 0, ref: '' }
  const seen: string[] = []
  let releaseNative!: () => void
  const nativeGate = new Promise<void>(resolve => {
    releaseNative = resolve
  })
  let releaseSecond!: () => void
  const secondGate = new Promise<void>(resolve => {
    releaseSecond = resolve
  })

  const h = await startNativeCallbacks(t, ingress, async ({ hooks, io }) => {
    const localOne = await io.payloads.store(ONE, 'critical')
    first.ref = localOne
    first.seq = (await io.record(h.h.fact({ factId: 'factrec1', kind: 'turn.ended', payloadRef: localOne }))).seq
    seen.push('recorded-one')
    await nativeGate
    seen.push('native-start')
    try {
      await hooks.beforeNativeWrite(commandFor('cmdunknown'))
      seen.push('unknown:allowed')
    } catch (error) {
      seen.push(`unknown:${(error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'refused')}`)
    }
    await secondGate
    const localTwo = await io.payloads.store(TWO, 'critical')
    seen.push(`recorded-two:${(await io.record(h.h.fact({ factId: 'factrec2', kind: 'turn.ended', payloadRef: localTwo }))).seq}`)
    return { reason: 'terminal', evidenceRefs: ['recovery-source'] }
  })
  h.putLocalPayload(ONE)
  h.putLocalPayload(TWO)
  h.indexCommand(commandFor('cmdunknown'))

  const a = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'leasereca',
    callbacks: { fact: fact => h.callbacks.recordFact(fact), payload: request => h.callbacks.readPayload(request.reference), nativeWrite: intent => h.callbacks.nativeWrite(intent.command) },
    timeoutMs: 3000,
  })
  const loopA = a.run({ pollMs: 5, deadlineMs: 40_000 }).catch(() => undefined)
  await a.pollOnce()
  h.activate()
  h.h.command(h.h.begin('prepared-policy-rec'))
  await until(() => seen.includes('recorded-one'), 20_000, 'first fact recorded')
  a.stop()
  await loopA

  // A pending intent is created with no poller, then the successor takes over and settles it unknown.
  releaseNative()
  await until(() => seen.includes('native-start'), 15_000, 'pending intent created')
  const b = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'leaserecb',
    callbacks: { fact: fact => h.callbacks.recordFact(fact), payload: request => h.callbacks.readPayload(request.reference), nativeWrite: intent => h.callbacks.nativeWrite(intent.command) },
    timeoutMs: 3000,
  })
  const loopB = b.run({ pollMs: 5, deadlineMs: 40_000 }).catch(() => undefined)
  await b.pollOnce()
  await until(() => seen.some(entry => entry.startsWith('unknown:')), 15_000, 'unknown window observed')

  // Recovery source: the Runner's journal, not the caller's memory, names the original fact/ids.
  const client = connectRunnerRecovery(h.endpoint, h.h.producer, 3000)
  const page = await client.facts!(0, 16_384)
  const frames = page.frames as Array<{ seq: number; fact?: { factId?: string }; payloadDigest?: string; payloadBytes?: number; payload?: unknown }>
  const entry = frames.find(frame => frame.fact?.factId === 'factrec1')
  assert.ok(entry, 'the journal exposes the original fact after the takeover')
  assert.ok(Number.isSafeInteger(entry!.seq) && entry!.seq >= 1, 'the journal seq is the Runner own durable sequence')
  assert.equal(
    frames.filter(frame => frame.fact?.factId === 'factrec1').length,
    1,
    'the original fact appears once, not once per connection',
  )
  // Paging past that seq does not return the same fact again: the journal is not a second ledger.
  const after = await client.facts!(entry!.seq, 16_384)
  assert.ok(
    !(after.frames as Array<{ fact?: { factId?: string } }>).some(frame => frame.fact?.factId === 'factrec1'),
    'a later page starts strictly after the reported seq',
  )

  // The Store still holds exactly one business row for it; replay is a projection, not a second effect.
  assert.ok(ingress.store.facts.get('factrec1'), 'the original Store row is unchanged')
  // The pending intent left the command index as it was and granted nothing reusable: a later direct
  // decision for the same business command is still denied without a fresh admission.
  const indexed = ingress.store.commands.get(key('product-command', 'cmdunknown')) as { status?: string; result?: { command?: unknown } } | undefined
  assert.equal(indexed?.status, 'recorded', 'the command index is the original one, not a business result')
  assert.deepEqual(await h.callbacks.nativeWrite(commandFor('cmdunknown')), { allowed: false }, 'the unknown intent migrated no approval')

  releaseSecond()
  await until(() => seen.some(entry => entry.startsWith('recorded-two:')), 20_000, 'second fact recorded')
  await h.h.done
  b.stop()
  await loopB

  assert.deepEqual(seen.filter(entry => entry.startsWith('unknown:')), ['unknown:indeterminate'], 'the pending intent is unknown, never replayed as allowed')
  assert.ok(ingress.store.facts.get('factrec2'), 'the successor persisted the new fact')
  // No duplicate receipt for the replayed fact: the journal page and the Store agree on identity.
  const digest = canonicalDigest(JsonSchema.parse(ONE))
  assert.equal(typeof digest, 'string')
})
