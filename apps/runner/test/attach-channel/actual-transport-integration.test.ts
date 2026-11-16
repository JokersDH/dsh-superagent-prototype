/**
 * wave-32 I1 — the channel coexists with the original recovery transport.
 *
 * The same authenticated endpoint serves the channel callbacks (fact/payload/native) and the original
 * `facts(since,maxBytes)` pages and `payload(ref,offset,length)` chunks. This consumer records facts
 * through the channel, acknowledges them by their original ids, then reads the journal back with the
 * original seq order, sees the oversized fact surfaced by reference, and reassembles its payload from
 * chunks with the original digest.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { startService } from './actual-harness.ts'

test('I1: paged facts and chunked payloads coexist with channel ACKs', { timeout: 40000 }, async t => {
  const small = Array.from({ length: 6 }, (_, index) => ({
    kind: 'turn.ended',
    value: { nativeTurnRef: `turn-page-${index + 1}`, outcome: 'completed', candidateAvailable: true, evidenceRefs: [`e${index + 1}`] },
  }))
  // Schema-valid large payload: many legal evidence ids, no extra keys (the journal validates shape).
  const large = {
    kind: 'turn.ended',
    value: {
      nativeTurnRef: 'turn-page-large',
      outcome: 'completed',
      candidateAvailable: true,
      evidenceRefs: Array.from({ length: 300 }, (_, index) => `ev-${index}-${'x'.repeat(20)}`),
    },
  }
  const values = [...small, large]
  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      for (const [index, value] of values.entries()) {
        const ref = await io.payloads.store(value as Json, 'critical')
        await io.record(h.fact({ factId: `fact-page-${index + 1}`, kind: 'turn.ended', payloadRef: ref }))
      }
      return { reason: 'terminal', evidenceRefs: ['pages'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-page', 1)
  h.command(h.begin('prepared-policy-page'))

  const acked: string[] = []
  const deadline = Date.now() + 25_000
  while (acked.length < values.length) {
    if (Date.now() > deadline) throw new Error(`only ${acked.length} facts acked`)
    const page: any = await a.client.channelNext!('lease-page')
    const request = page?.request
    if (!request) {
      await new Promise(resolve => setTimeout(resolve, 5))
      continue
    }
    if (request.type !== 'fact') continue
    const factId = request.fact.factId as string
    const accepted = await a.client.channelReply!('lease-page', { v: 1, type: 'receipt', id: factId, factId, receipt: { factId, persisted: true, seq: acked.length + 1 } })
    assert.equal(accepted.accepted, true)
    acked.push(factId)
  }
  assert.equal(acked.length, values.length)
  await h.done

  // Follow the journal cursor until done; seq values stay the original contiguous order.
  const seqs: number[] = []
  const allFrames: any[] = []
  let cursor = 0
  let pages = 0
  for (let index = 0; index < 40; index += 1) {
    const page: any = await a.client.facts!(cursor, 2048)
    pages += 1
    for (const frame of page.frames) {
      seqs.push(Number(frame.seq))
      allFrames.push(frame)
    }
    if (page.done) break
    cursor = Number(page.next)
  }
  assert.equal(seqs.length, values.length)
  assert.deepEqual(seqs, [...seqs].sort((left, right) => left - right), 'cursors never reorder the journal')
  assert.equal(new Set(seqs).size, values.length)
  assert.ok(pages >= 1)

  // The oversized fact is surfaced by reference (payload null) with its byte count/digest.
  const entry = allFrames.find((frame: any) => String(frame.fact?.factId) === 'fact-page-7')
  assert.ok(entry)
  assert.equal(entry.payload, null, 'the large payload is delivered by reference')
  assert.ok(Number(entry.payloadBytes) > 2048)
  const payloadRef = String(entry.fact.payloadRef)
  assert.ok(payloadRef.startsWith('payload:'))

  // Chunked payload: reassemble bytes and compare the original digest and JSON value.
  const first = await a.client.payload!(payloadRef, 0, 512)
  const total = Number(first.total)
  assert.ok(total > 512)
  const chunks: Buffer[] = []
  for (let offset = 0; offset < total; offset += 512) chunks.push(Buffer.from((await a.client.payload!(payloadRef, offset, 512)).base64, 'base64'))
  const bytes = Buffer.concat(chunks)
  assert.equal(bytes.length, total)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), String(first.digest))
  assert.deepEqual(JSON.parse(bytes.toString('utf8')), large)
})

test('I1: an unmatched ACK leaves the fact pending for the original correlation only', { timeout: 30000 }, async t => {
  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 't-unmatched', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      await io.record(h.fact({ factId: 'fact-unmatched', kind: 'turn.ended', payloadRef: ref }))
      return { reason: 'terminal', evidenceRefs: ['unmatched'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-unmatched', 1)
  h.command(h.begin('prepared-policy-unmatched'))
  let factId: string | undefined
  for (let index = 0; index < 300; index += 1) {
    const page: any = await a.client.channelNext!('lease-unmatched')
    if (page?.request?.type === 'fact') {
      factId = page.request.fact.factId
      break
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(factId, 'fact-unmatched')
  // A receipt for another id cannot settle it.
  await assert.rejects(async () =>
    a.client.channelReply!('lease-unmatched', { v: 1, type: 'receipt', id: 'fact-other', factId: 'fact-other', receipt: { factId: 'fact-other', persisted: true, seq: 1 } })
  )
  // The original id still settles it.
  assert.equal((await a.client.channelReply!('lease-unmatched', { v: 1, type: 'receipt', id: 'fact-unmatched', factId: 'fact-unmatched', receipt: { factId: 'fact-unmatched', persisted: true, seq: 1 } })).accepted, true)
  await h.done
})
