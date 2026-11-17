#!/usr/bin/env node
/**
 * Wave-36 B3: a NATURAL terminal must not block the original no-lease physical cancel/barrier.
 *
 * The Runner is served in-process with a driver that ends naturally. After waitExit, the coordinator's
 * original physical cancel (no callback lease) must still collect the terminated barrier, while a
 * business feed stays refused and a stale claimed lease stays refused. No signal is sent.
 */
import assert from 'node:assert/strict'
import { lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { CaseLog, writeReport } from './harness.mjs'
import { serveRunner } from '../../apps/runner/src/runner-service.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'
import { connectRunnerRecovery, verifiedRunnerInspection } from '../../packages/execution/src/recovery-transport.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w36-terminal-'))
const spec = makeAttemptSpec()
const producer = { source: 'fake-driver', runnerIdentityRef: 'b36-natural-runner' }
const attempt = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
const commandOf = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const input = new PassThrough()
const frames = []
const serving = serveRunner({
  input,
  write: frame => frames.push(frame),
  recoveryRoot: join(root, 'recovery'),
  payloads: { read: async () => { throw new Error('no payload reader in this fixture') } },
  createDriver: () => ({
    inspect: async () => { throw new Error('no native inspection') },
    reconcile: async () => { throw new Error('no native reconciliation') },
    serve: async () => ({ reason: 'terminal', evidenceRefs: ['natural-terminal-fixture'] }),
  }),
})
const send = frame => input.write(Buffer.from(JSON.stringify({ v: 1, ...frame }) + '\n'))
try {
  send({ type: 'bootstrap', id: 'bootstrap', spec, payloadRoot: join(root, 'payloads'), journalPath: join(root, 'journal'), producer })
  for (let index = 0; index < 400 && !frames.some(frame => frame.type === 'ready'); index += 1) await wait(5)
  // The driver is launched by the original begin command, then it ends naturally.
  send({ type: 'command', id: 'cmd-begin', command: makeCommand('begin', { ...commandOf, inputRef: 'input-1', preparedPolicyRef: spec.policySnapshotRef }) })
  for (let index = 0; index < 400 && !frames.some(frame => frame.type === 'exited'); index += 1) await wait(5)
  const directory = endpointDirectory(join(root, 'recovery'), spec.attemptId)
  const stat = lstatSync(join(directory, 'runner.sock'))
  const endpoint = { socketPath: join(directory, 'runner.sock'), credentialPath: join(directory, 'runner.credential'), socketIdentity: { dev: stat.dev, ino: stat.ino } }
  const client = connectRunnerRecovery(endpoint, { attempt, ...producer }, 3000)

  log.begin('B36-NATURAL-TERMINAL-NO-LEASE-CANCEL-COLLECTS-BARRIER', 'after waitExit the original no-lease cancel still returns the terminated barrier', 'controlled_process')
  assert.ok(frames.some(frame => frame.type === 'exited'))
  const proof = await client.cancel(makeCommand('cancel', commandOf))
  const inspected = verifiedRunnerInspection(proof).value
  log.evidence({ exited: frames.filter(frame => frame.type === 'exited').length, state: inspected.state, admission: inspected.admission, evidence: inspected.evidence })
  if (inspected.state === 'terminated' && inspected.admission === 'closed') log.pass(`the natural-terminal cancel succeeded and reported state=${inspected.state} admission=${inspected.admission} with owned-resource evidence`)
  else log.fail(`the natural-terminal cancel did not return the barrier: ${JSON.stringify({ state: inspected.state, admission: inspected.admission })}`)

  log.begin('B36-NATURAL-TERMINAL-FEED-AND-STALE-LEASE-REFUSED', 'terminal feed and a stale claimed lease stay refused', 'controlled_process')
  const feed = await client.command(makeCommand('deliver', { id: 'cmd-terminal-feed', inputRef: 'input-terminal' })).then(() => ({ ok: true })).catch(error => ({ ok: false, serverError: error?.serverError ?? null }))
  const stale = await client.cancel(makeCommand('cancel', { ...commandOf, id: 'cmd-stale-lease-cancel' }), 'lease-never-bound').then(() => ({ ok: true })).catch(error => ({ ok: false, serverError: error?.serverError ?? null }))
  log.evidence({ feed, stale })
  if (!feed.ok && feed.serverError === 'stale_connection' && !stale.ok && stale.serverError === 'stale_connection') log.pass('the terminal feed and the stale claimed-lease cancel were both refused (stale_connection)')
  else log.fail(`terminal controls were not fail-closed: ${JSON.stringify({ feed, stale })}`)

  log.begin('B36-SCOPE-NOT-NATIVE', 'controlled in-process service; no installed agent/gateway', 'controlled_process')
  log.notTested('no installed agent or model gateway was contacted; no signal was sent in this harness')
} finally {
  send({ type: 'shutdown', id: 'cleanup' })
  input.end()
  try { const handle = await serving; await handle.shutdown(); await handle.done } catch {}
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-36 natural terminal barrier', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'in-process runner-service; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(52)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB36-natural totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
