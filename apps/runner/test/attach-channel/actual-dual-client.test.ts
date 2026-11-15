/**
 * wave-31 I4 — the same original attempt continues across two authenticated clients.
 *
 * Real service, real Unix endpoint, real `connectRunnerRecovery` clients. Client A binds by explicit
 * CAS and serves the first callback; client B takes over with the next generation while the attempt is
 * still live; A can neither poll nor answer afterwards, and nothing is mirrored onto the replaced
 * stdio writer.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { startService } from './actual-harness.ts'
import { connectRunnerRecovery } from '../../../../packages/execution/src/recovery-transport.ts'

type Page = { generation: number; request: { type: string; id?: string; requestId?: string; fact?: { factId?: string } } | null }

async function serveOne(client: ReturnType<typeof connectRunnerRecovery>, leaseId: string, seen: string[]): Promise<boolean> {
  const page = (await client.channelNext!(leaseId)) as Page
  if (!page.request) return false
  const request = page.request
  if (request.type === 'fact') {
    const factId = String(request.fact?.factId ?? request.id)
    seen.push(factId)
    const reply = await client.channelReply!(leaseId, { v: 1, type: 'receipt', id: factId, factId, receipt: { factId, persisted: true, seq: seen.length } })
    return reply.accepted
  }
  return false
}

test('I4: client B takes over by CAS and continues the same attempt; A is fenced out', { timeout: 30000 }, async t => {
  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 't-dual', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      await io.record(h.fact({ factId: 'fact-dual-1', kind: 'turn.ended', payloadRef: ref }))
      await io.record(h.fact({ factId: 'fact-dual-2', kind: 'turn.ended', payloadRef: ref }))
      return { reason: 'terminal', evidenceRefs: ['dual'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')

  const a = await h.connect('lease-a', 1)
  assert.equal(a.bound.generation, 2)
  h.command(h.begin('prepared-policy-i31-dual'))

  // A serves the first callback on its own lease.
  const servedByA: string[] = []
  await drain(a.client, 'lease-a', servedByA, 8000, 'first fact served by A')
  assert.deepEqual(servedByA, ['fact-dual-1'])
  assert.deepEqual(h.framesOf('fact'), [], 'callbacks are never mirrored onto the replaced stdio writer')

  // B is a new authenticated client of the SAME attempt; CAS with the current generation.
  const state = await a.client.channelState!()
  assert.equal(state.generation, 2)
  const boundB = await a.client.channelNext!('lease-b', state.generation)
  assert.equal(boundB.generation, 3)

  // A is fenced out: it can neither poll nor answer, and the old generation cannot be reused to bind.
  await assert.rejects(async () => a.client.channelNext!('lease-a', 1))
  // The transport reports a refused reply as a 409 stale_lease; either way it never settles anything.
  await assert.rejects(async () =>
    a.client.channelReply!('lease-a', { v: 1, type: 'receipt', id: 'fact-dual-1', factId: 'fact-dual-1', receipt: { factId: 'fact-dual-1', persisted: true, seq: 9 } })
  )

  // B continues the same attempt and settles the second fact with its original id.
  const servedByB: string[] = []
  await drain(a.client, 'lease-b', servedByB, 8000, 'second fact served by B')
  assert.deepEqual(servedByB, ['fact-dual-2'])
  assert.equal((await h.done).reason, 'terminal')
})

test('I4: a foreign producer cannot bind or poll the current lease', { timeout: 20000 }, async t => {
  const h = await startService(t, { recovery: true, run: async () => ({ reason: 'terminal', evidenceRefs: ['foreign'] }) })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const endpoint = await h.waitEndpoint()
  const foreign = connectRunnerRecovery(endpoint, { ...h.producer, source: 'intruder-source' }, 3000)
  await assert.rejects(async () => foreign.channelState!())
  await assert.rejects(async () => foreign.channelNext!('lease-foreign', 1))
  assert.equal(h.framesOf('fact').length, 0)
})

/** Poll the lease until one callback was served, bounded by a deadline. */
async function drain(client: ReturnType<typeof connectRunnerRecovery>, leaseId: string, seen: string[], timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (seen.length === 0) {
    if (Date.now() > deadline) throw new Error(`${label} did not complete within ${timeoutMs}ms`)
    if (!(await serveOne(client, leaseId, seen))) await new Promise(resolve => setTimeout(resolve, 10))
  }
}
