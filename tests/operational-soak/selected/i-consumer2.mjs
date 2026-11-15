/**
 * Wave-29 consumer for the current committed I module.
 *
 * Runs the real CoordinatorChannelModule from the materialized admitted commit with local frames and
 * a manual clock: three callbacks, fresh per-intent correlation, queue namespaces, settlement prune,
 * CAS/generation, late/close/timeout/capacity.
 */
import { makeAttemptSpec, makeCommand, makeFact } from '../../../packages/testing/src/index.ts'

export const SOURCE = 'fixture-channel-source-wave29'
export const RUNNER_IDENTITY = 'fixture-runner-identity-wave29'

function manualClock() {
  let now = 0
  const timers = []
  return {
    now: () => now,
    schedule(delayMs, callback) {
      const timer = { at: now + delayMs, callback, cancelled: false }
      timers.push(timer)
      return () => { timer.cancelled = true }
    },
    advance(ms) {
      now += ms
      for (const timer of timers) if (!timer.cancelled && timer.at <= now) { timer.cancelled = true; timer.callback() }
    },
  }
}

function observe(promise, timeoutMs = 300) {
  const state = { state: 'pending', value: undefined, code: null, reason: null }
  promise.then(
    (value) => { state.state = 'resolved'; state.value = value },
    (error) => { state.state = 'rejected'; state.code = error?.code ?? null; state.reason = error?.reason ?? String(error?.message ?? error) },
  )
  return new Promise((resolvePromise) => setTimeout(() => resolvePromise({ ...state }), timeoutMs))
}

export async function runICurrentConsumer({ treeRoot }) {
  const { CoordinatorChannelModule } = await import(new URL(`file://${treeRoot}/apps/runner/src/attach-channel/index.ts`).href)
  const spec = makeAttemptSpec()
  const producer = {
    attempt: { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract },
    runnerIdentityRef: RUNNER_IDENTITY, source: SOURCE,
  }
  const fact = (overrides = {}) => makeFact('turn.ended', 'payload-1', {
    ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch,
    contract: spec.contract, source: SOURCE, ...overrides,
  })
  const limits = {
    maxPendingFacts: 64, maxPendingPayloads: 16, maxPendingWrites: 8, maxPendingBytes: 1024 * 1024,
    maxPayloadBytes: 64 * 1024, requestTimeoutMs: 5000, maxSettledRequests: 256,
  }
  const cases = []
  const record = (id, value) => cases.push({ id, ...value })
  const make = (overrides = {}) => {
    const clock = manualClock()
    const channel = new CoordinatorChannelModule({ producer, limits: { ...limits, ...overrides }, now: clock.now, schedule: clock.schedule })
    const frames = []
    let lease = channel.bind({ producer, connectionId: 'conn-a', expectedGeneration: 0, send: (request) => frames.push(request) })
    return { channel, clock, frames, get lease() { return lease }, rebind: (expectedGeneration, connectionId) => { lease = channel.bind({ producer, connectionId, expectedGeneration, send: (request) => frames.push(request) }); return lease } }
  }

  {
    const h = make()
    const pending = h.channel.recordFact(fact({ factId: 'fact-w29-1' }))
    const request = h.frames[0]
    const accepted = h.lease.receive({ v: 1, type: 'receipt', id: request.id, factId: request.id, receipt: { factId: request.id, persisted: true, seq: 7 } })
    const duplicate = h.lease.receive({ v: 1, type: 'receipt', id: request.id, factId: request.id, receipt: { factId: request.id, persisted: true, seq: 8 } })
    record('I-fact', { accepted, duplicate, settled: await observe(pending) })
    h.channel.close()
  }
  {
    const h = make()
    const pending = h.channel.recordFact(fact({ factId: 'fact-w29-ack' }))
    const request = h.frames[0]
    h.lease.receive({ v: 1, type: 'ack-failed', id: request.id, factId: request.id, reason: 'ingress_unavailable' })
    record('I-ack-failed', { settled: await observe(pending) })
    h.channel.close()
  }
  {
    const h = make()
    const pending = h.channel.readPayload('payload-ref-1')
    const request = h.frames[0]
    const wrong = h.lease.receive({ v: 1, type: 'payload', id: 'other', requestId: 'other', value: { wrong: true } })
    h.lease.receive({ v: 1, type: 'payload', id: request.requestId, requestId: request.requestId, value: { right: true } })
    record('I-payload', { wrong, settled: await observe(pending) })
    h.channel.close()
  }
  {
    const h = make()
    const pending = h.channel.beforeNativeWrite(makeCommand('answer'))
    const request = h.frames[0]
    h.lease.receive({ v: 1, type: 'write-admission', id: request.id, allowed: true })
    record('I-write-allow', { frameId: request.id, settled: await observe(pending) })
    h.channel.close()
  }
  {
    const h = make()
    const pending = h.channel.beforeNativeWrite(makeCommand('answer'))
    const request = h.frames[0]
    h.lease.receive({ v: 1, type: 'write-admission', id: request.id, allowed: false })
    record('I-write-deny', { settled: await observe(pending) })
    h.channel.close()
  }
  // Fresh correlation for the same business command.
  {
    const h = make()
    const command = makeCommand('answer')
    const first = h.channel.beforeNativeWrite(command)
    const firstFrame = h.frames[0]
    h.lease.receive({ v: 1, type: 'write-admission', id: firstFrame.id, allowed: true })
    const firstSettled = await observe(first)
    const second = h.channel.beforeNativeWrite(command)
    const secondFrame = h.frames[1]
    const replay = h.lease.receive({ v: 1, type: 'write-admission', id: firstFrame.id, allowed: true })
    const secondAfterReplay = await observe(second, 150)
    let secondResolvedByOwn = false
    if (secondFrame !== undefined) {
      h.lease.receive({ v: 1, type: 'write-admission', id: secondFrame.id, allowed: true })
      secondResolvedByOwn = (await observe(second)).state === 'resolved'
    }
    record('I-fresh-intent', {
      firstFrameId: firstFrame?.id ?? null, secondFrameId: secondFrame?.id ?? null,
      distinctFrameIds: firstFrame?.id !== secondFrame?.id,
      replayAccepted: replay, firstSettled: firstSettled.state,
      secondAfterReplay: secondAfterReplay.state, secondResolvedByOwn,
      fixed: firstFrame?.id !== secondFrame?.id && replay === false && secondResolvedByOwn,
    })
    h.channel.close()
  }
  // Queue namespace: same literal id for a fact and a payload request do not collide.
  {
    const h = make()
    const factPending = h.channel.recordFact(fact({ factId: 'payload-1' }))
    const payloadPending = h.channel.readPayload('payload-1')
    const factFrame = h.frames.find((entry) => entry.type === 'fact')
    const payloadFrame = h.frames.find((entry) => entry.type === 'payload-read')
    h.lease.receive({ v: 1, type: 'receipt', id: factFrame.id, factId: factFrame.id, receipt: { factId: factFrame.id, persisted: true, seq: 1 } })
    const payloadStillPending = (await observe(payloadPending, 100)).state === 'pending'
    h.lease.receive({ v: 1, type: 'payload', id: payloadFrame.requestId, requestId: payloadFrame.requestId, value: { ok: true } })
    record('I-queue-namespace', { fact: await observe(factPending), payloadStillPending, payload: await observe(payloadPending) })
    h.channel.close()
  }
  // Settled timeout is pruned; late replies do nothing and pending count returns to zero.
  {
    const h = make({ requestTimeoutMs: 50 })
    const pending = h.channel.recordFact(fact({ factId: 'fact-timeout-w29' }))
    h.clock.advance(51)
    const settled = await observe(pending)
    const after = h.channel.inspect()
    const late = h.lease.receive({ v: 1, type: 'receipt', id: 'fact-timeout-w29', factId: 'fact-timeout-w29', receipt: { factId: 'fact-timeout-w29', persisted: true, seq: 1 } })
    record('I-timeout-prune', { settled, pendingFacts: after.pendingFacts, timerLikePending: after.pendingPayloads + after.pendingWrites, late })
    h.channel.close()
  }
  {
    const h = make()
    const first = h.lease
    const second = h.rebind(1, 'conn-b')
    let stale = null
    try { h.channel.bind({ producer, connectionId: 'conn-c', expectedGeneration: 0, send: () => {} }) } catch (error) { stale = error?.code ?? null }
    record('I-generation', { first: first.generation, second: second.generation, stale, oldReply: first.receive({ v: 1, type: 'receipt', id: 'x', factId: 'x', receipt: { factId: 'x', persisted: true, seq: 1 } }) })
    h.channel.close()
  }
  {
    const h = make()
    const first = h.lease
    const second = h.rebind(1, 'conn-b')
    first.close('old client')
    const pending = h.channel.readPayload('payload-after-old-close')
    const request = h.frames.at(-1)
    second.receive({ v: 1, type: 'payload', id: request.requestId, requestId: request.requestId, value: { ok: true } })
    record('I-old-lease', { settled: await observe(pending), generation: second.generation })
    h.channel.close()
  }
  {
    const h = make({ maxPendingFacts: 1 })
    const first = h.channel.recordFact(fact({ factId: 'fact-cap-1' }))
    let second
    try { second = await observe(h.channel.recordFact(fact({ factId: 'fact-cap-2' }))) } catch (error) { second = { state: 'rejected', code: error?.code ?? null } }
    record('I-capacity', { first: await observe(first), second })
    h.channel.close()
  }
  {
    const h = make()
    const pending = h.channel.beforeNativeWrite(makeCommand('answer'))
    h.channel.close('fixture-close')
    record('I-close', { settled: await observe(pending) })
  }

  const get = (id) => cases.find((entry) => entry.id === id)
  return {
    protocol: 'selected-i-current-consumer/1',
    surface: 'current committed I CoordinatorChannelModule (materialized exact commit)',
    modelCalls: 0, vendorTurns: 0, signalsSent: 0,
    cases,
    checks: {
      fact: get('I-fact')?.settled.state === 'resolved' && get('I-fact')?.duplicate === false,
      ackFailed: get('I-ack-failed')?.settled.state === 'rejected',
      payload: get('I-payload')?.settled.state === 'resolved' && get('I-payload')?.wrong === false,
      writeAllow: get('I-write-allow')?.settled.state === 'resolved',
      writeDeny: get('I-write-deny')?.settled.state === 'rejected',
      freshIntentFixed: get('I-fresh-intent')?.fixed === true,
      queueNamespace: get('I-queue-namespace')?.payloadStillPending === true && get('I-queue-namespace')?.payload.state === 'resolved',
      timeoutPrune: get('I-timeout-prune')?.settled.code === 'timeout' && get('I-timeout-prune')?.pendingFacts === 0 && get('I-timeout-prune')?.late === false,
      generation: get('I-generation')?.second === 2 && get('I-generation')?.stale === 'stale_connection' && get('I-generation')?.oldReply === false,
      oldLease: get('I-old-lease')?.settled.state === 'resolved',
      capacity: get('I-capacity')?.second.code === 'capacity',
      close: ['closed', 'indeterminate'].includes(get('I-close')?.settled.code),
    },
  }
}
