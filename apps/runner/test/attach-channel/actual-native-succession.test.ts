/**
 * wave-34 outcome I4 — temporary detach vs terminal with the ORIGINAL callbacks.
 *
 * Two real callers built from main's original `recordFact`/`readPayload`/`nativeWriteDecision`:
 * a successor continues the same attempt with original ids, a pending native intent is
 * `indeterminate` and never migrated, and an explicit terminal closes everything while a plain input
 * EOF leaves the pending work unknown (it is not a shutdown).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { attachRunnerAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import { NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { openProductIngress } from './product-ingress-harness.ts'
import { startNativeCallbacks, ATTEMPT } from './native-callbacks-harness.ts'
import { makeCommand } from '../../../../packages/testing/src/index.ts'

const VALUE = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-succ-native', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json
const command = (id: string) => makeCommand('answer', { ...ATTEMPT, id, nativeBindingRef: 'binding-succ', answerRef: 'answer-succ' })

function defer<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => {
    resolve = settle
  })
  return { promise, resolve }
}

test('I4: successor callbacks continue data; a pending intent is indeterminate and not migrated', { timeout: 45000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const intentSeen = defer<void>()
  const releaseIntent = defer<void>()
  const freshGate = defer<void>()
  const outcomes: string[] = []
  const h = await startNativeCallbacks(t, ingress, async ({ hooks, io }) => {
    // The Driver keeps its own local copy (so the service does not need a coordinator payload read);
    // content addressing makes it the same immutable reference the caller-side store was seeded with.
    const localRef = await io.payloads.store(VALUE, 'critical')
    assert.equal(localRef, h.seededLocalRef)
    await io.record(h.h.fact({ factId: 'fact-native-succ', kind: 'turn.ended', payloadRef: localRef }))
    try {
      await hooks.beforeNativeWrite(command('cmd-succ-1'))
      outcomes.push('allowed')
    } catch (error) {
      outcomes.push((error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'refused'))
    }
    await freshGate.promise
    try {
      await hooks.beforeNativeWrite(command('cmd-succ-2'))
      outcomes.push('fresh-allowed')
    } catch (error) {
      outcomes.push((error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'fresh-refused'))
    }
    return { reason: 'terminal', evidenceRefs: ['native-succession'] }
  }, { localPayload: VALUE })
  h.indexCommand(command('cmd-succ-1'))
  h.permit('cmd-succ-1')
  h.indexCommand(command('cmd-succ-2'))
  h.permit('cmd-succ-2')

  const a = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'lease-native-a',
    callbacks: {
      fact: fact => h.callbacks.recordFact(fact),
      payload: request => h.callbacks.readPayload(request.reference),
      nativeWrite: async intent => {
        intentSeen.resolve()
        await releaseIntent.promise
        return h.callbacks.nativeWrite(intent.command)
      },
    },
    timeoutMs: 3000,
  })
  const runningA = a.run({ pollMs: 5, deadlineMs: 20_000 }).catch(() => undefined)
  h.activate()
  h.h.command(h.h.begin('prepared-policy-native-succ'))
  await intentSeen.promise

  // Successor binds while the original caller's write callback is still pending.
  const b = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'lease-native-b',
    callbacks: {
      fact: fact => h.callbacks.recordFact(fact),
      payload: request => h.callbacks.readPayload(request.reference),
      nativeWrite: intent => h.callbacks.nativeWrite(intent.command),
    },
    timeoutMs: 3000,
  })
  const runningB = b.run({ pollMs: 5, deadlineMs: 20_000 }).catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.deepEqual(outcomes, ['indeterminate'], 'the pending write does not migrate')
  releaseIntent.resolve()
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.equal(a.served.nativeWrites, 0, 'the replaced caller served no write')
  freshGate.resolve()
  await h.h.done
  a.stop()
  b.stop()
  await Promise.all([runningA, runningB])
  assert.deepEqual(outcomes.slice(1), ['fresh-allowed'], 'the fresh intent gets its own original decision')
  const row = ingress.store.facts.get('fact-native-succ')
  assert.ok(row, 'the fact reached the original Store through the successor or the first caller')
})

test('I4: explicit terminal closes a pending record; a plain input EOF leaves it unknown', { timeout: 45000 }, async t => {
  const terminalIngress = openProductIngress()
  const eofIngress = openProductIngress()
  t.after(() => {
    terminalIngress.close()
    eofIngress.close()
  })
  const terminalOutcomes: string[] = []
  const eofOutcomes: string[] = []
  const terminalEntered = defer<void>()
  const eofEntered = defer<void>()
  const terminalRelease = defer<void>()
  const eofRelease = defer<void>()

  const terminal = await startNativeCallbacks(t, terminalIngress, async ({ io }) => {
    try {
      const ref = await io.payloads.store(VALUE, 'critical')
      await io.record(terminal.h.fact({ factId: 'fact-terminal-native', kind: 'turn.ended', payloadRef: ref }))
      terminalOutcomes.push('acked')
    } catch (error) {
      terminalOutcomes.push((error as { code?: string }).code ?? 'refused')
    }
    return { reason: 'cancelled', evidenceRefs: ['terminal'] }
  }, { localPayload: VALUE })

  const callerFor = (h: typeof terminal, leaseId: string, entered: typeof terminalEntered, release: typeof terminalRelease) => attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId,
    callbacks: {
      // The fact is DELAYED inside the caller so the channel holds a real pending record at shutdown.
      fact: async fact => {
        entered.resolve()
        await release.promise
        return h.callbacks.recordFact(fact)
      },
      payload: request => h.callbacks.readPayload(request.reference),
    },
    timeoutMs: 3000,
  })
  const terminalCaller = callerFor(terminal, 'lease-terminal-native', terminalEntered, terminalRelease)
  const terminalRun = terminalCaller.run({ pollMs: 5, deadlineMs: 15_000 }).catch(() => undefined)
  terminal.activate()
  terminal.h.command(terminal.h.begin('prepared-policy-terminal-native'))
  await terminalEntered.promise
  terminal.h.send({ type: 'shutdown', id: 'shutdown-native' })
  await new Promise(resolve => setTimeout(resolve, 100))
  terminalRelease.resolve()
  await terminal.h.done
  terminalCaller.stop()
  await terminalRun
  assert.deepEqual(terminalOutcomes, ['closed'], 'an explicit terminal fails the pending record closed')

  // EOF: the input ends with the record still pending and the caller callback still running. That is
  // NOT a shutdown: no ACK, no closed failure, no exit frame.
  const eof = await startNativeCallbacks(t, eofIngress, async ({ io }) => {
    try {
      const ref = await io.payloads.store(VALUE, 'critical')
      await io.record(eof.h.fact({ factId: 'fact-eof-native', kind: 'turn.ended', payloadRef: ref }))
      eofOutcomes.push('acked')
    } catch (error) {
      eofOutcomes.push((error as { code?: string }).code ?? 'refused')
    }
    return { reason: 'cancelled', evidenceRefs: ['eof'] }
  }, { localPayload: VALUE })
  const eofCaller = callerFor(eof, 'lease-eof-native', eofEntered, eofRelease)
  const eofRun = eofCaller.run({ pollMs: 5, deadlineMs: 15_000 }).catch(() => undefined)
  eof.activate()
  eof.h.command(eof.h.begin('prepared-policy-eof-native'))
  await eofEntered.promise
  eof.h.inputEnd()
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.deepEqual(eofOutcomes, [], 'EOF does not fabricate an ACK or a closed failure')
  assert.equal(eof.h.framesOf('exited').length, 0, 'EOF alone produced no terminal exit frame')
  eofRelease.resolve()
  eofCaller.stop()
  await eofRun.catch(() => undefined)
})
