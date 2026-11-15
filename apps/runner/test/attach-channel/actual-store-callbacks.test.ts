/**
 * wave-31 I2 — the original product ingress is the fact authority.
 *
 * The Runner runs with `sink` bound to the real stored ingress (`createStoredRuntimeIngress` over a
 * real `ProductStore`). Receipts therefore come from the original durable fact table/UoW, not from a
 * `persisted:true` string: the test reads the fact back out of the store and compares the receipt the
 * Driver received. Payloads go through the original immutable payload reader.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startService } from './actual-harness.ts'
import { openProductIngress } from './product-ingress-harness.ts'
import { producer as fixtureProducer } from '../../../../tests/integration/runtime-ingress-fixture.ts'

test('I2: a fact recorded through the real ingress is readable in the original store', { timeout: 20000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const value = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-i31', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['evidence-i31'] } }
  const coordinatorRef = ingress.putPayload(value)
  let receiptFromDriver: { factId: string; seq: number } | undefined
  let localRef: string | undefined

  const h = await startService(t, {
    source: fixtureProducer.source,
    runnerIdentityRef: fixtureProducer.runnerIdentityRef,
    sink: ingress.sink,
    payloads: ingress.payloads,
    run: async ({ io }) => {
      // The Runner stores the payload next to its journal; the ref is content-addressed, so it is the
      // same immutable identity the coordinator store already holds.
      localRef = await io.payloads.store(value, 'critical')
      const receipt = await io.record(h.fact({ factId: 'fact-i31', kind: 'turn.ended', payloadRef: localRef }))
      receiptFromDriver = { factId: receipt.factId, seq: receipt.seq }
      return { reason: 'terminal', evidenceRefs: ['ingress'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  h.command(h.begin('prepared-policy-i31'))
  await h.done

  assert.ok(receiptFromDriver, 'the driver received a durable receipt')
  assert.equal(localRef, coordinatorRef, 'the immutable payload identity is shared')
  assert.equal(receiptFromDriver!.factId, 'fact-i31')
  assert.ok(receiptFromDriver!.seq >= 1)

  // The original store is the authority: the fact row exists under the same id and its sequence is the
  // one returned to the Driver (no synthetic `persisted:true` string anywhere in this path).
  const stored = ingress.store.facts.get('fact-i31') as { seq?: number; payloadDigest?: string } | undefined
  assert.ok(stored, 'the original ingress persisted the fact')
  assert.equal(stored!.seq, receiptFromDriver!.seq)
  assert.match(String(stored!.payloadDigest), /^[a-f0-9]{64}$/)
  assert.deepEqual(ingress.recorded.map(fact => fact.factId), ['fact-i31'])
})

test('I2: a fact with a foreign producer is refused by the original ingress (no receipt, no row)', { timeout: 20000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const value = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-foreign', outcome: 'completed', candidateAvailable: false, evidenceRefs: [] } }
  ingress.putPayload(value)
  let rejection: string | undefined

  const h = await startService(t, {
    source: fixtureProducer.source,
    runnerIdentityRef: fixtureProducer.runnerIdentityRef,
    sink: ingress.sink,
    payloads: ingress.payloads,
    run: async ({ io }) => {
      try {
        const localRef = await io.payloads.store(value, 'critical')
        await io.record({ ...h.fact({ factId: 'fact-foreign-ingress', kind: 'turn.ended', payloadRef: localRef }), source: 'intruder' })
      } catch (error) {
        rejection = (error as { code?: string }).code ?? 'rejected'
      }
      return { reason: 'terminal', evidenceRefs: ['foreign'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  h.command(h.begin('prepared-policy-i31-b'))
  await h.done

  assert.equal(rejection, 'identity_mismatch', 'the channel refuses a foreign fact before the sink')
  assert.equal(ingress.recorded.length, 0)
  assert.equal(ingress.store.facts.get('fact-foreign-ingress'), undefined)
})

test('I2: a missing original payload refuses the fact instead of inventing a receipt', { timeout: 20000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  let rejection: string | undefined

  const h = await startService(t, {
    source: fixtureProducer.source,
    runnerIdentityRef: fixtureProducer.runnerIdentityRef,
    sink: ingress.sink,
    payloads: ingress.payloads,
    run: async ({ io }) => {
      try {
        // The reference exists in neither the Runner's local store nor the coordinator store.
        await Promise.race([
          io.record(h.fact({ factId: 'fact-missing-payload', kind: 'turn.ended', payloadRef: 'payload:missing' })),
          new Promise((_, reject) => setTimeout(() => reject(new Error('payload read timed out')), 400)),
        ])
      } catch (error) {
        rejection = (error as { message?: string }).message ?? 'rejected'
      }
      return { reason: 'terminal', evidenceRefs: ['missing'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  h.command(h.begin('prepared-policy-i31-c'))
  await h.done

  assert.ok(rejection, 'the missing payload must surface as a failure')
  assert.equal(ingress.recorded.length, 0)
  assert.equal(ingress.store.facts.get('fact-missing-payload'), undefined)
})
