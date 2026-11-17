/**
 * wave-36 line 1 — the callback lease and physical finalization are separate authorities.
 *
 * After a natural terminal the attach channel is closed: no late receipt/payload/admission, no rebind.
 * That refusal says nothing about physical completion. The authenticated control endpoint still reports
 * `state: terminated` with `admission: open`, and an explicit cancel is what finalizes admission. A
 * candidate that refuses this no-lease physical cancel breaks main's `waitExit → quiesce` completion
 * path (B35/B36 compatibility finding, B-owned); the channel must not be relaxed to work around it.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RunnerCommand } from '../../../../packages/contracts/src/types.ts'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import { openAttachClient } from '../../src/attach-channel/typed-client.ts'
import { startService } from './actual-harness.ts'

function cancelFor(h: { spec: ReturnType<typeof import('../../../../packages/testing/src/index.ts').makeAttemptSpec> }, id: string): Extract<RunnerCommand, { kind: 'cancel' }> {
  const command = makeCommand('cancel', {
    ticketId: h.spec.ticketId,
    assignmentId: h.spec.assignmentId,
    attemptId: h.spec.attemptId,
    fenceEpoch: h.spec.fenceEpoch,
    contract: h.spec.contract,
    id,
  })
  if (command.kind !== 'cancel') throw new Error('expected a cancel command')
  return command
}

test('L1: natural terminal closes callbacks while physical control stays a separate step', { timeout: 45000 }, async t => {
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const h = await startService(t, {
    recovery: true,
    run: async () => {
      await gate
      return { reason: 'terminal', evidenceRefs: ['natural-terminal'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const client = openAttachClient(await h.waitEndpoint(), h.producer)

  const initial = await client.state()
  const page = await client.next('leaseterminal', initial.generation)
  assert.equal(page!.request, null, 'the owner bound an empty channel')

  // Start the attempt so the driver runs, then let it finish on its own.
  h.command(h.begin('prepared-policy-terminal'))
  release()
  await h.waitFrame(frame => frame.type === 'exited', 'natural exit')

  // The callback channel is terminal: no poll, no rebind with a stale or fresh generation. The exit
  // frame is written just before `finish()`, so wait (bounded) for the closure rather than assume it.
  const closedBy = Date.now() + 5000
  for (;;) {
    try {
      await client.next('leaseterminal', initial.generation + 1)
      if (Date.now() > closedBy) assert.fail('the channel never closed after the natural exit')
      await new Promise(resolve => setTimeout(resolve, 10))
    } catch {
      break
    }
  }
  for (const lease of ['leaseterminal', 'leaseother']) {
    await assert.rejects(async () => client.next(lease, initial.generation + 1), (error: unknown) => {
      const code = (error as { code?: string }).code
      assert.ok(code === 'stale_connection' || code === 'refused' || code === 'closed', `post-terminal poll refused (got ${String(code)})`)
      return true
    })
  }

  // Physical state is a different projection: terminated but admission not yet finalized.
  const before = await client.inspect()
  assert.equal(before.state, 'terminated')
  assert.equal(before.admission, 'open', 'a closed callback channel is not a finalized admission')

  // An explicit physical cancel finalizes admission and stays idempotent; it is not a lease operation.
  const finalized = await client.cancel(cancelFor(h, 'cmdcancel'))
  assert.equal(finalized.state, 'terminated')
  assert.equal(finalized.admission, 'closed')
  const again = await client.cancel(cancelFor(h, 'cmdcancel2'))
  assert.equal(again.admission, 'closed', 'a repeated finalization is harmless')
  assert.equal(again.state, 'terminated')

  // Generation observation stays read-only after finalization: it answers, grants nothing, and a
  // lease claimed with it is still refused.
  const observation = await client.state()
  assert.ok(Number.isSafeInteger(observation.generation))
  await assert.rejects(async () => client.next('leaseafterterminal', observation.generation), (error: unknown) => {
    const code = (error as { code?: string }).code
    assert.ok(code === 'stale_connection' || code === 'refused', `a post-terminal lease is refused (got ${String(code)})`)
    return true
  })
})

