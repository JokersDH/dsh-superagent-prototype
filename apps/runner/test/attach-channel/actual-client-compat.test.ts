/**
 * wave-36 line 4 — same-version client compatibility and bounded refusals.
 *
 * `openAttachClient` fixes the argument order once: the producer is bound at connect time and never
 * passed where a lease belongs. The tests below pin the compatibility surface a product consumer can
 * rely on: unknown frames never settle, a foreign producer changes nothing, page budgets are validated
 * before a request is made, and every refusal stays typed and bounded.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeAttemptSpec, makeCommand } from '../../../../packages/testing/src/index.ts'
import { openAttachClient } from '../../src/attach-channel/typed-client.ts'
import { startService } from './actual-harness.ts'

const spec = makeAttemptSpec()

function cancelFor(id: string) {
  const command = makeCommand('cancel', {
    ticketId: spec.ticketId,
    assignmentId: spec.assignmentId,
    attemptId: spec.attemptId,
    fenceEpoch: spec.fenceEpoch,
    contract: spec.contract,
    id,
  })
  if (command.kind !== 'cancel') throw new Error('expected a cancel command')
  return command
}

test('L4: the typed client keeps lease/ producer apart and unknown frames settle nothing', { timeout: 45000 }, async t => {
  const h = await startService(t, {
    spec,
    recovery: true,
    run: async ({ io }) => {
      const localRef = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 'turn-compat', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['compat'] } }, 'critical')
      await io.record(h.fact({ factId: 'factcompat', kind: 'turn.ended', payloadRef: localRef }))
      return { reason: 'terminal', evidenceRefs: ['compat'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const endpoint = await h.waitEndpoint()
  h.command(h.begin('prepared-policy-compat'))
  const client = openAttachClient(endpoint, h.producer)
  const state = await client.state()

  // A producer passed where a lease belongs is the historical caller mistake; the server refuses it
  // without touching the owner (this is why the wrapper binds the producer at connect time).
  await assert.rejects(async () => client.next(h.producer as never, state.generation), (error: unknown) => {
    const code = (error as { code?: string }).code
    assert.ok(
      code === 'refused' || code === 'stale_connection' || code === 'protocol_error' || code === 'unknown_outcome',
      `typed refusal (got ${String(code)})`,
    )
    return true
  })
  assert.equal((await client.state()).generation, state.generation, 'a malformed lease claim changes nothing')

  // Take the channel and receive the fact request.
  const page = await client.next('leasecompat', state.generation)
  assert.ok(page && page.request, 'the owner receives the pending fact')
  const request = page!.request as { type: string; id: string }

  // Unknown reply kinds and wrong correlation ids are refused without settling the pending fact.
  for (const bogus of [
    { v: 1, type: 'unknown-reply', id: request.id },
    { v: 1, type: 'receipt', id: 'different-id', factId: 'different-id', receipt: { factId: 'different-id', persisted: true, seq: 1 } },
  ]) {
    try {
      const result = await client.reply('leasecompat', bogus)
      assert.equal(result.accepted, false, 'an unrelated frame is not accepted')
    } catch (error) {
      const code = (error as { code?: string }).code
      assert.ok(code === 'refused' || code === 'protocol_error', `bogus reply refused (got ${String(code)})`)
      assert.ok(String((error as Error).message).length <= 200, 'diagnostics stay bounded')
    }
  }
  const again = await client.next('leasecompat', state.generation)
  assert.equal(again?.request && (again.request as { id?: string }).id, request.id, 'the original request is still pending, unsettled')

  // A foreign producer is a different identity: its control calls change nothing.
  const foreign = openAttachClient(endpoint, { ...h.producer, source: 'intruder-source' })
  await assert.rejects(async () => foreign.cancel(cancelFor('cmdcancelforeign')), (error: unknown) => {
    const code = (error as { code?: string }).code
    assert.ok(
      code === 'refused' || code === 'unknown_outcome' || code === 'identity_mismatch',
      `foreign control refused (got ${String(code)})`,
    )
    return true
  })

  // Page budgets are validated before any request is made.
  await assert.rejects(async () => client.facts(0, 512), /at least 1024|1024/i)

  // Complete the fact so the run can end normally.
  const receipt = { factId: 'factcompat', persisted: true as const, seq: 1 }
  const accepted = await client.reply('leasecompat', { v: 1, type: 'receipt', id: request.id, factId: 'factcompat', receipt })
  assert.equal(accepted.accepted, true)
  await h.waitFrame(frame => frame.type === 'exited', 'exit after the acknowledged fact')
})
