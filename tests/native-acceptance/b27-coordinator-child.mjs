#!/usr/bin/env node
/**
 * A separate coordinator process for the wave-27 SIGKILL window.
 *
 * It knows only the registration the previous coordinator left behind: the endpoint path, the pinned
 * dev/ino, the credential file and the original attempt tuple. It attaches, reports what it observes and
 * optionally feeds one command. The parent kills it with SIGKILL to model a real coordinator crash.
 */
import { lstatSync, readFileSync } from 'node:fs'
import { connectRunnerRecovery } from '../../packages/execution/src/recovery-transport.ts'
import { makeCommand } from '../../packages/testing/src/index.ts'

const registration = JSON.parse(readFileSync(process.env.PA_W27_REGISTRATION, 'utf8'))
const mode = process.env.PA_W27_MODE ?? 'probe'
const stat = lstatSync(registration.socketPath)
if (stat.dev !== registration.socketIdentity.dev || stat.ino !== registration.socketIdentity.ino) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: 'inode_mismatch' })}\n`)
  process.exit(3)
}
const client = connectRunnerRecovery(
  { socketPath: registration.socketPath, credentialPath: registration.credentialPath, socketIdentity: registration.socketIdentity },
  { attempt: registration.attempt, runnerIdentityRef: registration.runnerIdentityRef, source: registration.source },
  3000,
)
const out = { ok: true, pid: process.pid, mode }
out.inspect = await client.inspect().then(value => ({ attemptId: value.inspection.attempt.attemptId, fenceEpoch: value.inspection.attempt.fenceEpoch, state: value.inspection.state })).catch(error => ({ error: String(error?.message ?? error).slice(0, 100) }))
const page = await client.facts(0, 16_384)
out.factIds = page.frames.map(frame => frame.fact?.factId)
out.factKinds = page.frames.map(frame => frame.fact?.kind)
out.leaseIds = []
if (mode === 'resume') {
  // The same original command id is fed again: an unknown must keep its id, not invent a new one.
  out.beginAgain = await client.command(makeCommand('begin', { id: registration.beginCommandId, inputRef: registration.inputRef, preparedPolicyRef: registration.policySnapshotRef }))
    .then(value => ({ ok: true, value })).catch(error => ({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 120) }))
  out.deliverAgain = await client.command(makeCommand('deliver', { id: registration.deliverCommandId, inputRef: registration.inputRef }))
    .then(value => ({ ok: true, value })).catch(error => ({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 120) }))
}
process.stdout.write(`${JSON.stringify(out)}\n`)
// In probe mode stay alive so the parent's SIGKILL, not a natural exit, ends this coordinator.
if (mode === 'probe') setInterval(() => {}, 1000)
