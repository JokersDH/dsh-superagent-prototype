#!/usr/bin/env node
/**
 * Wave-30 H1 producer: zero-spawn mock suite first, then limited own-probe live checks.
 * Usage: node tests/operational-soak/procguard/produce3.mjs --out <new-dir> [--no-live]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homeDir, redactValue } from '../../../tools/trial-kit/lib/redact.mjs'
import { mockSuite, spawnOwnProbe, signalFresh, waitGone, pureControls, describeHandle, observeProcess } from './guard3.mjs'

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const out = outIndex >= 0 ? args[outIndex + 1] : null
if (out === null) { console.error('usage: produce3.mjs --out <new-dir> [--no-live]'); process.exit(2) }
const live = !args.includes('--no-live')
mkdirSync(out, { mode: 0o700 })
const write = (name, value) => writeFileSync(join(out, name), `${JSON.stringify(redactValue(value, { home: homeDir() }), null, 2)}\n`, { mode: 0o600, flag: 'wx' })

const report = { tool: 'trial-kit/guard3', wave: 30, live, mock: null, liveChecks: [], signals: [], errors: [], status: 'RUNNING' }
const mock = mockSuite()
report.mock = mock
write('mock.json', mock)
if (!mock.ok) {
  report.status = 'REFUSED_MOCK'
  write('report.json', report)
  console.error('guard3 mock suite failed'); process.exit(2)
}
if (!live) {
  report.status = 'MOCK_ONLY_OK'
  write('report.json', report)
  console.log('guard3-mock: OK (spawns=0 signals=0)')
  process.exit(0)
}

let normal = null
let stubborn = null
try {
  const root = join(out, 'own')
  mkdirSync(root, { mode: 0o700 })
  normal = await spawnOwnProbe({ root: join(root, 'normal'), operation: 'h30-normal' })
  const normalDesc = describeHandle(normal.handle)
  const bornObservation = structuredClone(normal.observation)
  report.liveChecks.push({ id: 'born_normal', ok: normalDesc?.live === true, observation: bornObservation, registered: normalDesc !== null })
  report.liveChecks.push({ id: 'returned_observation_is_copy', ok: normal.observation !== describeHandle(normal.handle)?.observation && normalDesc.observation.pid === normal.observation.pid })

  // Retarget attempt: mutate the caller's copy, then prove the registered target is unchanged.
  const tampered = structuredClone(normal.observation)
  tampered.pid = 999999
  tampered.birth.pid = 999999
  tampered.root = `${tampered.root}-sibling`
  tampered.operation = 'foreign-op'
  tampered.argv = ['/bin/false']
  tampered.plan = { complete: false, resourceCount: 0, verified: 'forged' }
  tampered.resources = []
  const afterTamper = describeHandle(normal.handle).observation
  const dry = signalFresh({ handle: normal.handle, signal: 'SIGTERM', dryRun: true })
  report.liveChecks.push({ id: 'caller_mutation_does_not_retarget', ok: afterTamper.pid === normalDesc.observation.pid && afterTamper.root === normalDesc.observation.root && dry.dryRun === true && dry.wouldSignal?.pid === normalDesc.observation.pid })

  const controls = pureControls(normal.handle)
  report.liveChecks.push({ id: 'pure_controls', controls, ok: controls.every((control) => control.ok !== false && (control.expect === undefined || control.result?.refused === control.expect)) })

  const unknownWait = await waitGone(normal.handle, 120, () => ({ state: 'unknown', reason: 'ps_failed' }))
  report.liveChecks.push({ id: 'unknown_wait_not_gone', ok: unknownWait.gone === false && unknownWait.unknown === true })

  const preTerm = signalFresh({ handle: normal.handle, signal: 'SIGTERM', dryRun: true })
  report.liveChecks.push({ id: 'first_signal_plan_verified', ok: preTerm.dryRun === true && preTerm.wouldSignal?.pid === normalDesc.observation.pid })
  const term = signalFresh({ handle: normal.handle, signal: 'SIGTERM' })
  report.signals.push({ target: 'normal', step: 'TERM', result: term })
  const normalGone = await waitGone(normal.handle, 4000)
  report.liveChecks.push({ id: 'normal_term_gone', ok: term.sent === true && normalGone.gone === true })

  // Escalation probe: ignores TERM; KILL is re-verified fresh after the TERM.
  stubborn = await spawnOwnProbe({ root: join(root, 'stubborn'), operation: 'h30-stubborn', ignoreTerm: true })
  const stubbornPid = describeHandle(stubborn.handle).observation.pid
  const term2 = signalFresh({ handle: stubborn.handle, signal: 'SIGTERM' })
  report.signals.push({ target: 'stubborn', step: 'TERM', result: term2 })
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 120))
  const aliveAfterTerm = observeProcess(stubbornPid)
  report.liveChecks.push({ id: 'stubborn_survived_term', ok: term2.sent === true && aliveAfterTerm.state === 'alive' })
  const kill = signalFresh({ handle: stubborn.handle, signal: 'SIGKILL' })
  report.signals.push({ target: 'stubborn', step: 'KILL', result: kill })
  const stubbornGone = await waitGone(stubborn.handle, 4000)
  report.liveChecks.push({ id: 'stubborn_kill_gone', ok: kill.sent === true && stubbornGone.gone === true })
} catch (error) {
  report.errors.push(String(error?.message ?? error))
} finally {
  // Only registered own handles are eligible; never a PID-based fallback.
  for (const [name, probe] of [['normal', normal], ['stubborn', stubborn]]) {
    if (probe === null) continue
    try {
      const description = describeHandle(probe.handle)
      if (description?.live !== true) continue
      const forced = signalFresh({ handle: probe.handle, signal: 'SIGKILL' })
      report.signals.push({ target: name, step: 'cleanup-KILL', result: forced })
      if (forced.sent !== true) report.errors.push(`cleanup refused for ${name}: ${forced.refused}`)
    } catch (error) {
      report.errors.push(`cleanup ${name}: ${String(error?.message ?? error)}`)
    }
  }
}

const ok = report.errors.length === 0
  && report.liveChecks.every((check) => check.ok !== false && (check.expect === undefined || check.result?.refused === check.expect))
  && report.signals.filter((signal) => signal.result?.sent === true).length >= 3
report.status = ok ? 'LIVE_OK' : 'FAILED'
write('report.json', report)
console.log(JSON.stringify({ status: report.status, signals: report.signals.length, sent: report.signals.filter((signal) => signal.result?.sent).length, checks: report.liveChecks.length, errors: report.errors }, null, 2))
process.exit(ok ? 0 : 1)
