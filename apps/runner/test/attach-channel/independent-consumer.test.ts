/**
 * I17 — independent consumer reproduction.
 *
 * Deliberately self-contained: it imports only the public entry and the shared contract types, and
 * declares its own producer, clock and counterparty. H can copy this file into its own test tree to
 * reproduce the same positive/negative outcomes without reading my fixtures or private state.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  CoordinatorChannelLease,
  CoordinatorChannelRequest,
  CoordinatorChannelLimits,
} from '../../../../packages/contracts/src/coordinator-channel.ts'
import { CoordinatorChannelModule } from '../../src/attach-channel/index.ts'

const producer = {
  attempt: {
    ticketId: 'ticket-independent',
    assignmentId: 'assignment-independent',
    attemptId: 'attempt-independent',
    fenceEpoch: 3,
    contract: { workId: 'work-independent', revision: 1, digest: 'c'.repeat(64) },
  },
  runnerIdentityRef: 'runner-independent',
  source: 'source-independent',
}

const limits: CoordinatorChannelLimits = {
  maxPendingFacts: 2,
  maxPendingPayloads: 2,
  maxPendingWrites: 2,
  maxPendingBytes: 65536,
  maxPayloadBytes: 4096,
  requestTimeoutMs: 5000,
  maxSettledRequests: 16,
}

function clock() {
  let time = 0
  let seq = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  return {
    now: () => time,
    schedule: (delayMs: number, run: () => void) => {
      const id = ++seq
      timers.set(id, { at: time + delayMs, run })
      return () => {
        timers.delete(id)
      }
    },
    advance(ms: number) {
      time += ms
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= time).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) return
        timers.delete(due[0])
        due[1].run()
      }
    },
  }
}

function attemptFields() {
  return {
    ticketId: producer.attempt.ticketId,
    assignmentId: producer.attempt.assignmentId,
    attemptId: producer.attempt.attemptId,
    fenceEpoch: producer.attempt.fenceEpoch,
    contract: { ...producer.attempt.contract },
  }
}

test('independent consumer: three callbacks on one controller across a connection replacement', async () => {
  const time = clock()
  const channel = new CoordinatorChannelModule({ producer, limits, now: time.now, schedule: time.schedule })
  const received: CoordinatorChannelRequest[] = []
  const send = (request: CoordinatorChannelRequest): void => {
    received.push(request)
  }
  const first: CoordinatorChannelLease = channel.bind({ producer, connectionId: 'sock-1', expectedGeneration: 0, send })

  const fact = {
    ...attemptFields(),
    factId: 'fact-independent',
    source: producer.source,
    kind: 'dispatch.observed' as const,
    payloadRef: 'payload-independent',
  }
  const factPromise = channel.recordFact(fact)
  const payloadPromise = channel.readPayload('payload-independent')
  const writePromise = channel.beforeNativeWrite({ ...attemptFields(), kind: 'answer', id: 'cmd-independent', nativeBindingRef: 'binding-i', answerRef: 'answer-i' })

  assert.equal(received.length, 3)
  assert.equal(channel.inspect().pendingFacts, 1)
  assert.equal(channel.inspect().pendingPayloads, 1)
  assert.equal(channel.inspect().pendingWrites, 1)

  // Replace the connection before anything is answered.
  const second = channel.bind({ producer, connectionId: 'sock-2', expectedGeneration: 1, send })
  await assert.rejects(writePromise, (error: unknown) => (error as { code?: string }).code === 'indeterminate')
  assert.equal(first.receive({ v: 1, type: 'receipt', id: 'fact-independent', factId: 'fact-independent', receipt: { factId: 'fact-independent', persisted: true, seq: 1 } }), false)

  const retried = received.slice(-2)
  const retriedPayload = retried.find(request => request.type === 'payload-read')
  assert.ok(retriedPayload && retriedPayload.type === 'payload-read')
  assert.equal(second.receive({ v: 1, type: 'receipt', id: 'fact-independent', factId: 'fact-independent', receipt: { factId: 'fact-independent', persisted: true, seq: 7 } }), true)
  assert.equal(second.receive({ v: 1, type: 'payload', id: retriedPayload.requestId, requestId: retriedPayload.requestId, value: { independent: true } }), true)

  assert.deepEqual(await factPromise, { factId: 'fact-independent', persisted: true, seq: 7 })
  assert.deepEqual(await payloadPromise, { independent: true })

  // One fresh intent still needs a fresh decision.
  const fresh = channel.beforeNativeWrite({ ...attemptFields(), kind: 'answer', id: 'cmd-independent', nativeBindingRef: 'binding-i', answerRef: 'answer-i' })
  const intent = received.at(-1)
  assert.ok(intent && intent.type === 'native-write-intent')
  assert.equal(second.receive({ v: 1, type: 'write-admission', id: intent.id, allowed: true }), true)
  await fresh

  assert.deepEqual(channel.inspect(), {
    state: 'bound', generation: 2, pendingFacts: 0, pendingPayloads: 0, pendingWrites: 0, pendingBytes: 0,
  })
})

test('independent consumer: a foreign producer claim is refused before the transport sees it', async () => {
  const time = clock()
  const channel = new CoordinatorChannelModule({ producer, limits, now: time.now, schedule: time.schedule })
  const received: CoordinatorChannelRequest[] = []
  channel.bind({ producer, connectionId: 'sock-1', expectedGeneration: 0, send: request => { received.push(request) } })

  await assert.rejects(
    channel.recordFact({ ...attemptFields(), factId: 'fact-foreign', source: 'someone-else', kind: 'turn.ended', payloadRef: 'payload-x' }),
    (error: unknown) => (error as { code?: string }).code === 'identity_mismatch',
  )
  assert.deepEqual(received, [])
})
