/**
 * wave-36 line 3 — durable ACK across a lost reply, without a second ledger.
 *
 * A fact is persisted by the original Store but its receipt never reaches the Runner (the connection
 * is replaced before the reply). The successor re-reads the SAME request, re-records the SAME fact id
 * and receives the SAME Store row sequence, then acknowledges once. No fact id is invented, no row is
 * duplicated, and the journal/harness agree that the effect already happened.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CriticalFact, Json } from '../../../../packages/contracts/src/types.ts'
import { criticalFact } from '../../../../packages/driver-kit/src/attempt-io.ts'
import { makeAttemptSpec } from '../../../../packages/testing/src/index.ts'
import { openAttachClient } from '../../src/attach-channel/typed-client.ts'
import { openProductIngress } from './product-ingress-harness.ts'
import { startService } from './actual-harness.ts'

const VALUE = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-ack', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['ack'] } } as Json

async function waitFor<T>(read: () => Promise<T | undefined>, label: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`${label} did not arrive within ${timeoutMs}ms`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function factRequest(page: { request: unknown } | null): { id: string; fact: CriticalFact } {
  const request = page?.request as { type?: string; id?: string; fact?: unknown } | undefined
  if (!request || request.type !== 'fact' || typeof request.id !== 'string') throw new Error('expected a fact request')
  return { id: request.id, fact: request.fact as CriticalFact }
}

test('L3: a persisted fact whose receipt was lost is acknowledged once by the successor with the same row', { timeout: 45000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const spec = makeAttemptSpec()
  const source = 'fixture-driver'
  const seen: { driverSeq?: number } = {}
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })

  const h = await startService(t, {
    spec,
    source,
    runnerIdentityRef: 'runner-1',
    recovery: true,
    run: async ({ io }) => {
      const localRef = await io.payloads.store(VALUE, 'critical')
      // This await only resolves once SOME consumer acknowledges the fact; the first one persists but
      // never replies, so the successor is the one that completes it.
      seen.driverSeq = (await io.record(criticalFact(spec, { factId: 'factack', source, kind: 'turn.ended', payloadRef: localRef }))).seq
      await gate
      return { reason: 'terminal', evidenceRefs: ['durable-ack'] }
    },
  })
  // The Store must already hold the immutable payload the driver will reference (content addressed).
  ingress.putPayload(VALUE)
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const endpoint = await h.waitEndpoint()
  h.command(h.begin('prepared-policy-ack'))

  // First consumer: persist the fact, then vanish without a reply.
  const first = openAttachClient(endpoint, h.producer)
  const initial = await first.state()
  const firstPage = await waitFor(async () => {
    const page = await first.next('leaseacka', initial.generation)
    return page?.request ? page : undefined
  }, 'first fact request')
  const firstRequest = factRequest(firstPage)
  const firstReceipt = await ingress.sink.record(firstRequest.fact)
  assert.ok(Number.isSafeInteger(firstReceipt.seq) && firstReceipt.seq > 0)
  // No reply. The Store row exists; the Runner is still waiting.

  // Successor takes over the same run and sees the SAME request (original id), not a new fact.
  const second = openAttachClient(endpoint, h.producer)
  const takeover = await second.state()
  const secondPage = await waitFor(async () => {
    const page = await second.next('leaseackb', takeover.generation)
    return page?.request ? page : null
  }, 'requeued fact request')
  const secondRequest = factRequest(secondPage!)
  assert.equal(secondRequest.id, firstRequest.id, 'the successor receives the original fact id')
  assert.deepEqual(secondRequest.fact, firstRequest.fact, 'the fact body is byte-for-byte the original request')

  // Re-recording the same fact id is idempotent: the original Store returns its original row.
  const secondReceipt = await ingress.sink.record(secondRequest.fact)
  assert.equal(secondReceipt.seq, firstReceipt.seq, 'durable ACK is the same row, not a second effect')

  const reply = await second.reply('leaseackb', { v: 1, type: 'receipt', id: secondRequest.id, factId: secondRequest.fact.factId, receipt: secondReceipt })
  assert.equal(reply.accepted, true, 'the successor acknowledges the original request once')
  await waitFor(async () => (seen.driverSeq === undefined ? undefined : seen.driverSeq), 'driver receipt')

  assert.equal(seen.driverSeq, firstReceipt.seq, 'the Runner completed with the original Store row')
  const row = ingress.store.facts.get(firstRequest.fact.factId) as { seq?: number } | undefined
  assert.equal(row?.seq, firstReceipt.seq, 'the Store holds exactly that row')

  // Journal evidence: one entry for the fact, so the recovery source agrees with the Store.
  const page = await second.facts(0, 16_384)
  const frames = page.frames as Array<{ fact?: { factId?: string } }>
  assert.equal(frames.filter(frame => frame.fact?.factId === firstRequest.fact.factId).length, 1, 'the journal holds the fact once')

  release()
  await h.waitFrame(frame => frame.type === 'exited', 'exit after ack')
})
