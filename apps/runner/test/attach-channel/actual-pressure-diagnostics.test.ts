/**
 * wave-33 outcome 3 — bounded pressure, typed diagnostics and per-slot isolation.
 *
 * All consumers are main's real caller over the real authenticated endpoint. Scope note: the four
 * endpoint pairs prove COMMUNICATION isolation only; the product scheduler's 2/4-slot capacity,
 * fifth-item waiting and aggregate release remain B/main outcomes and are not claimed here.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { attachRunnerAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import type { RunnerEndpoint } from '../../../../packages/execution/src/recovery-transport.ts'
import { makeAttemptSpec, makeCommand } from '../../../../packages/testing/src/index.ts'
import { NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { startService } from './actual-harness.ts'
import { answerCommand } from './fixtures.ts'

function memorySink(delayMs = 0) {
  const rows = new Map<string, { seq: number }>()
  const calls: string[] = []
  return {
    calls,
    rows,
    record: async (fact: { factId: string }) => {
      calls.push(fact.factId)
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
      const existing = rows.get(fact.factId)
      if (existing) return { factId: fact.factId, persisted: true as const, seq: existing.seq }
      const seq = rows.size + 1
      rows.set(fact.factId, { seq })
      return { factId: fact.factId, persisted: true as const, seq }
    },
  }
}

function caller(
  h: Awaited<ReturnType<typeof startService>>,
  endpoint: RunnerEndpoint,
  leaseId: string,
  sink: ReturnType<typeof memorySink>,
  nativeWrite?: (intent: { command: { id: string } }) => Promise<{ allowed: boolean }>,
) {
  return attachRunnerAttempt({
    endpoint,
    producer: h.producer,
    leaseId,
    callbacks: {
      fact: async fact => sink.record(fact as never),
      payload: async () => null,
      nativeWrite: nativeWrite ?? (async () => ({ allowed: true })),
    },
    timeoutMs: 3000,
  })
}

test('outcome3: a slow Store under a small burst still drains every fact with bounded waits', { timeout: 40000 }, async t => {
  const sink = memorySink(120)
  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      for (let index = 1; index <= 3; index += 1) {
        const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: `turn-slow-${index}`, outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
        await io.record(h.fact({ factId: `fact-slow-${index}`, kind: 'turn.ended', payloadRef: ref }))
      }
      return { reason: 'terminal', evidenceRefs: ['slow'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const endpoint = await h.waitEndpoint()
  const a = caller(h, endpoint, 'lease-slow', sink)
  h.command(h.begin('prepared-policy-slow'))
  const started = Date.now()
  const running = a.run({ pollMs: 5, deadlineMs: 15_000 }).catch(() => undefined)
  await h.done
  a.stop()
  await running
  const elapsed = Date.now() - started
  assert.deepEqual([...sink.rows.keys()].sort(), ['fact-slow-1', 'fact-slow-2', 'fact-slow-3'])
  assert.equal(a.served.facts, 3)
  assert.ok(elapsed < 15_000, `the burst finished inside the deadline (${elapsed}ms)`)
})

test('outcome3: a caller callback failure becomes a typed ack-failure, never a fake ACK', { timeout: 40000 }, async t => {
  const outcomes: string[] = []
  const h = await startService(t, {
    recovery: true,
    run: async ({ hooks, io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 'turn-reject', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      try {
        await io.record(h.fact({ factId: 'fact-reject', kind: 'turn.ended', payloadRef: ref }))
        outcomes.push('acked')
      } catch (error) {
        outcomes.push((error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'refused'))
      }
      try {
        await hooks.beforeNativeWrite(answerCommand('cmd-pressure'))
        outcomes.push('write-ok')
      } catch (error) {
        outcomes.push((error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'write-refused'))
      }
      return { reason: 'terminal', evidenceRefs: ['diagnostics'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const endpoint = await h.waitEndpoint()
  const attempts: string[] = []
  const rejecting = {
    record: async (fact: { factId: string }) => {
      attempts.push(fact.factId)
      throw new Error('ingress refused')
    },
  }
  const a = attachRunnerAttempt({
    endpoint,
    producer: h.producer,
    leaseId: 'lease-diag',
    callbacks: {
      fact: async fact => rejecting.record(fact as never),
      payload: async () => null,
      nativeWrite: async () => ({ allowed: false }),
    },
    timeoutMs: 3000,
  })
  h.command(h.begin('prepared-policy-diag'))
  const running = a.run({ pollMs: 5, deadlineMs: 15_000 }).catch(() => undefined)
  await h.done
  a.stop()
  await running
  assert.deepEqual(outcomes, ['protocol_error', 'native_write_denied'], 'a failed ingress is a typed failure; a denial is a decision')
  assert.deepEqual(attempts, ['fact-reject'], 'the callback was attempted exactly once')
})

test('outcome3: saturation refuses the 65th fact before send and drains after the caller attaches', { timeout: 50000 }, async t => {
  const sink = memorySink()
  const outcomes: string[] = []
  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      // Local payload store: the burst measures the FACT pending bound, not the payload-read bound.
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 'turn-cap', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      const batch = await Promise.allSettled(
        Array.from({ length: 65 }, (_, index) => io.record(h.fact({ factId: `fact-cap-${index + 1}`, kind: 'turn.ended', payloadRef: ref }))),
      )
      for (const result of batch) outcomes.push(result.status === 'fulfilled' ? 'ok' : ((result.reason as { code?: string }).code ?? 'error'))
      return { reason: 'terminal', evidenceRefs: ['saturation'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const endpoint = await h.waitEndpoint()
  h.command(h.begin('prepared-policy-cap'))
  // Let the 65 intents hit the bound BEFORE any consumer exists.
  await new Promise(resolve => setTimeout(resolve, 300))
  const a = caller(h, endpoint, 'lease-cap', sink)
  const running = a.run({ pollMs: 5, deadlineMs: 30_000 }).catch(() => undefined)
  await h.done
  a.stop()
  await running
  assert.equal(outcomes.filter(value => value === 'ok').length, 64, 'the bound admits 64 callbacks')
  assert.equal(outcomes.filter(value => value === 'capacity').length, 1, 'the 65th is refused by capacity')
  assert.equal(sink.rows.size, 64)
  assert.equal(a.served.facts, 64)
})

test('outcome3: four endpoint pairs isolate denials and never share an approval', { timeout: 60000 }, async t => {
  const slots: Array<{ h: Awaited<ReturnType<typeof startService>>; endpoint: RunnerEndpoint; caller: ReturnType<typeof caller>; sink: ReturnType<typeof memorySink>; native: string[] }> = []
  for (let index = 1; index <= 4; index += 1) {
    const sink = memorySink()
    const native: string[] = []
    const spec = makeAttemptSpec({ attemptId: `attempt-slot33-${index}` })
    const h = await startService(t, {
      spec,
      recovery: true,
      run: async ({ hooks, io }) => {
        const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: `turn-slot33-${index}`, outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
        await io.record(h.fact({ factId: `fact-slot33-${index}`, kind: 'turn.ended', payloadRef: ref }))
        try {
          await hooks.beforeNativeWrite(makeCommand('answer', { id: `cmd-slot33-${index}`, attemptId: spec.attemptId }))
          native.push('allowed')
        } catch (error) {
          native.push((error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'refused'))
        }
        return { reason: 'terminal', evidenceRefs: [`slot33-${index}`] }
      },
    })
    h.boot()
    await h.waitFrame(frame => frame.type === 'ready', 'ready')
    const endpoint = await h.waitEndpoint()
    h.command(h.begin(`prepared-policy-slot33-${index}`))
    // Slot 1's guard denies; the other slots allow.
    const instance = caller(h, endpoint, `lease-slot33-${index}`, sink, async () => ({ allowed: index !== 1 }))
    slots.push({ h, endpoint, caller: instance, sink, native })
  }
  const runs = slots.map(slot => slot.caller.run({ pollMs: 5, deadlineMs: 30_000 }).catch(() => undefined))
  for (const slot of slots) await slot.h.done
  for (const slot of slots) slot.caller.stop()
  await Promise.all(runs)
  for (const [index, slot] of slots.entries()) {
    const label = index + 1
    assert.deepEqual([...slot.sink.rows.keys()], [`fact-slot33-${label}`], `slot ${label} only saw its own fact`)
    assert.equal(slot.caller.served.facts, 1)
    assert.deepEqual(slot.native, [label === 1 ? 'native_write_denied' : 'allowed'], `slot ${label} keeps its own decision`)
  }
  // After each terminal the communication side is closed: a stopped caller does no work and a fresh
  // caller cannot bind or poll the terminal channel. Product slot release is B/main's evidence.
  for (const slot of slots) {
    assert.equal(await slot.caller.pollOnce(), false)
    const late = caller(slot.h, slot.endpoint, 'lease-slot33-late', memorySink())
    await assert.rejects(async () => late.pollOnce())
  }
})
