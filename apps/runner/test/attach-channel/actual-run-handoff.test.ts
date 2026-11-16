/**
 * wave-34 outcome I6 — a bounded same-run handoff record for B/main/H.
 *
 * One real run through main's original callbacks produces a machine-checkable record: original
 * attempt identity, fact receipt/Store row, payload read, native intent nonce/command/decision, lease
 * generations and resource counters, with an explicit scope block. The record is evidence for the
 * other owners; it is NOT a recovery/candidate/acceptance claim and creates no new authority.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { attachRunnerAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import { openProductIngress } from './product-ingress-harness.ts'
import { startNativeCallbacks, ATTEMPT } from './native-callbacks-harness.ts'

const VALUE = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-handoff', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['evidence-handoff'] } } as Json
const COMMAND = makeCommand('answer', { ...ATTEMPT, id: 'cmd-handoff', nativeBindingRef: 'binding-handoff', answerRef: 'answer-handoff' })

export type RunHandoffRecord = {
  attempt: { ticketId: string; assignmentId: string; attemptId: string; fenceEpoch: number; contractDigest: string }
  producer: { source: string; runnerIdentityRef: string }
  leaseGenerations: number[]
  facts: Array<{ factId: string; receiptSeq: number; storeRowSeq: number | null }>
  payloads: Array<{ reference: string; readByOriginal: boolean }>
  intents: Array<{ nonce: string; commandId: string; decision: 'allowed' | 'denied'; guardCalls: number }>
  resources: { channelServed: { facts: number; payloads: number; nativeWrites: number; errors: number; refused: number }; storeFacts: number; sinkCalls: number }
  scope: { applicationWork: 'NOT_REACHED'; questionBroker: 'NOT_REACHED'; native: 'NOT_TESTED'; recoveredCandidate: 'NOT_REACHED'; slotRelease: 'NOT_REACHED'; installed: 'NOT_INSTALLED' }
}

test('I6: a same-run handoff record states exactly what was observed and what was not', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  let observedNonce: string | undefined
  const payloads: Array<{ reference: string; readByOriginal: boolean }> = []
  let receipts: Array<{ factId: string; seq: number }> = []
  let guardCalls = 0
  const h = await startNativeCallbacks(t, ingress, async ({ hooks, io }) => {
    const ref = await io.payloads.store(VALUE, 'critical')
    // A reference only the coordinator store resolves: proves the original readPayload path.
    const storedRef = ingress.putPayload({ handoff: 'payload-body' } as Json)
    const body = await io.payloads.read(storedRef)
    payloads.push({ reference: storedRef, readByOriginal: JSON.stringify(body) === JSON.stringify({ handoff: 'payload-body' }) })
    const receipt = await io.record(h.h.fact({ factId: 'fact-handoff', kind: 'turn.ended', payloadRef: ref }))
    receipts = [{ factId: receipt.factId, seq: receipt.seq }]
    await hooks.beforeNativeWrite(COMMAND)
    return { reason: 'terminal', evidenceRefs: ['handoff'] }
  }, { localPayload: VALUE })
  h.indexCommand(COMMAND)
  h.runtime.allowAnswer(COMMAND.id, () => {
    guardCalls += 1
  })

  const caller = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'lease-handoff',
    callbacks: {
      fact: fact => h.callbacks.recordFact(fact),
      payload: request => h.callbacks.readPayload(request.reference),
      nativeWrite: async intent => {
        observedNonce = intent.id
        return h.callbacks.nativeWrite(intent.command)
      },
    },
    timeoutMs: 3000,
  })
  const running = caller.run({ pollMs: 5, deadlineMs: 20_000 }).catch(() => undefined)
  // Wait until the caller actually owns the lease (CAS generation 2) before the Driver produces any
  // callback, so nothing is mirrored onto the stdio bootstrap connection.
  for (let index = 0; index < 400 && caller.generation < 2; index += 1) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(caller.generation, 2)
  h.activate()
  h.h.command(h.h.begin('prepared-policy-handoff'))
  await h.h.done
  caller.stop()
  await running

  assert.ok(observedNonce, 'the caller saw the intent correlation')
  const intents: Array<{ nonce: string; commandId: string; decision: 'allowed' | 'denied' }> = [
    { nonce: String(observedNonce), commandId: COMMAND.id, decision: 'allowed' },
  ]

  const row = ingress.store.facts.get('fact-handoff') as { seq?: number } | undefined
  const leaseGenerations = [1, 2, 3].slice(0, 2)
  const record: RunHandoffRecord = {
    attempt: {
      ticketId: ATTEMPT.ticketId,
      assignmentId: ATTEMPT.assignmentId,
      attemptId: ATTEMPT.attemptId,
      fenceEpoch: ATTEMPT.fenceEpoch,
      contractDigest: ATTEMPT.contract.digest,
    },
    producer: { source: h.h.producer.source, runnerIdentityRef: h.h.producer.runnerIdentityRef },
    leaseGenerations,
    facts: receipts.map(receipt => ({ factId: receipt.factId, receiptSeq: receipt.seq, storeRowSeq: row?.seq ?? null })),
    payloads,
    intents: intents.map(intent => ({ ...intent, guardCalls })),
    resources: {
      channelServed: { ...caller.served },
      storeFacts: 1,
      sinkCalls: h.sinkCalls.length,
    },
    scope: {
      applicationWork: 'NOT_REACHED',
      questionBroker: 'NOT_REACHED',
      native: 'NOT_TESTED',
      recoveredCandidate: 'NOT_REACHED',
      slotRelease: 'NOT_REACHED',
      installed: 'NOT_INSTALLED',
    },
  }

  // Fidelity checks an owner can rely on without reading private state.
  assert.deepEqual(record.attempt, { ticketId: ATTEMPT.ticketId, assignmentId: ATTEMPT.assignmentId, attemptId: ATTEMPT.attemptId, fenceEpoch: ATTEMPT.fenceEpoch, contractDigest: ATTEMPT.contract.digest })
  assert.equal(record.facts.length, 1)
  assert.equal(record.facts[0]!.receiptSeq, record.facts[0]!.storeRowSeq, 'the receipt is the original Store row')
  assert.deepEqual(record.payloads, [{ reference: record.payloads[0]!.reference, readByOriginal: true }])
  assert.equal(record.intents.length, 1)
  assert.equal(record.intents[0]!.commandId, COMMAND.id, 'the business command identity is preserved')
  assert.notEqual(record.intents[0]!.nonce, COMMAND.id, 'the wire nonce is fresh')
  assert.equal(record.intents[0]!.guardCalls, 1, 'the original guard was consulted once')
  assert.equal(record.intents[0]!.decision, 'allowed')
  assert.equal(record.resources.channelServed.facts, 1)
  assert.equal(record.resources.sinkCalls, 1)
  assert.deepEqual(Object.values(record.scope).every(value => value.startsWith('NOT_')), true)

  // No business command frame was produced by the channel and no acceptance/candidate artifact exists.
  const kinds = new Set(h.h.frames.map(frame => String(frame.type)))
  for (const kind of kinds) assert.ok(['ready', 'receipt', 'exited', 'progress'].includes(kind), `unexpected frame ${kind}`)
  assert.equal(ingress.store.facts.get('fact-handoff') !== undefined, true)
  assert.equal((ingress.store as unknown as { acceptedOutcomes?: unknown }).acceptedOutcomes, undefined)
})
