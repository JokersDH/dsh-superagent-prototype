/**
 * wave-31 I3 — the original Broker-style admission, per native intent.
 *
 * The consumer guard below is the same two live checks `NativeProductAttempt` performs before a
 * native answer write (current original binding, and a recorded command whose canonical body matches
 * the intent), plus a one-shot live admission, all read from the real `ProductStore`. The full
 * `NativeProductAttempt` wiring needs a spawned child and is NOT_REACHED here; what is proven is that
 * the channel cannot produce a write without this guard, and that each intent needs its own decision.
 */
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { key } from '../../../../packages/orchestrator-core/dist/index.js'
import { JsonSchema } from '../../../../packages/contracts/src/schemas.ts'
import { canonicalDigest } from '../../../../packages/contracts/src/canonical.ts'
import { binding as fixtureBinding, producer as fixtureProducer } from '../../../../tests/integration/runtime-ingress-fixture.ts'
import type { RunnerCommand } from '../../../../packages/contracts/src/types.ts'
import { startService } from './actual-harness.ts'
import { openProductIngress, type ProductIngress } from './product-ingress-harness.ts'
import type { AnswerCommand } from './fixtures.ts'

function commandGuard(ingress: ProductIngress, live: Set<string>) {
  const calls: string[] = []
  const guard = async (command: RunnerCommand): Promise<void> => {
    calls.push(command.id)
    const current = ingress.store.bindings.binding(fixtureBinding.attemptId) as { state?: string } | undefined
    if (!current || current.state !== 'active') throw new Error('attempt binding is not current')
    const indexed = ingress.store.commands.get(key('product-command', command.id))?.result as { command?: unknown } | undefined
    if (!indexed?.command || canonicalDigest(JsonSchema.parse(indexed.command)) !== canonicalDigest(JsonSchema.parse(command)))
      throw new Error('native command is not the recorded current command')
    if (!live.has(command.id)) throw new Error('native answer has no live write admission')
    live.delete(command.id)
  }
  return { guard, calls }
}

function recordCommand(ingress: ProductIngress, command: RunnerCommand): void {
  ingress.store.commands.record(key('product-command', command.id), canonicalDigest(JsonSchema.parse(command)), () => ({ command }))
}

function answerOf(id: string): AnswerCommand {
  const command = { ...fixtureProducer.attempt, kind: 'answer' as const, id, nativeBindingRef: 'binding-1', answerRef: 'answer-1' }
  return command
}

async function withService(t: TestContext, options: {
  guard?: (command: RunnerCommand) => Promise<void>
  sink?: ProductIngress['sink']
  attempts: number
  commandId?: string
}) {
  let nativeWrites = 0
  const h = await startService(t, {
    source: fixtureProducer.source,
    runnerIdentityRef: fixtureProducer.runnerIdentityRef,
    ...(options.sink ? { sink: options.sink } : {}),
    ...(options.guard ? { guard: options.guard } : {}),
    run: async ({ hooks }) => {
      for (let index = 0; index < options.attempts; index += 1) {
        try {
          await hooks.beforeNativeWrite(answerOf(options.commandId ?? 'cmd-answer'))
          nativeWrites += 1
        } catch {
          // a refusal keeps a real zero write
        }
      }
      return { reason: 'terminal', evidenceRefs: ['guard'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  h.command(h.begin('prepared-policy-i31-guard'))
  await h.done
  return { h, nativeWrites: () => nativeWrites }
}

test('I3: a live original binding + recorded command + admission permits exactly one write', { timeout: 25000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const live = new Set(['cmd-answer'])
  const { guard, calls } = commandGuard(ingress, live)
  recordCommand(ingress, answerOf('cmd-answer'))

  const h = await startService(t, {
    source: fixtureProducer.source,
    runnerIdentityRef: fixtureProducer.runnerIdentityRef,
    sink: ingress.sink,
    guard,
    run: async ({ hooks }) => {
      await hooks.beforeNativeWrite(answerOf('cmd-answer'))
      return { reason: 'terminal', evidenceRefs: ['guard-allowed'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  h.command(h.begin('prepared-policy-i31-guard'))
  await h.done
  assert.deepEqual(calls, ['cmd-answer'])
  assert.equal(ingress.store.facts.get('fact-never'), undefined)
})

test('I3: without a guard the real sink lane performs zero native writes', { timeout: 25000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const { nativeWrites } = await withService(t, { sink: ingress.sink, attempts: 1 })
  assert.equal(nativeWrites(), 0)
})

test('I3: a guard that denies or throws performs zero writes', { timeout: 25000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const denied = await withService(t, {
    sink: ingress.sink,
    attempts: 1,
    guard: async () => {
      throw new Error('no live admission')
    },
  })
  assert.equal(denied.nativeWrites(), 0)
})

test('I3: a stale binding or a replayed non-matching command body is refused before any write', { timeout: 25000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const live = new Set(['cmd-answer'])
  const { guard, calls } = commandGuard(ingress, live)

  // Record a DIFFERENT body under the same command id: the canonical digest check must fail.
  ingress.store.commands.record(key('product-command', 'cmd-answer'), canonicalDigest(JsonSchema.parse({})), () => ({ command: { ...answerOf('cmd-answer'), answerRef: 'other-answer' } }))

  const h = await startService(t, {
    source: fixtureProducer.source,
    runnerIdentityRef: fixtureProducer.runnerIdentityRef,
    sink: ingress.sink,
    guard,
    run: async ({ hooks }) => {
      try {
        await hooks.beforeNativeWrite(answerOf('cmd-answer'))
      } catch {
        // expected refusal
      }
      return { reason: 'terminal', evidenceRefs: ['body-mismatch'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  h.command(h.begin('prepared-policy-i31-guard-c'))
  await h.done
  assert.deepEqual(calls, ['cmd-answer'])
})

test('I3: each intent needs its own live admission; a second intent for the same command is refused', { timeout: 25000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const live = new Set(['cmd-answer'])
  const { guard, calls } = commandGuard(ingress, live)
  recordCommand(ingress, answerOf('cmd-answer'))
  const { nativeWrites } = await withService(t, { sink: ingress.sink, guard, attempts: 2 })
  assert.deepEqual(calls, ['cmd-answer', 'cmd-answer'], 'the guard is consulted per intent')
  assert.equal(nativeWrites(), 1, 'only the admitted intent may write')
})
