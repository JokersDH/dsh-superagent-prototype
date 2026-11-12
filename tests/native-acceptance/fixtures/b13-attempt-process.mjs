#!/usr/bin/env node
/**
 * B13 coordinator process fixture (wave-12 B5-B7).
 *
 * One short-lived coordinator process. It opens the REAL ProductStore at the shared state root,
 * talks to the REAL independent Runner over the authenticated socket, and records its commands
 * through A's real `store.commands` receipts - not a test-owned table.
 *
 * Modes either take one control step and report, or kill themselves with SIGKILL at a named window so
 * the driver can prove what a fresh process finds afterwards.
 *
 * Usage: node b13-attempt-process.mjs <stateRoot> <sceneDir> <mode>
 * Modes: begin | question | answer | stop | recover
 */
import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/src/index.ts'
import { connectRunnerRecovery } from '../../../apps/coordinator/runner-link.ts'
// The Runner serves ONE identity. The coordinator must speak that same identity, or every link
// call is an identity mismatch - which is the product rule, not a test detail.
import { producer } from '../../integration/runtime-ingress-fixture.ts'

const [stateRoot, sceneDir, mode] = process.argv.slice(2)
if (!stateRoot || !sceneDir || !mode) throw new Error('usage: <stateRoot> <sceneDir> <mode>')

const credentialPath = join(sceneDir, 'runner.key')
const socketPath = join(sceneDir, 'runner.sock')

/** Kill this process exactly at a control window, so the driver sees a real crash, not an exit. */
function crashAt(window) {
  process.stdout.write(`${JSON.stringify({ crashed: window, pid: process.pid })}\n`)
  process.kill(process.pid, 'SIGKILL')
  // SIGKILL is not catchable, but keep a hard stop in case the platform delays it.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
}

// stateRoot is a directory; the real product database lives inside it.
const store = new ProductStore({ path: join(stateRoot, 'product.sqlite') })
const endpoint = (() => {
  const stat = lstatSync(socketPath)
  return { socketPath, credentialPath, socketIdentity: { dev: stat.dev, ino: stat.ino } }
})()


/** Record one command through the real idempotent receipts. The digest is the command body. */
function record(commandId, body) {
  const digest = `sha256:${Buffer.from(JSON.stringify(body)).toString('base64')}`
  const receipt = store.commands.record(commandId, digest, () => body)
  return { commandId, replayed: receipt.replayed, seq: receipt.seq }
}

const ticketId = producer.attempt.ticketId
const assignmentId = producer.attempt.assignmentId
const attemptId = producer.attempt.attemptId
const fenceEpoch = producer.attempt.fenceEpoch
const binding = { ...producer.attempt, state: 'running', ticketId, assignmentId, attemptId, resources: [] }

try {
  if (mode === 'begin') {
    store.bindings.record(binding)
    const recorded = record('cmd-begin', { kind: 'begin', attemptId, fenceEpoch })
    crashAt('after-begin')
    process.stdout.write(`${JSON.stringify({ recorded })}\n`)
  } else if (mode === 'question' || mode === 'answer') {
    store.bindings.record(binding)
    record('cmd-begin', { kind: 'begin', attemptId, fenceEpoch })
    const client = connectRunnerRecovery(endpoint, producer)
    const inspection = await client.inspect()
    if (mode === 'question') {
      record('cmd-question-1', { kind: 'question', attemptId, questionId: 'q-1' })
      crashAt('after-question')
    } else {
      record('cmd-question-1', { kind: 'question', attemptId, questionId: 'q-1' })
      record('cmd-answer-1', { kind: 'answer', attemptId, questionId: 'q-1', answerId: 'a-1' })
      crashAt('after-answer')
    }
    process.stdout.write(`${JSON.stringify({ inspection: inspection.inspection?.state })}\n`)
  } else if (mode === 'stop') {
    store.bindings.record(binding)
    record('cmd-begin', { kind: 'begin', attemptId, fenceEpoch })
    const client = connectRunnerRecovery(endpoint, producer)
    const stopped = await client.cancel({ ...producer.attempt, id: 'cmd-stop', kind: 'cancel' })
    // Crash AFTER the stop was acknowledged but BEFORE the coordinator records its own receipt: the
    // window where a naive recovery would resend the stop or report the writer as still active.
    crashAt('after-stop-ack')
    process.stdout.write(`${JSON.stringify({ stopped: stopped.inspection?.state })}\n`)
  } else if (mode === 'recover') {
    // A genuinely fresh process over the same store and the same independent Runner.
    const commands = ['cmd-begin', 'cmd-question-1', 'cmd-answer-1', 'cmd-stop']
    const found = commands.map(id => ({ id, seq: store.commands.get(id)?.seq ?? null }))
    const client = connectRunnerRecovery(endpoint, producer)
    const inspection = (await client.inspect()).inspection
    // The durable identity lives in the real command receipt body, which is what a recovering
    // process actually has to work from.
    const beginResult = store.commands.get('cmd-begin')?.result
    process.stdout.write(`${JSON.stringify({
      found,
      attemptId: beginResult?.attemptId ?? null,
      fenceEpoch: beginResult?.fenceEpoch ?? null,
      runnerState: inspection?.state ?? null,
      runnerAdmission: inspection?.admission ?? null,
      writer: inspection?.resources?.[0]?.writer ?? null,
      coverage: inspection?.coverage ?? null,
    })}\n`)
  } else {
    throw new Error(`unknown mode ${mode}`)
  }
} finally {
  try { store.db.close() } catch {}
}
