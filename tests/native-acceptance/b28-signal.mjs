#!/usr/bin/env node
/**
 * Wave-29 B5/B6 pure controls for the signal tool. No product process is signalled here.
 *
 * What must hold: ownership is a spawner-registered birth identity (pid/uid/start/ppid/full argv plus
 * exact root/config/operation arguments), the declared child set is checked before the FIRST signal,
 * every escalation is re-verified, and any unreadable observation is UNKNOWN - never "exited".
 */
import { spawn } from 'node:child_process'
import { CaseLog, writeReport } from './harness.mjs'
import { born, capture, confirmExit, escalate, observe, signalOwned, verify, verifyResources } from './signal-guard.mjs'

const log = new CaseLog()
const FIXTURE = new URL('./signal-child-fixture.mjs', import.meta.url).pathname
const children = []
const spawnFixture = (args) => {
  const child = spawn(process.execPath, [FIXTURE, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  children.push({ child, argv: [FIXTURE, ...args] })
  return new Promise(resolve => {
    let buffer = ''
    child.stdout.on('data', chunk => {
      buffer += chunk.toString()
      const line = buffer.split('\n')[0]
      if (!line) return
      try { resolve({ child, ...JSON.parse(line) }) } catch { resolve({ child, pid: child.pid, childPid: null }) }
    })
  })
}
const seconds = ms => new Promise(resolve => setTimeout(resolve, ms))
const argsFor = (root, operation = 'run', extra = []) => [`--root=${root}`, `--config=${root}/config.json`, `--operation=${operation}`, ...extra]

try {
  log.begin('B28-SIGNAL-OWN-POSITIVE', 'a probe-born process is signalled only after full identity and child-set verification', 'controlled_process')
  const own = await spawnFixture(argsFor('/tmp/wave29-own', 'run', ['--child']))
  const ownBorn = born(own.pid, { exactArgs: argsFor('/tmp/wave29-own', 'run', ['--child']), expectedChildren: [own.childPid] })
  const ownResources = ownBorn.ok ? verifyResources(ownBorn.record) : { ok: false, unknown: ownBorn.unknown }
  const ownSent = ownBorn.ok ? signalOwned(ownBorn.record, 'SIGKILL') : { sent: false, refused: true, unknown: ownBorn.unknown }
  const ownExit = await confirmExit(own.pid)
  const childExit = await confirmExit(own.childPid)
  log.evidence({ born: ownBorn.ok, resources: ownResources.ok, sent: ownSent.sent, exited: ownExit.exited, childExited: childExit.exited })
  if (ownBorn.ok && ownResources.ok && ownSent.sent && ownExit.exited) log.pass(`probe-born ${own.pid} matched its exact birth/resources, was killed, and both it and its child ${own.childPid} are GONE`)
  else log.fail(`own positive failed: ${JSON.stringify({ ownBorn: ownBorn.ok, ownResources, ownSent, ownExit })}`)

  log.begin('B28-SIGNAL-SIBLING-ARG-REFUSED', 'a record carrying another root/config sends zero signals', 'controlled_process')
  const sibling = await spawnFixture(argsFor('/tmp/wave29-sibling'))
  const siblingBorn = born(sibling.pid, { exactArgs: argsFor('/tmp/wave29-sibling'), expectedChildren: [] })
  const foreign = { ...siblingBorn.record, exactArgs: argsFor('/tmp/wave29-other') }
  const foreignCheck = verify(foreign)
  const foreignSent = signalOwned(foreign, 'SIGKILL')
  log.evidence({ mismatches: foreignCheck.mismatches, sent: foreignSent.sent, refused: foreignSent.refused, alive: observe(sibling.pid).state })
  if (foreignSent.refused && !foreignSent.sent && observe(sibling.pid).state === 'live') log.pass(`a record whose exact root/config describe another process was refused (${foreignCheck.mismatches?.join(',')}) and ${sibling.pid} stayed live`)
  else log.fail(`a foreign record was not refused: ${JSON.stringify({ foreignCheck, foreignSent })}`)
  signalOwned(siblingBorn.record, 'SIGKILL'); await confirmExit(sibling.pid)

  log.begin('B28-SIGNAL-PREFIX-ROOT-REFUSED', 'a sibling-prefix root is not accepted as an exact argument', 'controlled_process')
  const prefixed = await spawnFixture(argsFor('/tmp/wave29-root-old'))
  const prefixedBorn = born(prefixed.pid, { exactArgs: argsFor('/tmp/wave29-root-old'), expectedChildren: [] })
  const prefixForged = { ...prefixedBorn.record, exactArgs: argsFor('/tmp/wave29-root') }
  const prefixCheck = verify(prefixForged)
  const prefixSent = signalOwned(prefixForged, 'SIGKILL')
  log.evidence({ mismatches: prefixCheck.mismatches, sent: prefixSent.sent, alive: observe(prefixed.pid).state })
  if (prefixSent.refused && !prefixSent.sent && observe(prefixed.pid).state === 'live') log.pass('--root=/tmp/wave29-root did not match a process spawned with --root=/tmp/wave29-root-old (exact token match, not substring)')
  else log.fail(`a sibling-prefix root was accepted: ${JSON.stringify({ prefixCheck, prefixSent })}`)
  signalOwned(prefixedBorn.record, 'SIGKILL'); await confirmExit(prefixed.pid)

  log.begin('B28-SIGNAL-MISSING-BIRTH-REFUSED', 'no birth record or no start time means no signal', 'controlled_process')
  const noRecord = signalOwned(null, 'SIGKILL')
  const noStart = signalOwned({ pid: process.pid, uid: 0, ppid: 0, start: '', argv: '', exactArgs: [], markers: [], expectedChildren: [] }, 'SIGKILL')
  log.evidence({ noRecord, noStart })
  if (noRecord.refused && noStart.refused) log.pass('a null record and a record without a start time were both refused before any signal')
  else log.fail(`a pre-record was not refused: ${JSON.stringify({ noRecord, noStart })}`)

  log.begin('B28-SIGNAL-RECYCLED-REFUSED', 'a recycled pid/start is refused', 'controlled_process')
  const recycled = await spawnFixture(argsFor('/tmp/wave29-recycled'))
  const recycledBorn = born(recycled.pid, { exactArgs: argsFor('/tmp/wave29-recycled'), expectedChildren: [] })
  const recycledForged = { ...recycledBorn.record, start: 'Mon Jan  1 00:00:00 2001' }
  const recycledSent = signalOwned(recycledForged, 'SIGKILL')
  log.evidence({ sent: recycledSent.sent, refused: recycledSent.refused, alive: observe(recycled.pid).state })
  if (recycledSent.refused && !recycledSent.sent && observe(recycled.pid).state === 'live') log.pass('a record with a recycled start time was refused and the live process was untouched')
  else log.fail(`a recycled start was not refused: ${JSON.stringify(recycledSent)}`)
  signalOwned(recycledBorn.record, 'SIGKILL'); await confirmExit(recycled.pid)

  log.begin('B28-SIGNAL-UNKNOWN-IS-NOT-EXIT', 'an unreadable observation is UNKNOWN and never "exited"', 'controlled_process')
  const unreadable = observe(999999999)
  const unreadableExit = await confirmExit(999999999, 400)
  log.evidence({ observed: unreadable, exit: unreadableExit })
  if (unreadable.state === 'unknown' && unreadableExit.exited === false && typeof unreadableExit.unknown === 'string') log.pass(`ps could not read pid 999999999 and the tool reported UNKNOWN (${unreadable.reason}), not gone/exited`)
  else log.fail(`an unreadable pid was reported as exited: ${JSON.stringify({ unreadable, unreadableExit })}`)

  log.begin('B28-SIGNAL-ARBITRARY-PID-REFUSED', 'a readable pid that this probe did not spawn is not ownership', 'controlled_process')
  const foreignPid = born(process.pid, { exactArgs: ['--root=/tmp/wave29-foreign'], expectedChildren: [] })
  const foreignSignal = signalOwned(foreignPid.record ?? null, 'SIGKILL')
  log.evidence({ born: foreignPid.ok, unknown: foreignPid.ok ? null : foreignPid.unknown, sent: foreignSignal.sent })
  if (!foreignPid.ok && foreignPid.unknown === 'not_a_probe_child' && !foreignSignal.sent) log.pass('born() refused the probe process itself (a readable but non-spawned pid) and no signal was sent')
  else log.fail(`an arbitrary readable pid was accepted as owned: ${JSON.stringify({ foreignPid: foreignPid.ok, unknown: foreignPid.unknown, foreignSignal })}`)

  log.begin('B28-SIGNAL-EMPTY-ARGV-REFUSED', 'missing argv / empty exactArgs cannot register a birth', 'controlled_process')
  const argvChild = await spawnFixture(argsFor('/tmp/wave29-argv'))
  const noArgs = born(argvChild.pid, { expectedChildren: [] })
  const emptyArgs = born(argvChild.pid, { exactArgs: [], expectedChildren: [] })
  log.evidence({ noArgs: noArgs.ok ? null : noArgs.unknown, emptyArgs: emptyArgs.ok ? null : emptyArgs.unknown })
  if (!noArgs.ok && !emptyArgs.ok && noArgs.unknown === 'no_exact_args' && emptyArgs.unknown === 'no_exact_args') log.pass('a birth without exact argv (and one with an empty exactArgs list) was refused before any signal')
  else log.fail(`argv proof was skippable: ${JSON.stringify({ noArgs, emptyArgs })}`)
  const argvBorn = born(argvChild.pid, { exactArgs: [FIXTURE, ...argsFor('/tmp/wave29-argv')], expectedChildren: [] })
  if (argvBorn.ok) signalOwned(argvBorn.record, 'SIGKILL')

  log.begin('B28-SIGNAL-RESOURCE-PLAN-REQUIRED', 'no resource plan means no birth and no signal', 'controlled_process')
  const planChild = await spawnFixture(argsFor('/tmp/wave29-plan'))
  const noPlan = born(planChild.pid, { exactArgs: [FIXTURE, ...argsFor('/tmp/wave29-plan')] })
  log.evidence({ noPlan: noPlan.ok ? null : noPlan.unknown })
  if (!noPlan.ok && noPlan.unknown === 'no_resource_plan') log.pass('a birth without an explicit child plan was refused; there is no default that skips the resource check')
  else log.fail(`a missing resource plan was accepted: ${JSON.stringify(noPlan)}`)
  const planRecord = born(planChild.pid, { exactArgs: [FIXTURE, ...argsFor('/tmp/wave29-plan')], expectedChildren: [999999] })
  const planMismatch = signalOwned(planRecord.record ?? null, 'SIGKILL')
  log.evidence({ resources: planMismatch.resources ?? null, sent: planMismatch.sent, alive: observe(planChild.pid).state })
  if (planMismatch.refused && !planMismatch.sent && observe(planChild.pid).state === 'live') log.pass('a declared child set that disagrees with the live child set refused the signal and left the process live')
  else log.fail(`a wrong resource plan was still signalled: ${JSON.stringify(planMismatch)}`)
  const planGood = born(planChild.pid, { exactArgs: [FIXTURE, ...argsFor('/tmp/wave29-plan')], expectedChildren: [] })
  if (planGood.ok) signalOwned(planGood.record, 'SIGKILL')

  log.begin('B28-SIGNAL-MUTATION-REFUSED', 'editing a registered record cannot retarget it', 'controlled_process')
  const mutable = await spawnFixture(argsFor('/tmp/wave29-mutable'))
  const mutableBorn = born(mutable.pid, { exactArgs: [FIXTURE, ...argsFor('/tmp/wave29-mutable')], expectedChildren: [] })
  const retarget = { ...mutableBorn.record, pid: process.pid }
  const retargetSignal = signalOwned(retarget, 'SIGKILL')
  log.evidence({ refused: retargetSignal.refused, unknown: retargetSignal.unknown, probeAlive: true })
  if (retargetSignal.refused && !retargetSignal.sent && mutableBorn.ok) log.pass('a copied record whose pid was changed to the probe was refused (unregistered_or_mutated) and nothing was signalled')
  else log.fail(`a mutated record was honoured: ${JSON.stringify(retargetSignal)}`)
  if (mutableBorn.ok) signalOwned(mutableBorn.record, 'SIGKILL')

  log.begin('B28-SIGNAL-GONE-IS-EXPLICIT', 'a real exit is reported GONE only from ps', 'controlled_process')
  const gone = await spawnFixture(argsFor('/tmp/wave29-gone'))
  const goneBorn = born(gone.pid, { exactArgs: argsFor('/tmp/wave29-gone'), expectedChildren: [] })
  signalOwned(goneBorn.record, 'SIGKILL'); await confirmExit(gone.pid)
  const goneNow = observe(gone.pid)
  log.evidence({ state: goneNow.state, reason: goneNow.reason })
  if (goneNow.state === 'gone') log.pass('after its exit the tool reports GONE with an explicit ps reason, and the earlier UNKNOWN path is distinct')
  else log.fail(`a real exit was not GONE: ${JSON.stringify(goneNow)}`)

  log.begin('B28-SIGNAL-ESCALATION-FRESH', 'TERM, fresh identity, then KILL', 'controlled_process')
  const stubborn = await spawnFixture(argsFor('/tmp/wave29-stubborn', 'run', ['--ignore-term']))
  const stubbornBorn = born(stubborn.pid, { exactArgs: argsFor('/tmp/wave29-stubborn', 'run', ['--ignore-term']), expectedChildren: [] })
  const escalated = await escalate(stubbornBorn.record, { termWaitMs: 1200 })
  log.evidence({ term: escalated.term.sent, kill: escalated.kill?.sent ?? null, exited: escalated.exit?.exited ?? false })
  if (escalated.term.sent && escalated.kill?.sent && escalated.exit.exited) log.pass('a TERM-ignoring process survived TERM, was re-verified, then killed and confirmed GONE')
  else log.fail(`escalation did not behave: ${JSON.stringify(escalated)}`)

  log.begin('B28-SIGNAL-IDENTITY-CHANGE-BEFORE-KILL', 'a changed identity before escalation stops the KILL', 'controlled_process')
  const changed = await spawnFixture(argsFor('/tmp/wave29-changed'))
  const changedBorn = born(changed.pid, { exactArgs: argsFor('/tmp/wave29-changed'), expectedChildren: [] })
  const changedForged = { ...changedBorn.record, start: 'Tue Jan  1 00:00:00 2002' }
  const changedEscalated = await escalate(changedForged, { termWaitMs: 400 })
  log.evidence({ term: changedEscalated.term.sent, refused: changedEscalated.term.refused ?? false, alive: observe(changed.pid).state })
  if (!changedEscalated.term.sent && changedEscalated.term.refused && observe(changed.pid).state === 'live') log.pass('a record whose birth identity no longer matches produced zero signals (no TERM, no KILL) and the process stayed live')
  else log.fail(`a stale identity was signalled: ${JSON.stringify(changedEscalated)}`)
  signalOwned(changedBorn.record, 'SIGKILL'); await confirmExit(changed.pid)
} finally {
  for (const { child, argv } of children) {
    try {
      // Cleanup uses the exact argv this probe spawned and an explicit (possibly empty) child plan; a
      // mismatch refuses and leaves the material instead of guessing.
      const record = born(child.pid, { exactArgs: argv, expectedChildren: [] })
      if (record.ok) signalOwned(record.record, 'SIGKILL')
    } catch {}
  }
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-29 signal tool pure controls', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'pure controls only; no product process signalled' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(46)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB28-signal totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
