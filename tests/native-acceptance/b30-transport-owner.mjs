#!/usr/bin/env node
/**
 * Wave-30 B1: ONE transport owner per callback.
 *
 * A remote lease takes over from the stdio bootstrap connection. After the takeover the old stdio
 * writer must receive ZERO fact/payload/native-intent frames; the remote pull gets them and its replies
 * are what settle the module. "Both got the frame and the stale reply was refused" is NOT isolation.
 */
import { lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { RunnerLink } from '../../apps/runner/src/runner-link-client.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'
import { connectRunnerRecovery } from '../../packages/execution/src/recovery-transport.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w30-owner-'))
const recoveryRoot = join(root, 'recovery')
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))
const producer = { source: 'codex-native', runnerIdentityRef: 'b30-owner' }
let runner
try {
  process.env.PA_RUNNER_RECOVERY_ROOT = recoveryRoot
  const spec = makeAttemptSpec()
  const link = new RunnerLink({ executable: process.execPath, entry: ENTRY, args: ['codex-fake'], stateRoot: join(root, 'attempt'), producer })
  link.bindPayload(spec.policySnapshotRef, { kind: 'fixture-settings/1', workspacePath: process.cwd(), scope: { projectId: 'p', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, approvalPolicy: 'on-request', timeoutMs: 600000 })
  link.bindPayload('input-owner', { inputId: 'input-owner', contract: spec.contract, text: 'owner', contextRefs: [], sourceMessageRefs: [], provenance: 'authorized_work_input' })
  const stdioFacts = []
  runner = await link.spawnAttempt(spec, async fact => { stdioFacts.push(fact); return { factId: fact.factId, persisted: true, seq: stdioFacts.length } })
  const directory = endpointDirectory(recoveryRoot, spec.attemptId)
  let registered = null
  for (let index = 0; index < 400 && !registered; index += 1) {
    try { const stat = lstatSync(`${directory}/runner.sock`); registered = { socketPath: `${directory}/runner.sock`, credentialPath: `${directory}/runner.credential`, socketIdentity: { dev: stat.dev, ino: stat.ino } } }
    catch { await new Promise(resolve => setTimeout(resolve, 50)) }
  }
  const attempt = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
  const remote = connectRunnerRecovery(registered, { attempt, ...producer }, 3000)
  log.begin('B30-OWNER-REMOTE-BINDS-FIRST', 'the remote client owns the lease before any callback', 'controlled_process')
  const state = await remote.channelState()
  const bound = await remote.channelNext('lease-owner', state.generation)
  log.evidence({ generation: bound.generation })
  if (bound.generation > state.generation) log.pass(`remote lease bound generation ${state.generation} -> ${bound.generation} before begin`)
  else log.fail(`remote lease did not bind: ${JSON.stringify({ state, bound })}`)

  log.begin('B30-OWNER-CALLBACKS-ONLY-REMOTE', 'facts reach only the remote lease after takeover', 'controlled_process')
  const served = []
  const pump = (async () => {
    for (let index = 0; index < 400; index += 1) {
      let page
      try { page = await remote.channelNext('lease-owner') } catch { break }
      if (page.request) {
        served.push(page.request.type)
        if (page.request.type === 'fact') await remote.channelReply('lease-owner', { v: 1, type: 'receipt', id: page.request.id, factId: page.request.id, receipt: { factId: page.request.id, persisted: true, seq: served.length } })
        else if (page.request.type === 'payload-read') await remote.channelReply('lease-owner', { v: 1, type: 'payload', id: page.request.requestId, requestId: page.request.requestId, value: { served: true } })
        else if (page.request.type === 'native-write-intent') await remote.channelReply('lease-owner', { v: 1, type: 'write-admission', id: page.request.id, allowed: false })
      }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  })()
  await runner.command(makeCommand('begin', { inputRef: 'input-owner', preparedPolicyRef: spec.policySnapshotRef }))
  await runner.command(makeCommand('answer', { nativeBindingRef: 'binding-owner', answerRef: 'answer-owner' })).catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 800))
  pump.catch(() => undefined)
  log.evidence({ servedByRemote: [...new Set(served)], stdioFacts: stdioFacts.length, stdioFrames: runner.frames ?? null })
  if (served.length >= 1 && stdioFacts.length === 0) log.pass(`after the remote takeover the remote lease served ${served.length} callback(s) (${[...new Set(served)].join(',')}) and the old stdio sink saw 0`)
  else log.fail(`the old stdio transport still received callbacks: ${JSON.stringify({ served: [...new Set(served)], stdioFacts: stdioFacts.length })}`)

  log.begin('B30-SCOPE-NOT-NATIVE', 'fixture lane; installed Codex not executed', 'controlled_process')
  log.notTested('no installed agent executed and no gateway contacted')
} finally {
  try { await runner?.close() } catch {}
  delete process.env.PA_RUNNER_RECOVERY_ROOT
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-30 transport ownership', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'real spawned Runner; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(44)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB30-owner totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
