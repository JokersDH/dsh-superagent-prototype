/**
 * wave-35 outcome I5 — original ids, kind namespace and journal/payload coexistence.
 *
 * A fact id can equal a payload request id: they are different kinds and must never settle each other.
 * The journal descriptor path (seq/bytes/digest, by reference for a large payload) and the original
 * payload callback (the body itself) are separate protocols over the same immutable bytes, and a
 * settled request leaves no ghost in the queue.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { attachRunnerAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import { connectRunnerRecovery } from '../../../../packages/execution/src/recovery-transport.ts'
import { openProductIngress } from './product-ingress-harness.ts'
import { startNativeCallbacks } from './native-callbacks-harness.ts'
import { until } from './actual-harness.ts'

const SMALL = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-id', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['e-id'] } } as Json
const LARGE = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-journal', outcome: 'completed', candidateAvailable: true, evidenceRefs: Array.from({ length: 300 }, (_, index) => `evidence-${index}`) } } as Json

test('I5: a fact id equal to a payload request id never settles the other kind', { timeout: 45000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const seen: { body?: unknown; receipt?: number } = {}
  const storedRef = ingress.putPayload({ stored: 'another-kind' } as Json)
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })

  const h = await startNativeCallbacks(t, ingress, async ({ io }) => {
    const localRef = await io.payloads.store(SMALL, 'critical')
    // Concurrent, same raw id: the payload request is `payload-1`, the fact id is chosen to match it.
    const [body, receipt] = await Promise.all([
      io.payloads.read(storedRef),
      io.record(h.h.fact({ factId: 'payload-1', kind: 'turn.ended', payloadRef: localRef })),
    ])
    seen.body = body
    seen.receipt = receipt.seq
    // Stay alive so the duplicate-reply checks below are about settlement, not terminal closure.
    await gate
    return { reason: 'terminal', evidenceRefs: ['namespace'] }
  })
  h.putLocalPayload(SMALL)

  const consumer = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'leaseids',
    callbacks: {
      fact: fact => h.callbacks.recordFact(fact),
      payload: request => h.callbacks.readPayload(request.reference),
      nativeWrite: intent => h.callbacks.nativeWrite(intent.command),
    },
    timeoutMs: 3000,
  })
  const loop = consumer.run({ pollMs: 5, deadlineMs: 30_000 }).catch(() => undefined)
  await consumer.pollOnce()
  h.activate()
  h.h.command(h.h.begin('prepared-policy-ids'))
  await until(() => seen.receipt !== undefined, 20000, 'both same-id requests settled')

  assert.deepEqual(seen.body, { stored: 'another-kind' }, 'the payload reply carried the payload body')
  assert.ok(Number.isSafeInteger(seen.receipt) && seen.receipt! > 0, 'the fact reply carried a Store receipt')
  assert.ok(ingress.store.facts.get('payload-1'), 'the fact is persisted under the original id')
  assert.equal(consumer.served.facts, 1)
  assert.equal(consumer.served.payloads, 1)
  assert.equal(consumer.served.refused, 0, 'the transport never treated the colliding id as a foreign frame')

  // A duplicate late receipt/payload for the settled ids is refused; nothing is settled twice.
  const client = connectRunnerRecovery(h.endpoint, h.h.producer, 3000)
  await assert.rejects(async () => client.channelReply!('leaseids' as never, {
    v: 1, type: 'receipt', id: 'payload-1', factId: 'payload-1',
    receipt: { factId: 'payload-1', persisted: true, seq: seen.receipt },
  } as never), (error: unknown) => {
    assert.equal((error as { serverError?: string }).serverError, 'stale_lease', 'a second receipt cannot settle the same fact')
    return true
  })
  await assert.rejects(async () => client.channelReply!('leaseids' as never, {
    v: 1, type: 'payload', id: 'payload-1', requestId: 'payload-1', value: { stored: 'another-kind' },
  } as never), (error: unknown) => {
    assert.equal((error as { serverError?: string }).serverError, 'stale_lease', 'a second payload reply cannot settle the same read')
    return true
  })
  release()
  await h.h.done
  consumer.stop()
  await loop
})

test('I5: journal descriptor, chunked bytes and the original payload body agree', { timeout: 45000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const h = await startNativeCallbacks(t, ingress, async ({ io }) => {
    const localRef = await io.payloads.store(LARGE, 'critical')
    await io.record(h.h.fact({ factId: 'factjournal', kind: 'turn.ended', payloadRef: localRef }))
    await gate
    return { reason: 'terminal', evidenceRefs: ['journal'] }
  })
  h.putLocalPayload(LARGE)

  const consumer = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'leasejournal',
    callbacks: { fact: fact => h.callbacks.recordFact(fact), payload: request => h.callbacks.readPayload(request.reference), nativeWrite: intent => h.callbacks.nativeWrite(intent.command) },
    timeoutMs: 3000,
  })
  const loop = consumer.run({ pollMs: 5, deadlineMs: 30_000 }).catch(() => undefined)
  await consumer.pollOnce()
  h.activate()
  h.h.command(h.h.begin('prepared-policy-journal'))
  await until(() => ingress.store.facts.get('factjournal') !== undefined, 20000, 'journal fact persisted')

  const client = connectRunnerRecovery(h.endpoint, h.h.producer, 3000)
  // A small page budget forces the oversized payload onto the by-reference descriptor path.
  const page = await client.facts!(0, 4096)
  const entry = page.frames.find(frame => (frame as { fact?: { factId?: string } }).fact?.factId === 'factjournal') as
    | { seq: number; payload: null; payloadRef: string; payloadBytes: number; payloadDigest: string }
    | undefined
  assert.ok(entry, 'the journal page exposes the fact')
  assert.equal(entry!.payload, null, 'the large payload is delivered by reference, not inline')
  assert.ok(entry!.payloadBytes > 4096, 'the descriptor reports the real byte length')

  // Reconstruct the payload from bounded chunks and compare with the descriptor digest.
  const chunks: Buffer[] = []
  for (let offset = 0; ; ) {
    const chunk = await client.payload!(entry!.payloadRef, offset, 4096)
    const bytes = Buffer.from(chunk.base64, 'base64')
    chunks.push(bytes)
    offset += bytes.length
    assert.equal(chunk.total, entry!.payloadBytes, 'the chunk reader reports the same total')
    if (offset >= chunk.total) break
  }
  const bytes = Buffer.concat(chunks)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry!.payloadDigest, 'chunk bytes reproduce the descriptor digest')
  assert.deepEqual(JSON.parse(bytes.toString('utf8')), LARGE, 'the reassembled payload is the original body')

  // The original callback reads the same immutable bytes through the Store, not through chunks.
  assert.deepEqual(await h.callbacks.readPayload(entry!.payloadRef), LARGE)

  // After settlement the queue holds no ghost for either kind.
  const state = await client.channelState!()
  const next = await client.channelNext!('leasejournal' as never, state.generation as never)
  assert.equal(next!.request, null, 'no settled request is re-delivered')

  release()
  await h.h.done
  consumer.stop()
  await loop
})
