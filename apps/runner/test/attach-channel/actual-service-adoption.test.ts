/**
 * wave-31 I1 — the actual product service uses one admitted communication implementation.
 *
 * These cases drive the real `serveRunner` (the source main/B ship) over its real stdio bridge and
 * the real `RunnerAttachChannel` bootstrap. What they prove is behavioural and could not pass with
 * the retired per-callback waiter maps: a native intent is correlated freshly while the business
 * command stays byte-identical, and a retired admission cannot approve a later intent.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startService } from './actual-harness.ts'

test('I1: the real service emits original fact ids and fresh native correlations', { timeout: 15000 }, async t => {
  const h = await startService(t, {
    payloadValues: { 'payload-adopt': { adopted: true } },
    run: async ({ hooks, io, spec }) => {
      await io.record(h.fact({ factId: 'fact-adopt', kind: 'dispatch.observed', payloadRef: 'payload-adopt' }))
      await hooks.beforeNativeWrite(h.answer('cmd-answer'))
      return { reason: 'terminal', evidenceRefs: ['adopted', spec.attemptId] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  h.command(h.begin('prepared-policy-1'))

  await h.waitFrame(frame => frame.type === 'fact' && frame.id === 'fact-adopt', 'fact frame')
  const fact = h.framesOf('fact')[0]
  assert.ok(fact)
  assert.equal((fact.fact as { source?: string }).source, 'fake-driver')
  // The Driver only proceeds past io.record once the coordinator acknowledges the original fact id.
  h.send({ type: 'receipt', id: 'fact-adopt', factId: 'fact-adopt', receipt: { factId: 'fact-adopt', persisted: true, seq: 1 } })

  await h.waitFrame(frame => frame.type === 'native-write-intent', 'native intent')
  const intent = h.framesOf('native-write-intent')[0] as { id: string; command: { id: string; kind: string } }
  assert.equal(intent.command.id, 'cmd-answer')
  assert.equal(intent.command.kind, 'answer')
  assert.notEqual(intent.id, intent.command.id, 'the frame correlation must be fresh')

  h.send({ type: 'write-admission', id: intent.id, allowed: true })
  await h.waitFrame(frame => frame.type === 'exited', 'service exit')
  assert.equal((await h.done).reason, 'terminal')
})

test('I1: a retired admission cannot authorise the next intent on the same command', { timeout: 15000 }, async t => {
  const h = await startService(t, {
    payloadValues: {},
    run: async ({ hooks }) => {
      await hooks.beforeNativeWrite(h.answer('cmd-repeat'))
      await hooks.beforeNativeWrite(h.answer('cmd-repeat'))
      return { reason: 'terminal', evidenceRefs: ['replayed'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  h.command(h.begin('prepared-policy-2'))

  // The Driver awaits the first intent before asking for the second, so approve it first.
  await h.waitFrame(() => h.framesOf('native-write-intent').length === 1, 'first intent')
  const intents = h.framesOf('native-write-intent') as Array<{ id: string }>
  h.send({ type: 'write-admission', id: intents[0]!.id, allowed: true })

  await h.waitFrame(() => h.framesOf('native-write-intent').length === 2, 'second intent')
  const both = h.framesOf('native-write-intent') as Array<{ id: string }>
  assert.notEqual(both[0]?.id, both[1]?.id, 'each intent needs its own correlation')

  // Replay the settled first admission while the second intent is pending.
  h.send({ type: 'write-admission', id: both[0]!.id, allowed: true })
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.equal(h.framesOf('exited').length, 0, 'the replay must not release the second intent')

  h.send({ type: 'write-admission', id: both[1]!.id, allowed: true })
  await h.waitFrame(frame => frame.type === 'exited', 'service exit')
  assert.equal((await h.done).reason, 'terminal')
})

test('I1: a fact with a foreign producer is refused before the bridge sees it', { timeout: 15000 }, async t => {
  const rejections: string[] = []
  const h = await startService(t, {
    payloadValues: { 'payload-foreign': { refused: true } },
    run: async ({ io }) => {
      try {
        // The Driver stamps attempt identity; a different source is not this Runner's producer.
        await io.record({ ...h.fact({ factId: 'fact-foreign', kind: 'turn.ended', payloadRef: 'payload-foreign' }), source: 'intruder-source' })
      } catch (error) {
        rejections.push((error as { code?: string }).code ?? 'unknown')
      }
      return { reason: 'terminal', evidenceRefs: ['foreign-refused'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  h.command(h.begin('prepared-policy-3'))
  await h.waitFrame(frame => frame.type === 'exited', 'service exit')
  assert.deepEqual(h.framesOf('fact'), [], 'a foreign fact must never reach the transport')
  assert.deepEqual(rejections, ['identity_mismatch'])
})

test('I1: a duplicate bootstrap is a protocol error, not a second channel', { timeout: 15000 }, async t => {
  const h = await startService(t)
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  h.boot()
  await h.waitFrame(frame => frame.type === 'error', 'duplicate bootstrap error')
  const error = h.framesOf('error')[0] as { reason?: string }
  assert.equal(error.reason, 'duplicate_bootstrap')
})
