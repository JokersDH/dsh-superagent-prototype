/**
 * Independent consumer of B's actual `createBusinessChannel` (selected source, exact blob bound).
 *
 * It exercises B's single generation-scoped pending store with local frames: fact/payload/write
 * request+reply, stale reply refusal, detach semantics and the implicit `lease(ref)` rebind surface.
 * The module is B-owned; H only observes and reports differences from the shared CAS/limits model.
 */
import { makeCommand } from '../../../packages/testing/src/index.ts'

function observe(promise, timeoutMs = 200) {
  const state = { state: 'pending', value: undefined, code: null, reason: null }
  promise.then(
    (value) => { state.state = 'resolved'; state.value = value },
    (error) => { state.state = 'rejected'; state.code = error?.code ?? null; state.reason = error?.reason ?? String(error?.message ?? error) },
  )
  return new Promise((resolvePromise) => setTimeout(() => resolvePromise({ ...state }), timeoutMs))
}

export async function runBConsumer({ bRoot }) {
  const { createBusinessChannel } = await import(new URL(`file://${bRoot}/apps/runner/src/business-channel.ts`).href)
  const cases = []
  const record = (id, value) => cases.push({ id, ...value })

  // 1. generation semantics: monotonic, same lease no-op, a different lease increments.
  {
    const channel = createBusinessChannel()
    const first = channel.bind('lease-a')
    const again = channel.bind('lease-a')
    const second = channel.bind('lease-b')
    record('B-generation', { first, again, second, monotonic: first === 1 && again === 1 && second === 2 })
    channel.detach({ reason: 'fixture-close' })
  }

  // 2/3/4. request + reply for the three callbacks.
  {
    const channel = createBusinessChannel()
    channel.bind('lease-a')
    const factSettledState = observe(channel.requestFact({ factId: 'fact-b-1' }))
    const factOutbound = channel.nextOutbound()
    const factReply = channel.reply('lease-a', { id: 'fact-b-1', kind: 'receipt', value: { factId: 'fact-b-1', persisted: true, seq: 11 } })
    const factSettled = await factSettledState
    const duplicate = channel.reply('lease-a', { id: 'fact-b-1', kind: 'receipt', value: { factId: 'fact-b-1', persisted: true, seq: 12 } })

    const payloadSettledState = observe(channel.requestPayload('payload-b-1', 'payload-ref-b-1'))
    const payloadOutbound = channel.nextOutbound()
    const payloadReply = channel.reply('lease-a', { id: 'payload-b-1', kind: 'payload', value: { ok: true } })
    const payloadSettled = await payloadSettledState

    const writeSettledState = observe(channel.requestWrite(makeCommand('answer').id, makeCommand('answer')))
    const writeOutbound = channel.nextOutbound()
    const writeReply = channel.reply('lease-a', { id: makeCommand('answer').id, kind: 'write-admission', value: true })
    const writeSettled = await writeSettledState

    record('B-three-callbacks', {
      factOutbound, factReply, factSettled, duplicate,
      payloadOutbound, payloadReply, payloadSettled,
      writeOutbound, writeReply, writeSettled,
      pending: channel.pending(), outbound: channel.outboundCount(),
    })
    channel.detach({ reason: 'fixture-close' })
  }

  // 5. deny path rejects the native write.
  {
    const channel = createBusinessChannel()
    channel.bind('lease-a')
    const pendingState = observe(channel.requestWrite(makeCommand('answer').id, makeCommand('answer')))
    channel.nextOutbound()
    const reply = channel.reply('lease-a', { id: makeCommand('answer').id, kind: 'write-admission', value: false })
    record('B-write-deny', { reply, settled: await pendingState })
    channel.detach({ reason: 'fixture-close' })
  }

  // 6. stale reply after rebind is refused; implicit rebind is observable without a CAS token.
  {
    const channel = createBusinessChannel()
    channel.bind('lease-a')
    const pendingState = observe(channel.requestFact({ factId: 'fact-stale-b' }))
    channel.nextOutbound()
    const rebound = channel.lease('lease-b')
    const stale = channel.reply('lease-a', { id: 'fact-stale-b', kind: 'receipt', value: { factId: 'fact-stale-b', persisted: true, seq: 1 } })
    record('B-stale-reply', { rebound, stale, settled: await pendingState, implicitRebind: rebound === 2 })
    channel.detach({ reason: 'fixture-close' })
  }

  // 7. detach: write indeterminate, fact detached, nothing left pending.
  {
    const channel = createBusinessChannel()
    channel.bind('lease-a')
    const writeState = observe(channel.requestWrite('cmd-detach-write', makeCommand('answer')))
    const factState = observe(channel.requestFact({ factId: 'fact-detach' }))
    const before = channel.pending()
    channel.detach({ reason: 'client replaced' })
    record('B-detach', { before, write: await writeState, fact: await factState, after: channel.pending() })
  }

  return {
    protocol: 'selected-b-consumer/1',
    surface: 'B createBusinessChannel (actual source; in-process frames, no runner-service route)',
    modelCalls: 0, vendorTurns: 0, signalsSent: 0,
    cases,
    observations: {
      hasExpectedGenerationCas: false,
      hasPerRequestTimer: false,
      hasConstructorPendingBytes: false,
      leaseRebind: 'implicit lease(ref) increments generation without a CAS token',
      detach: 'pending writes state_indeterminate; facts/payloads channel_detached',
    },
    checks: {
      generation: cases.find((entry) => entry.id === 'B-generation')?.monotonic === true,
      fact: cases.find((entry) => entry.id === 'B-three-callbacks')?.factSettled.state === 'resolved',
      factDuplicateRefused: cases.find((entry) => entry.id === 'B-three-callbacks')?.duplicate === false,
      payload: cases.find((entry) => entry.id === 'B-three-callbacks')?.payloadSettled.state === 'resolved',
      writeAllow: cases.find((entry) => entry.id === 'B-three-callbacks')?.writeSettled.state === 'resolved',
      writeDeny: cases.find((entry) => entry.id === 'B-write-deny')?.settled.state === 'rejected',
      staleRefused: cases.find((entry) => entry.id === 'B-stale-reply')?.stale === false,
      detachWriteIndeterminate: cases.find((entry) => entry.id === 'B-detach')?.write.code === 'state_indeterminate',
      detachFactRefused: cases.find((entry) => entry.id === 'B-detach')?.fact.reason === 'channel_detached',
    },
  }
}
