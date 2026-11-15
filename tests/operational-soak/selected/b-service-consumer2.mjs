/**
 * Wave-29 actual B runner-service consumer.
 *
 * Runs the committed B `serveRunner` (which imports the current I module) with a deterministic fixture
 * driver to measure the three callbacks, external allow/deny guard, and the sink-only native hook.
 * The sink-only path is measured, not fixed: if it allows without any external guest guard, it is
 * reported as a B finding. Zero model/native/signal; the fact sink is the original A ProductStore.
 */
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { makeAttemptSpec, makeCommand, makeFact } from '../../../packages/testing/src/index.ts'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const SOURCE = 'fixture-channel-source-wave29'
export const RUNNER_IDENTITY = 'fixture-runner-identity-wave29'
export const PAYLOAD_REFERENCE = 'coordinator-payload-wave29'
export const PAYLOAD_VALUE = { kind: 'coordinator-payload/1', items: [1, 2, 3] }
export const ACK_FAILED_FACT = 'fact-ack-failed-wave29'
const READY_TIMEOUT_MS = 4000

async function until(read, predicate, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = read()
    if (predicate(latest)) return latest
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5))
  }
  throw new Error(`B service condition timed out: ${JSON.stringify(latest).slice(0, 400)}`)
}

async function runService({ treeRoot, root, mode }) {
  const stateRoot = join(root, 'state')
  const payloadRoot = join(root, 'payloads')
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
  mkdirSync(payloadRoot, { recursive: true, mode: 0o700 })
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const spec = makeAttemptSpec()
  const input = new PassThrough()
  const frames = []
  const counts = { factFrames: 0, payloadReadFrames: 0, writeIntentFrames: 0, receipts: 0, ackFailed: 0, externalGuardCalls: 0, externalDenied: 0, sinkOnlyHookResolved: false }
  const observed = { payload: null, ackFailure: null, duplicateSameSeq: null, admitted: null, deniedReason: null }
  const send = (frame) => input.write(`${JSON.stringify({ v: 1, ...frame })}\n`)
  const respond = (frame) => {
    if (frame.type === 'fact') {
      counts.factFrames += 1
      if (frame.fact.factId === ACK_FAILED_FACT) {
        counts.ackFailed += 1
        send({ type: 'ack-failed', id: frame.id, factId: frame.fact.factId, reason: 'fixture_receiver_refused' })
        return
      }
      const receipt = store.facts.record(frame.fact.factId, sha256(JSON.stringify(frame.fact)), () => {})
      counts.receipts += 1
      send({ type: 'receipt', id: frame.id, factId: frame.fact.factId, receipt })
      return
    }
    if (frame.type === 'payload-read') {
      counts.payloadReadFrames += 1
      send({ type: 'payload', id: frame.requestId, requestId: frame.requestId, value: PAYLOAD_VALUE })
      return
    }
    if (frame.type === 'native-write-intent') {
      counts.writeIntentFrames += 1
      counts.externalGuardCalls += 1
      const allowed = mode !== 'deny'
      if (!allowed) counts.externalDenied += 1
      send({ type: 'write-admission', id: frame.id, allowed })
    }
  }
  const sink = mode === 'sink-only'
    ? { record: async (fact) => store.facts.record(fact.factId, sha256(JSON.stringify(fact)), () => {}) }
    : undefined
  const { serveRunner } = await import(new URL(`file://${treeRoot}/apps/runner/src/runner-service.ts`).href)
  let hooks
  const serving = serveRunner({
    input,
    write: (frame) => { frames.push(structuredClone(frame)); respond(frame) },
    payloads: { read: async () => null },
    eagerPrepare: false,
    ...(sink === undefined ? {} : { sink }),
    createDriver: (_spec, providedHooks) => {
      hooks = providedHooks
      return {
        inspect: async () => { throw new Error('fixture') },
        reconcile: async () => { throw new Error('fixture') },
        serve: async (_attempt, io) => {
          if (mode !== 'sink-only') {
            try {
              observed.payload = await io.payloads.read(PAYLOAD_REFERENCE)
            } catch (error) { observed.payloadFailure = String(error?.message ?? error) }
            const fact = makeFact('turn.ended', 'payload-1', { factId: 'fact-duplicate-wave29', source: SOURCE })
            const first = await io.record(fact)
            const second = await io.record(fact)
            observed.duplicateSameSeq = first.seq === second.seq
            try { await io.record(makeFact('candidate.observed', 'payload-2', { factId: ACK_FAILED_FACT, source: SOURCE })) } catch (error) { observed.ackFailure = String(error?.message ?? error) }
          }
          try {
            await hooks.beforeNativeWrite(makeCommand('answer'))
            observed.admitted = true
            if (mode === 'sink-only') counts.sinkOnlyHookResolved = true
          } catch (error) {
            observed.admitted = false
            observed.deniedReason = String(error?.message ?? error)
          }
          return { reason: 'terminal', evidenceRefs: ['fixture-consumer'] }
        },
      }
    },
  })
  send({ type: 'bootstrap', id: 'bootstrap', spec, payloadRoot, journalPath: join(stateRoot, 'critical.journal'), producer: { source: SOURCE, runnerIdentityRef: RUNNER_IDENTITY } })
  await until(() => frames, (value) => value.some((frame) => frame.type === 'ready'))
  send({ type: 'command', id: 'command-begin-wave29', command: makeCommand('begin') })
  await until(() => frames, (value) => value.some((frame) => frame.type === 'exited'))
  input.end()
  const handle = await serving
  await handle.done
  await handle.shutdown()
  store.close()
  return { mode, counts, observed, frames: frames.map((frame) => frame.type) }
}

export async function runBCurrentConsumer({ treeRoot, root }) {
  const normal = await runService({ treeRoot, root: join(root, 'normal'), mode: 'allow' })
  const deny = await runService({ treeRoot, root: join(root, 'deny'), mode: 'deny' })
  const sinkOnly = await runService({ treeRoot, root: join(root, 'sink-only'), mode: 'sink-only' })
  const checks = {
    factThreeFrames: normal.counts.factFrames === 3 && normal.counts.receipts === 2 && normal.counts.ackFailed === 1,
    duplicateReceipt: normal.observed.duplicateSameSeq === true,
    payloadRead: normal.counts.payloadReadFrames >= 1 && normal.observed.payload !== null && normal.observed.payload.kind === 'coordinator-payload/1',
    externalAllow: normal.counts.writeIntentFrames === 1 && normal.observed.admitted === true,
    externalDeny: deny.counts.writeIntentFrames === 1 && deny.observed.admitted === false && deny.counts.externalDenied === 1,
    sinkOnlyFinding: sinkOnly.counts.sinkOnlyHookResolved === true && sinkOnly.counts.externalGuardCalls === 0,
  }
  return {
    protocol: 'selected-b-current-consumer/1',
    surface: 'current committed B serveRunner with current I attach-channel (materialized)',
    executor: 'deterministic fixture driver',
    modelCalls: 0, vendorTurns: 0, signalsSent: 0,
    normal, deny, sinkOnly, checks,
    findings: checks.sinkOnlyFinding
      ? [{ id: 'B29-SINK-ONLY-NATIVE-HOOK-AUTOBYPASS', owner: 'B', detail: 'sink-only native hook resolved with externalGuardCalls=0; main/Broker guard was not supplied or consulted' }]
      : [],
  }
}
