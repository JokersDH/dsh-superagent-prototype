/**
 * Actual three-consumer exercise over B's real runner service and its original stdio bridge v1.
 *
 * The service (`serveRunner`), fact/payload/write ports, frame validation and durable-receipt path
 * are the real B implementation; the driver is a deterministic fixture that only calls the existing
 * hooks. No model, vendor CLI, native profile or coordinator/ledger is created. The new
 * CoordinatorChannel/attach-channel surface from I is not part of this file and remains NOT_REACHED.
 *
 * Callbacks measured:
 *   - fact sink: every `io.record` becomes a real `fact` frame; the reply is a durable A receipt
 *     (ProductStore.facts.record, deduplicated by factId) or `ack-failed`;
 *   - payload reader: `io.payloads.read` on a coordinator-owned reference becomes a real
 *     `payload-read` frame and resolves from the reply;
 *   - native-write guard: `hooks.beforeNativeWrite(answer)` becomes a real `native-write-intent`
 *     frame and only continues on that command's `write-admission`.
 */
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { serveRunner } from '../../../apps/runner/src/runner-service.ts'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { makeAttemptSpec, makeCommand, makeFact } from '../../../packages/testing/src/index.ts'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const PAYLOAD_REFERENCE = 'coordinator-payload-wave27'
export const PAYLOAD_VALUE = { kind: 'coordinator-payload/1', items: [1, 2, 3], nested: { ok: true } }
export const ACK_FAILED_FACT = 'fact-ack-failed-wave27'
const READY_TIMEOUT_MS = 3000

async function until(read, predicate, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = read()
    if (predicate(latest)) return latest
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5))
  }
  throw new Error(`Consumer condition timed out: ${JSON.stringify(latest).slice(0, 400)}`)
}

export async function runServiceConsumer({ root, admission = 'allow' }) {
  const stateRoot = join(root, 'state')
  const payloadRoot = join(root, 'payloads')
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
  mkdirSync(payloadRoot, { recursive: true, mode: 0o700 })
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const spec = makeAttemptSpec()
  const frames = []
  const counts = {
    factFrames: 0, payloadReadFrames: 0, writeIntentFrames: 0,
    receiptsSent: 0, ackFailedSent: 0,
    factCallbacksResolved: 0, factCallbackFailuresCaught: 0,
    payloadReadsResolved: 0, payloadReadFailures: 0,
    writeAdmissions: 0, writeDenied: 0,
  }
  const observed = { receipts: [], payload: null, ackFailure: null, admittedWrite: false, writeDeniedReason: null }
  const input = new PassThrough()
  const send = (frame) => input.write(`${JSON.stringify({ v: 1, ...frame })}\n`)

  const respond = (frame) => {
    if (frame.type === 'fact') {
      counts.factFrames += 1
      if (frame.fact.factId === ACK_FAILED_FACT) {
        counts.ackFailedSent += 1
        send({ type: 'ack-failed', id: frame.id, factId: frame.fact.factId, reason: 'fixture_receiver_refused' })
        return
      }
      const receipt = store.facts.record(frame.fact.factId, sha256(JSON.stringify(frame.fact)), () => {})
      counts.receiptsSent += 1
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
      counts.writeAdmissions += 1
      const allowed = admission === 'allow'
      if (!allowed) counts.writeDenied += 1
      send({ type: 'write-admission', id: frame.id, allowed })
    }
  }

  let hooks = null
  const serving = serveRunner({
    input,
    write: (frame) => { frames.push(structuredClone(frame)); respond(frame) },
    payloads: { read: async () => null },
    eagerPrepare: false,
    createDriver: (_spec, providedHooks) => {
      hooks = providedHooks
      return {
        inspect: async () => { throw new Error('fixture has no inspection') },
        reconcile: async () => { throw new Error('fixture has no reconciliation') },
        serve: async (_attempt, io) => {
          try {
            observed.payload = await io.payloads.read(PAYLOAD_REFERENCE)
            counts.payloadReadsResolved += 1
          } catch (error) {
            counts.payloadReadFailures += 1
            observed.payloadFailure = String(error?.message ?? error)
          }
          const fact = makeFact('turn.ended', 'payload-1', { factId: 'fact-duplicate-wave27', source: 'runner-link' })
          try {
            const first = await io.record(fact)
            const second = await io.record(fact)
            observed.receipts.push(first, second)
            counts.factCallbacksResolved += 2
            observed.duplicateReceiptSameSeq = first.seq === second.seq
          } catch (error) {
            counts.factCallbackFailuresCaught += 1
            observed.factFailure = String(error?.message ?? error)
          }
          const refused = makeFact('candidate.observed', 'payload-2', { factId: ACK_FAILED_FACT, source: 'runner-link' })
          try {
            await io.record(refused)
            observed.ackFailure = 'unexpectedly_resolved'
          } catch (error) {
            counts.factCallbackFailuresCaught += 1
            observed.ackFailure = String(error?.message ?? error)
          }
          try {
            await hooks.beforeNativeWrite(makeCommand('answer'))
            observed.admittedWrite = admission === 'allow'
          } catch (error) {
            observed.writeDeniedReason = String(error?.message ?? error)
          }
          return { reason: 'terminal', evidenceRefs: ['fixture-consumer'] }
        },
      }
    },
  })

  send({
    type: 'bootstrap', id: 'bootstrap', spec, payloadRoot,
    journalPath: join(stateRoot, 'critical.journal'),
    producer: { source: 'fixture-channel-source-wave27', runnerIdentityRef: 'fixture-runner-identity-wave27' },
  })
  await until(() => frames, (value) => value.some((frame) => frame.type === 'ready'))
  send({ type: 'command', id: 'command-begin-wave27', command: makeCommand('begin') })
  await until(() => frames, (value) => value.some((frame) => frame.type === 'exited'))
  input.end()
  const handle = await serving
  await handle.done
  await handle.shutdown()
  store.close()

  return {
    protocol: 'channel-service-consumer/1',
    surface: 'original stdio bridge v1 (B runner-service + payload/fact/write ports)',
    executor: 'deterministic fixture driver',
    modelCalls: 0,
    vendorTurns: 0,
    signalsSent: 0,
    admission,
    counts,
    observed: {
      payload: observed.payload,
      receipts: observed.receipts.map((receipt) => ({ factId: receipt.factId, persisted: receipt.persisted, seq: receipt.seq })),
      duplicateReceiptSameSeq: observed.duplicateReceiptSameSeq ?? null,
      ackFailure: observed.ackFailure,
      admittedWrite: observed.admittedWrite,
      writeDeniedReason: observed.writeDeniedReason,
    },
    frames: frames.map((frame) => ({ type: frame.type, ...(frame.type === 'fact' ? { factId: frame.fact.factId } : {}), ...(frame.type === 'native-write-intent' ? { commandId: frame.command.id } : {}) })),
    exit: { reason: 'terminal' },
  }
}
