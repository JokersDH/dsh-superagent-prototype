/**
 * Wave-29 B1/B4: the B adapter consumes I's RunnerAttachChannel without keeping a second queue.
 *
 * These cases exercise the adapter surface B actually runs (`next`/`receive`) rather than I's module
 * internals: the outbound queue is namespaced by kind, a raw id shared by a fact and a native intent is
 * never collapsed, settlement removes only the settled entry, and the module's bounded deadline prunes
 * a stranded entry instead of leaving it dispatchable.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RunnerAttachChannel } from '../src/attach-channel/index.ts'
import { DEFAULT_LIMITS } from '../src/attach-channel/index.ts'
import { criticalFact } from '../../../packages/driver-kit/src/attempt-io.ts'
import { makeAttemptSpec, makeCommand } from '../../../packages/testing/src/index.ts'

const spec = makeAttemptSpec()
const producer = {
  attempt: { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract },
  runnerIdentityRef: 'attach-adapter-test',
  source: 'fake-driver',
}
const sharedId = 'same-raw-id'
const limits = { ...DEFAULT_LIMITS, requestTimeoutMs: 120 }

function attach() {
  const channel = new RunnerAttachChannel({ producer, limits })
  channel.bind({ producer, connectionId: 'c', expectedGeneration: 0 })
  const sent: string[] = []
  return { channel, sent }
}

test('the same raw id in different kinds is never collapsed in the outbound queue', async () => {
  const { channel } = attach()
  void channel.hooks.factSink.record(criticalFact(spec, { factId: sharedId, source: producer.source, kind: 'dispatch.observed', payloadRef: 'payload-1' })).catch(() => undefined)
  void channel.hooks.beforeNativeWrite(makeCommand('answer')).catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 40))
  const heads: string[] = []
  for (let index = 0; index < 2; index += 1) {
    const page = channel.next('c', producer)
    assert.equal(page.ok, true)
    if (!page.ok || !page.request) break
    heads.push(`${page.request.type}:${page.request.type === 'fact' ? page.request.id : page.request.type === 'payload-read' ? page.request.requestId : page.request.id}`)
    // Settle the head so the next head becomes visible.
    if (page.request.type === 'fact') channel.receive('c', { v: 1, type: 'receipt', id: page.request.id, factId: page.request.id, receipt: { factId: page.request.id, persisted: true, seq: 1 } }, producer)
    else channel.receive('c', { v: 1, type: 'write-admission', id: page.request.id, allowed: false }, producer)
  }
  // The fact keeps the raw id; the native intent keeps the original command id but uses a FRESH
  // correlation id, so the two kinds cannot shadow each other even when the caller's raw id repeats.
  assert.equal(heads.length, 2)
  assert.ok(heads.includes(`fact:${sharedId}`))
  const writeHead = heads.find(head => head.startsWith('native-write-intent:'))
  assert.ok(writeHead && writeHead.slice('native-write-intent:'.length) !== sharedId)
  void channel
})

test('an unsettled entry is pruned by the bounded deadline, not left dispatchable', async () => {
  const { channel } = attach()
  void channel.hooks.factSink.record(criticalFact(spec, { factId: 'stranded', source: producer.source, kind: 'turn.ended', payloadRef: 'payload-2' })).catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 40))
  const first = channel.next('c', producer)
  assert.equal(first.ok && first.request !== null, true)
  await new Promise(resolve => setTimeout(resolve, limits.requestTimeoutMs + 80))
  const after = channel.next('c', producer)
  assert.equal(after.ok && after.request === null, true, 'a timed-out request must be pruned from the dispatch queue')
  channel.close()
})
