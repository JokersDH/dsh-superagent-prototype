/**
 * wave-35 outcome I3 — lease identity vs business/command authority.
 *
 * The callback generation is not the business fence. This file proves the transport-level negatives a
 * control path needs (foreign producer, wrong CAS generation, terminal) and the read-only ownership
 * predicate `RunnerAttachChannel.owns`, which lets a control path reject a claimed lease *before* it
 * has any effect. Succession by an unbound-but-later-owner lease remains the deliberate CAS takeover;
 * the predicate only reports who owns the channel right now.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { connectRunnerRecovery } from '../../../../packages/execution/src/recovery-transport.ts'
import { DEFAULT_LIMITS, RunnerAttachChannel } from '../../src/attach-channel/index.ts'
import { startService } from './actual-harness.ts'

test('I3: foreign producer, wrong generation and terminal refuse at the real service boundary', { timeout: 40000 }, async t => {
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const h = await startService(t, {
    recovery: true,
    run: async () => {
      await gate
      return { reason: 'terminal', evidenceRefs: ['lease-boundary'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const endpoint = await h.waitEndpoint()
  const client = connectRunnerRecovery(endpoint, h.producer, 3000)
  const state = await client.channelState!()

  // A producer that is not the registered attempt is refused before it can poll or reply. The
  // transport collapses an authenticated refusal to its bounded code; the guarantee is the refusal.
  const foreign = connectRunnerRecovery(endpoint, { ...h.producer, source: 'intruder-source' }, 3000)
  await assert.rejects(async () => foreign.channelState!(), (error: unknown) => {
    const code = (error as { code?: string }).code
    assert.ok(
      code === 'identity_mismatch' || code === 'protocol_error' || code === 'unknown_outcome',
      `foreign producer is refused with a bounded code (got ${String(code)})`,
    )
    return true
  })
  const afterForeign = await client.channelState!()
  assert.equal(afterForeign.generation, state.generation, 'the foreign attempt changed no owner')

  // A CAS on a generation the caller did not observe is refused and leaves the owner untouched.
  await assert.rejects(async () => client.channelNext!('leasewronggeneration', state.generation + 5), (error: unknown) => {
    const code = (error as { code?: string }).code
    assert.ok(code === 'stale_connection' || code === 'refused', `a mismatched CAS is refused (got ${String(code)})`)
    return true
  })
  const stillUnbound = await client.channelState!()
  assert.equal(stillUnbound.generation, state.generation, 'a refused CAS changes nothing')

  // The legal CAS binds and polls; an empty page is normal and grants nothing. The client takes
  // (leaseId, expectedGeneration) — the producer was fixed when the client connected.
  const page = await client.channelNext!('leaseowner' as never, state.generation as never)
  assert.ok(page && page.generation === state.generation + 1, 'the owner takes the next generation')
  assert.equal(page!.request, null)
  const rebound = await client.channelState!()
  assert.equal(rebound.generation, state.generation + 1)

  // Terminal: after an explicit shutdown frame (not a bare input EOF) the channel refuses new polls
  // instead of serving a dead lease. `finish()` closes the whole channel synchronously.
  h.send({ type: 'shutdown', id: 'shutdownlease' })
  await assert.rejects(async () => client.channelNext!('leaseowner' as never, rebound.generation as never), (error: unknown) => {
    const code = (error as { code?: string }).code
    assert.ok(code === 'closed' || code === 'stale_connection' || code === 'refused', `terminal refusal is typed (got ${String(code)})`)
    return true
  })
  release()
})

test('I3: owns() reports the live owner without binding, polling or replacing it', async () => {
  const producer = {
    attempt: { ticketId: 'ticket-owns', assignmentId: 'assignment-owns', attemptId: 'attempt-owns', fenceEpoch: 1, contract: { workId: 'work-owns', revision: 1, digest: 'b'.repeat(64) } },
    runnerIdentityRef: 'runner-owns',
    source: 'fixture-owns',
  }
  const attach = new RunnerAttachChannel({ producer, limits: DEFAULT_LIMITS })
  assert.equal(attach.owns('lease-a', producer), 'unbound', 'no connection is bound yet')

  attach.bind({ producer, connectionId: 'lease-a', expectedGeneration: 0 })
  assert.equal(attach.owns('lease-a', producer), 'owned')
  assert.equal(attach.owns('lease-b', producer), 'stale_connection', 'another lease is not the owner')
  assert.equal(
    attach.owns('lease-a', { ...producer, source: 'intruder-source' }),
    'identity_mismatch',
    'the right lease with a foreign producer is still refused',
  )
  assert.equal(attach.inspect().generation, 1, 'owns() never binds or advances the generation')

  attach.drop('lease-a')
  assert.equal(attach.owns('lease-a', producer), 'unbound', 'a dropped connection owns nothing')
  attach.bind({ producer, connectionId: 'lease-b', expectedGeneration: 1 })
  assert.equal(attach.owns('lease-a', producer), 'stale_connection', 'the previous lease never becomes current again')
  assert.equal(attach.owns('lease-b', producer), 'owned')

  attach.close('done')
  assert.equal(attach.owns('lease-b', producer), 'closed')
})

test('I3: a reference control consumer refuses a claimed lease before sending anything', () => {
  const producer = {
    attempt: { ticketId: 'ticket-ctl', assignmentId: 'assignment-ctl', attemptId: 'attempt-ctl', fenceEpoch: 2, contract: { workId: 'work-ctl', revision: 2, digest: 'c'.repeat(64) } },
    runnerIdentityRef: 'runner-ctl',
    source: 'fixture-ctl',
  }
  const attach = new RunnerAttachChannel({ producer, limits: DEFAULT_LIMITS })
  const effects: string[] = []
  // The shape a control path should use: claim → ownership check → only then a business effect.
  const claim = (leaseId: string, producerClaim: typeof producer): { ok: boolean; reason: string } => {
    const ownership = attach.owns(leaseId, producerClaim)
    if (ownership !== 'owned') return { ok: false, reason: ownership }
    effects.push(leaseId)
    return { ok: true, reason: ownership }
  }

  assert.deepEqual(claim('lease-never-bound', producer), { ok: false, reason: 'unbound' })
  attach.bind({ producer, connectionId: 'lease-ctl', expectedGeneration: 0 })
  assert.deepEqual(claim('lease-never-bound', producer), { ok: false, reason: 'stale_connection' })
  assert.deepEqual(claim('lease-ctl', { ...producer, source: 'intruder-source' }), { ok: false, reason: 'identity_mismatch' })
  assert.deepEqual(effects, [], 'no refused claim reached the business effect')
  assert.deepEqual(claim('lease-ctl', producer), { ok: true, reason: 'owned' })
  assert.deepEqual(effects, ['lease-ctl'])
})
