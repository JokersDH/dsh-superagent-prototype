/**
 * Independent consumer of I's actual CoordinatorChannelModule (selected source, exact blob bound).
 *
 * It drives the real module with local frames and a manual clock, so CAS/generation/late/close/
 * timeout/capacity and the three callbacks execute; it does not edit I or create a parallel channel.
 * A known I defect (a settled allow reply for one command.id resolving a later intent) is measured and
 * reported as a defect for I, not patched here.
 */
import { makeAttemptSpec, makeCommand, makeFact } from '../../../packages/testing/src/index.ts'

export const SOURCE = 'fixture-channel-source-wave28'
export const RUNNER_IDENTITY = 'fixture-runner-identity-wave28'

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

function observe(promise, timeoutMs = 400) {
  const state = { state: 'pending', value: undefined, code: null, reason: null }
  promise.then(
    (value) => { state.state = 'resolved'; state.value = value },
    (error) => { state.state = 'rejected'; state.code = error?.code ?? null; state.reason = error?.reason ?? String(error?.message ?? error) },
  )
  return new Promise((resolvePromise) => {
    setTimeout(() => resolvePromise({ ...state }), timeoutMs)
  })
}

export async function runIConsumer({ iRoot }) {
  const { CoordinatorChannelModule } = await import(new URL(`file://${iRoot}/apps/runner/src/attach-channel/index.ts`).href)
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
  const record = (id, fn) => cases.push({ id, ...fn })

  const make = (overrides = {}) => {
    const clock = manualClock()
    const channel = new CoordinatorChannelModule({ producer, limits: { ...limits, ...overrides }, now: clock.now, schedule: clock.schedule })
    const frames = []
    let lease = null
    const bind = (expectedGeneration = 0, connectionId = 'conn-a') => {
      lease = channel.bind({ producer, connectionId, expectedGeneration, send: (request) => frames.push(request) })
      return lease
    }
    bind()
    return { channel, clock, frames, get lease() { return lease }, bind }
  }

  // 1. fact -> durable receipt, duplicate reply cannot revive.
  {
    const h = make()
    const pending = h.channel.recordFact(fact({ factId: 'fact-wave28-1' }))
    const request = h.frames[0]
    const accepted = h.lease.receive({ v: 1, type: 'receipt', id: request.id, factId: request.id, receipt: { factId: request.id, persisted: true, seq: 7 } })
    const settled = await observe(pending)
    const duplicate = h.lease.receive({ v: 1, type: 'receipt', id: request.id, factId: request.id, receipt: { factId: request.id, persisted: true, seq: 8 } })
    record('I-fact-receipt', { frameId: request.id, accepted, settled, duplicate })
    h.channel.close()
  }

  // 2. ack-failed.
  {
    const h = make()
    const pending = h.channel.recordFact(fact({ factId: 'fact-wave28-ack' }))
    const request = h.frames[0]
    const accepted = h.lease.receive({ v: 1, type: 'ack-failed', id: request.id, factId: request.id, reason: 'ingress_unavailable' })
    record('I-fact-ack-failed', { accepted, settled: await observe(pending) })
    h.channel.close()
  }

  // 3. payload read + wrong correlation.
  {
    const h = make()
    const pending = h.channel.readPayload('payload-ref-1')
    const request = h.frames[0]
    const wrong = h.lease.receive({ v: 1, type: 'payload', id: 'other', requestId: 'other', value: { wrong: true } })
    const accepted = h.lease.receive({ v: 1, type: 'payload', id: request.id, requestId: request.requestId, value: { right: true } })
    record('I-payload', { requestId: request.requestId, wrong, accepted, settled: await observe(pending) })
    h.channel.close()
  }

  // 4/5. native-write allow and deny.
  {
    const h = make()
    const command = makeCommand('answer')
    const pending = h.channel.beforeNativeWrite(command)
    const request = h.frames[0]
    const accepted = h.lease.receive({ v: 1, type: 'write-admission', id: request.id, allowed: true })
    record('I-write-allow', { frameId: request.id, commandId: command.id, accepted, settled: await observe(pending) })
    h.channel.close()
  }
  {
    const h = make()
    const pending = h.channel.beforeNativeWrite(makeCommand('answer'))
    const request = h.frames[0]
    const accepted = h.lease.receive({ v: 1, type: 'write-admission', id: request.id, allowed: false })
    record('I-write-deny', { accepted, settled: await observe(pending) })
    h.channel.close()
  }

  // 6. fresh-intent correlation: a settled allow must not authorize the next intent for same id.
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
    const secondState = await observe(second)
    record('I-fresh-intent', {
      firstFrameId: firstFrame.id, secondFrameId: secondFrame?.id ?? null,
      sameFrameId: firstFrame.id === secondFrame?.id, replayAccepted: replay,
      firstSettled: firstSettled.state, secondState: secondState.state,
      defect: secondState.state === 'resolved',
      expectation: 'a new intent needs a fresh correlation and its own guard decision',
    })
    h.channel.close()
  }

  // 7. generation CAS and stale expected generation.
  {
    const h = make()
    const first = h.lease
    let second = null
    let staleError = null
    try { second = h.channel.bind({ producer, connectionId: 'conn-b', expectedGeneration: 1, send: () => {} }) }
    catch (error) { staleError = error?.code ?? String(error) }
    let wrongExpected = null
    try { h.channel.bind({ producer, connectionId: 'conn-c', expectedGeneration: 0, send: () => {} }) }
    catch (error) { wrongExpected = error?.code ?? String(error) }
    record('I-generation-cas', {
      firstGeneration: first.generation, secondGeneration: second?.generation ?? null,
      staleError: staleError, wrongExpected, oldReceiver: first.receive({ v: 1, type: 'receipt', id: 'x', factId: 'x', receipt: { factId: 'x', persisted: true, seq: 1 } }),
    })
    h.channel.close()
  }

  // 8. old lease close does not close the replacement.
  {
    const h = make()
    const first = h.lease
    const second = h.bind(1, 'conn-b')
    first.close('old client')
    const pending = h.channel.readPayload('payload-after-old-close')
    const request = h.frames.at(-1)
    const accepted = second.receive({ v: 1, type: 'payload', id: request.id, requestId: request.requestId, value: { ok: true } })
    record('I-old-lease-close', { accepted, settled: await observe(pending), generation: second.generation })
    h.channel.close()
  }

  // 9. timeout through the module's own timer.
  {
    const h = make({ requestTimeoutMs: 100 })
    const pending = h.channel.recordFact(fact({ factId: 'fact-timeout' }))
    h.clock.advance(101)
    record('I-timeout', { settled: await observe(pending) })
    h.channel.close()
  }

  // 10. capacity on facts.
  {
    const h = make({ maxPendingFacts: 1 })
    const first = h.channel.recordFact(fact({ factId: 'fact-cap-1' }))
    let second
    try { second = await observe(h.channel.recordFact(fact({ factId: 'fact-cap-2' }))) }
    catch (error) { second = { state: 'rejected', value: undefined, code: error?.code ?? null, reason: error?.reason ?? String(error?.message ?? error) } }
    record('I-capacity', { first: await observe(first), second })
    h.channel.close()
  }

  // 11. module close rejects a pending write as closed/indeterminate.
  {
    const h = make()
    const pending = h.channel.beforeNativeWrite(makeCommand('answer'))
    h.channel.close('fixture-close')
    record('I-close', { settled: await observe(pending) })
  }

  const defects = cases.filter((entry) => entry.defect === true).map((entry) => entry.id)
  return {
    protocol: 'selected-i-consumer/1',
    surface: 'I CoordinatorChannelModule (actual source, local frames + manual clock)',
    modelCalls: 0, vendorTurns: 0, signalsSent: 0,
    cases, defects,
    checks: {
      factReceipt: cases.find((entry) => entry.id === 'I-fact-receipt')?.settled.state === 'resolved',
      ackFailed: cases.find((entry) => entry.id === 'I-fact-ack-failed')?.settled.state === 'rejected',
      payload: cases.find((entry) => entry.id === 'I-payload')?.settled.state === 'resolved',
      writeAllow: cases.find((entry) => entry.id === 'I-write-allow')?.settled.state === 'resolved',
      writeDeny: cases.find((entry) => entry.id === 'I-write-deny')?.settled.state === 'rejected',
      generation: cases.find((entry) => entry.id === 'I-generation-cas')?.secondGeneration === 2 && cases.find((entry) => entry.id === 'I-generation-cas')?.wrongExpected === 'stale_connection',
      oldLease: cases.find((entry) => entry.id === 'I-old-lease-close')?.accepted === true,
      timeout: cases.find((entry) => entry.id === 'I-timeout')?.settled.code === 'timeout',
      capacity: cases.find((entry) => entry.id === 'I-capacity')?.second.code === 'capacity',
      close: ['closed', 'indeterminate'].includes(cases.find((entry) => entry.id === 'I-close')?.settled.code),
      freshIntentDefectObserved: cases.find((entry) => entry.id === 'I-fresh-intent')?.defect === true,
    },
  }
}
