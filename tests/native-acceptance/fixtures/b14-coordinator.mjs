#!/usr/bin/env node
/**
 * B14 coordinator process fixture (wave-14 B1).
 *
 * One short-lived coordinator that talks to the INDEPENDENT Runner over the existing authenticated
 * transport and records into A's real product store. Modes either perform one control step and kill
 * themselves with SIGKILL at a named window, or recover from the same store while the Runner is still
 * the same living process.
 *
 * Modes: begin | answer | stopack | recover | deliver
 * Usage: node b14-coordinator.mjs <stateRoot> <sceneDir> <mode>
 */
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/src/index.ts'
import { connectRunnerRecovery } from '../../../apps/coordinator/runner-link.ts'
import { producer } from '../../integration/runtime-ingress-fixture.ts'

const [stateRoot, sceneDir, mode] = process.argv.slice(2)
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`)

/** Die exactly at a control window so recovery is measured against a real crash. */
/**
 * Kill at a control window, but emit the FULL stage record first.
 *
 * Wave-14 emitted only `{crashed}` here, so the driver read the last stdout line and the earlier
 * `cancelError` was lost - which is how a refused cancel looked like a mysterious zero count.
 * Now every stage record is emitted exactly once and the crash marker is additive.
 */
function crashAt(window, stage) {
  emit({ ...stage, crashed: window, pid: process.pid })
  process.kill(process.pid, 'SIGKILL')
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
}

const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const stat = lstatSync(join(sceneDir, 'runner.sock'))
const endpoint = { socketPath: join(sceneDir, 'runner.sock'), credentialPath: join(sceneDir, 'runner.key'), socketIdentity: { dev: stat.dev, ino: stat.ino } }
const counters = () => JSON.parse(readFileSync(join(sceneDir, 'receivers.json'), 'utf8'))
const runnerState = () => JSON.parse(readFileSync(join(sceneDir, 'writer-state.json'), 'utf8'))

const attemptId = producer.attempt.attemptId
const fenceEpoch = producer.attempt.fenceEpoch
const receipt = (commandId, body) => store.commands.record(commandId, `sha256:${Buffer.from(JSON.stringify(body)).toString('base64')}`, () => body)

try {
  const client = connectRunnerRecovery(endpoint, producer)
  if (mode === 'begin') {
    const before = counters()
    receipt('cmd-begin', { kind: 'begin', attemptId, fenceEpoch })
    await client.inspect()
    const after = counters()
    crashAt('after-begin', { stage: 'begin', beginInspected: after.inspect - before.inspect, counters: after, epoch: fenceEpoch })
  } else if (mode === 'answer') {
    receipt('cmd-begin', { kind: 'begin', attemptId, fenceEpoch })
    await client.inspect()
    receipt('cmd-answer', { kind: 'answer', attemptId, questionId: 'q-1', answerId: 'a-1' })
    // The answer is durable in the store, but the coordinator dies before any delivery acknowledgement.
    crashAt('after-answer-recorded', { stage: 'answer', answerRecorded: true, epoch: fenceEpoch })
  } else if (mode === 'stopack') {
    // The stop is ACKed by the Runner and the coordinator dies BEFORE recording its own receipt:
    // the classic unknown-outcome window where a naive recovery would resend the stop.
    let stopped, cancelError
    try {
      stopped = await client.cancel({ ...producer.attempt, id: 'cmd-stop', kind: 'cancel', fenceEpoch })
    } catch (error) {
      cancelError = String(error?.message ?? error).slice(0, 300)
    }
    crashAt('after-stop-ack', { stage: 'stop', stopAcked: stopped?.inspection?.state ?? null, cancelError: cancelError ?? null, counters: counters(), epoch: fenceEpoch })
  } else if (mode === 'stale') {
    // A GENUINELY old epoch must never reach the live writer. The current epoch is whatever the
    // authenticated inspection reports; wave-14 wrongly sent the current 1 and called it stale.
    const current = (await client.inspect()).inspection.attempt.fenceEpoch
    const older = current - 1
    try {
      await client.cancel({ ...producer.attempt, id: `older-epoch-${older}`, kind: 'cancel', fenceEpoch: older })
      emit({ stage: 'epoch', currentEpoch: current, sentEpoch: older, olderRefused: false, outcome: 'ACCEPTED' })
    } catch (error) {
      emit({ stage: 'epoch', currentEpoch: current, sentEpoch: older, olderRefused: true, outcome: String(error?.message ?? error).slice(0, 160) })
    }
  } else if (mode === 'recover' || mode === 'deliver') {
    const inspection = (await client.inspect()).inspection
    const recovery = store.queue.dueRows('runtime.reconcile', Number.MAX_SAFE_INTEGER, 10)
    const beginReceipt = store.commands.get('cmd-begin')
    const stopReceipt = store.commands.get('cmd-stop')
    const answerReceipt = store.commands.get('cmd-answer')
    let delivery = null
    if (mode === 'deliver') {
      // Post-recovery delivery: the recovered coordinator completes the pending answer through the
      // same living Runner, and the store records the delivery exactly once.
      if (inspection?.admission === 'closed') {
        delivery = { delivered: false, reason: 'the writer closed admission; a recovered process must not deliver into a stopped writer' }
      } else {
        receipt('cmd-deliver', { kind: 'deliver', attemptId, questionId: 'q-1' })
        delivery = { delivered: Boolean(store.commands.get('cmd-deliver')), outcome: 'recorded_after_recovery' }
      }
    }
    emit({
      attemptId, fenceEpoch,
      runnerState: inspection?.state ?? null,
      admission: inspection?.admission ?? null,
      coverage: inspection?.coverage ?? null,
      writer: inspection?.resources?.[0]?.writer ?? null,
      runnerPidSeen: String(inspection?.evidence?.find(item => String(item).startsWith('runner-pid:')) ?? '').split(':')[1] ?? null,
      receipts: { begin: beginReceipt?.seq ?? null, answer: answerReceipt?.seq ?? null, stop: stopReceipt?.seq ?? null, deliver: store.commands.get('cmd-deliver')?.seq ?? null },
      counters: counters(),
      runnerOwner: runnerState(),
      reconcileRows: recovery.length,
      delivery,
    })
  } else {
    throw new Error(`unknown mode ${mode}`)
  }
} finally {
  try { store.db.close() } catch {}
}
