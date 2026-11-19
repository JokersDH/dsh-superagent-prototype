#!/usr/bin/env node
/**
 * Recovery milestone 01 / B: postcommit finalize must NOT close a terminal endpoint while any owned
 * resource is not quiescent. UNKNOWN resources retain the proof/material; a later legitimate finalize
 * (after the original barrier is complete) is the only exit.
 */
import assert from 'node:assert/strict'
import { lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { CaseLog, writeReport } from './harness.mjs'
import { serveRunner } from '../../apps/runner/src/runner-service.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'
import { ProcessHost } from '../../apps/runner/src/process-host.ts'
import { connectRunnerRecovery, runnerResourceManifestDigest, verifiedRunnerInspection } from '../../packages/execution/src/recovery-transport.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-ms1-unknown-'))
const spec = makeAttemptSpec()
const producer = { source: 'fake-driver', runnerIdentityRef: 'ms1-unknown-runner' }
const attempt = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
const context = { attempt, ...producer }
class UnknownHost extends ProcessHost {
  resources = [{ ref: 'unknown-writer', ownership: 'spawned_process', writer: 'indeterminate', evidence: ['unreadable-child'] }]
  inventory() { return this.resources }
}
const host = new UnknownHost()
const input = new PassThrough()
const frames = []
const serving = serveRunner({
  input,
  write: frame => frames.push(frame),
  recoveryRoot: join(root, 'recovery'),
  payloads: { read: async () => { throw new Error('no payload reader') } },
  processHost: host,
  createDriver: () => ({ inspect: async () => { throw new Error('no inspection') }, reconcile: async () => { throw new Error('no reconciliation') }, serve: async () => ({ reason: 'terminal', evidenceRefs: ['unknown-host-terminal'] }) }),
})
const send = frame => input.write(Buffer.from(JSON.stringify({ v: 1, ...frame }) + '\n'))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  send({ type: 'bootstrap', id: 'bootstrap', spec, payloadRoot: join(root, 'payloads'), journalPath: join(root, 'journal'), producer })
  for (let index = 0; index < 400 && !frames.some(frame => frame.type === 'ready'); index += 1) await wait(5)
  send({ type: 'command', id: 'cmd-unknown-begin', command: makeCommand('begin', { ...attempt, inputRef: 'input-1', preparedPolicyRef: spec.policySnapshotRef }) })
  for (let index = 0; index < 400 && !frames.some(frame => frame.type === 'exited'); index += 1) await wait(5)
  const directory = endpointDirectory(join(root, 'recovery'), spec.attemptId)
  const stat = lstatSync(join(directory, 'runner.sock'))
  const endpoint = { socketPath: join(directory, 'runner.sock'), credentialPath: join(directory, 'runner.credential'), socketIdentity: { dev: stat.dev, ino: stat.ino } }
  const client = connectRunnerRecovery(endpoint, context, 3000)
  const inspection = verifiedRunnerInspection(await client.inspect()).value
  const digest = runnerResourceManifestDigest(inspection.resources)
  log.begin('B40-UNKNOWN-RESOURCE-REFUSES-FINALIZE', 'a terminal endpoint with an indeterminate resource refuses finalize and stays readable', 'controlled_process')
  const refused = await client.finalize({ confirmationId: 'unknown-confirm-1', resourceManifestDigest: digest })
    .then(() => ({ ok: true })).catch(error => ({ ok: false, serverError: error?.serverError ?? null }))
  const stillReadable = await client.inspect().then(value => verifiedRunnerInspection(value).value).catch(() => null)
  log.evidence({ inspection: { state: inspection.state, resources: inspection.resources }, refused, stillReadable: stillReadable?.state ?? null })
  if (!refused.ok && (refused.serverError === 'physical_not_stopped' || refused.serverError === 'unknown_resources') && stillReadable !== null) log.pass(`finalize was refused (${refused.serverError}) while the unknown resource retained the endpoint and material`)
  else log.fail(`unknown-resource finalize was not retained: ${JSON.stringify({ refused, state: stillReadable?.state ?? null })}`)

  log.begin('B40-FOREIGN-CONFIRMATION-REFUSED', 'a foreign producer/confirmation cannot finalize even with a correct digest', 'controlled_process')
  const foreign = connectRunnerRecovery(endpoint, { ...context, runnerIdentityRef: 'foreign-ms1' }, 3000)
  const foreignRefusal = await foreign.finalize({ confirmationId: 'unknown-confirm-foreign', resourceManifestDigest: digest })
    .then(() => ({ ok: true })).catch(error => ({ ok: false, serverError: error?.serverError ?? null }))
  log.evidence({ foreignRefusal })
  if (!foreignRefusal.ok && foreignRefusal.serverError === 'identity_mismatch') log.pass('the foreign finalize was refused (identity_mismatch) with zero finalize effect')
  else log.fail(`foreign finalize was not refused: ${JSON.stringify(foreignRefusal)}`)

  log.begin('B40-SCOPE-NOT-NATIVE', 'controlled in-process service with an indeterminate resource; no installed agent/model/gateway/signal', 'controlled_process')
  log.notTested('no installed agent, model gateway or real signal was used; the indeterminate resource keeps occupancy and the endpoint remains until a legitimate complete barrier')
} finally {
  send({ type: 'shutdown', id: 'cleanup' })
  input.end()
  try { const handle = await serving; await handle.shutdown(); await handle.done } catch {}
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'recovery milestone 01 postcommit finalize unknown retention', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'in-process runner-service; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(48)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB40-finalize totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
