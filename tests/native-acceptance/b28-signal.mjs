#!/usr/bin/env node
/** Wave-28 B5 pure controls for the signal tool: no live product process is signalled here. */
import { spawn } from 'node:child_process'
import { CaseLog, writeReport } from './harness.mjs'
import { capture, confirmExit, escalate, observe, signalOwned, verify } from './signal-guard.mjs'

const log = new CaseLog()
const children = []
const startChild = source => {
  const child = spawn(process.execPath, ['-e', source], { stdio: 'ignore' })
  children.push(child)
  return child
}
const waitBorn = async pid => {
  for (let index = 0; index < 100; index += 1) { if (observe(pid).alive) return true; await new Promise(resolve => setTimeout(resolve, 20)) }
  return false
}
try {
  log.begin('B28-SIGNAL-OWN-POSITIVE', 'an own child is signalled only after a fresh identity check', 'controlled_process')
  const own = startChild('setInterval(() => {}, 1000)')
  await waitBorn(own.pid)
  const ownCapture = capture(own.pid, { markers: ['setInterval'] })
  const ownSent = signalOwned(ownCapture.record, 'SIGKILL')
  const ownExit = await confirmExit(own.pid)
  log.evidence({ pid: own.pid, sent: ownSent.sent, exited: ownExit.exited })
  if (ownCapture.ok && ownSent.sent && ownExit.exited) log.pass(`own child ${own.pid} was verified then killed and its exit was confirmed`)
  else log.fail(`own positive failed: ${JSON.stringify({ ownCapture, ownSent, ownExit })}`)

  log.begin('B28-SIGNAL-FOREIGN-REFUSED', 'a foreign/sibling record sends no signal', 'controlled_process')
  const sibling = startChild('setInterval(() => {}, 1000)')
  await waitBorn(sibling.pid)
  const siblingCapture = capture(sibling.pid, { markers: ['setInterval'] })
  // The declared root/config/operation markers do not describe this process, so ownership is unproven.
  const foreignRecord = { ...siblingCapture.record, markers: ['--root=/some/other/root', '--config=other'] }
  const foreignCheck = verify(foreignRecord)
  const foreignSent = signalOwned(foreignRecord, 'SIGKILL')
  const siblingAlive = observe(sibling.pid).alive
  log.evidence({ mismatches: foreignCheck.mismatches, sent: foreignSent.sent, refused: foreignSent.refused, siblingAlive })
  if (foreignSent.refused && !foreignSent.sent && siblingAlive) log.pass(`a record whose declared root/config markers do not describe sibling ${sibling.pid} sent zero signals and it stayed alive`)
  else log.fail(`a foreign record was not refused: ${JSON.stringify({ foreignSent, siblingAlive })}`)
  const siblingCleanup = signalOwned(siblingCapture.record, 'SIGKILL')
  const siblingExit = await confirmExit(sibling.pid)
  log.evidence({ cleanupSent: siblingCleanup.sent, cleanupExited: siblingExit.exited })

  log.begin('B28-SIGNAL-RECYCLED-REFUSED', 'a recycled start time is refused', 'controlled_process')
  const recycled = startChild('setInterval(() => {}, 1000)')
  await waitBorn(recycled.pid)
  const recycledCapture = capture(recycled.pid, { markers: ['setInterval'] })
  const recycledRecord = { ...recycledCapture.record, start: 'Mon Jan  1 00:00:00 2001' }
  const recycledCheck = verify(recycledRecord)
  const recycledSent = signalOwned(recycledRecord, 'SIGKILL')
  log.evidence({ mismatches: recycledCheck.mismatches, sent: recycledSent.sent, refused: recycledSent.refused, alive: observe(recycled.pid).alive })
  if (recycledSent.refused && recycledCheck.mismatches?.includes('start') && observe(recycled.pid).alive) log.pass('a record with a recycled start time was refused and the live process was untouched')
  else log.fail(`a recycled start was not refused: ${JSON.stringify({ recycledCheck, recycledSent })}`)
  signalOwned(recycledCapture.record, 'SIGKILL'); await confirmExit(recycled.pid)

  log.begin('B28-SIGNAL-PRE-RECORD-REFUSED', 'a missing or pre-birth record is refused', 'controlled_process')
  const noRecord = signalOwned(null, 'SIGKILL')
  const noStart = signalOwned({ pid: process.pid, uid: 0, start: '', argv: '', markers: [] }, 'SIGKILL')
  log.evidence({ noRecord, noStart })
  if (noRecord.refused && noStart.refused) log.pass('a null record and a record without a start time were both refused before any signal')
  else log.fail(`a pre-record was not refused: ${JSON.stringify({ noRecord, noStart })}`)

  log.begin('B28-SIGNAL-GONE-UNKNOWN-RETAINED', 'a process that already exited is unknown, not a success', 'controlled_process')
  const gone = startChild('process.exit(0)')
  await new Promise(resolve => setTimeout(resolve, 300))
  const goneCapture = capture(gone.pid, { markers: ['process.exit'] })
  const goneCheck = goneCapture.ok ? verify(goneCapture.record) : { unknown: goneCapture.unknown }
  const goneSent = goneCapture.ok ? signalOwned(goneCapture.record, 'SIGKILL') : { refused: true, unknown: goneCapture.unknown }
  log.evidence({ capture: goneCapture.ok, check: goneCheck.unknown ?? 'exists', sent: goneSent })
  if (!goneSent.sent) log.pass(`an already-exited pid was not signalled and stayed unknown (${goneCheck.unknown ?? goneSent.unknown})`)
  else log.fail('a dead pid was signalled as if it were ours')

  log.begin('B28-SIGNAL-ESCALATION-FRESH', 'TERM then a fresh check then KILL', 'controlled_process')
  const stubborn = startChild("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)")
  await waitBorn(stubborn.pid)
  await new Promise(resolve => setTimeout(resolve, 120))
  const stubbornCapture = capture(stubborn.pid, { markers: ['SIGTERM'] })
  const escalated = await escalate(stubbornCapture.record, { termWaitMs: 1200 })
  log.evidence({ term: escalated.term.sent, kill: escalated.kill?.sent ?? null, exited: escalated.exit?.exited ?? false })
  if (escalated.term.sent && escalated.kill?.sent && escalated.exit.exited) log.pass('a TERM-ignoring child survived TERM, was re-verified, then killed, and its exit was confirmed')
  else log.fail(`escalation did not behave: ${JSON.stringify(escalated)}`)

  log.begin('B28-SIGNAL-NO-GLOBAL-DISCOVERY', 'ownership is only the caller-supplied record', 'controlled_process')
  const ownAgain = startChild('setInterval(() => {}, 1000)')
  await waitBorn(ownAgain.pid)
  const otherCapture = capture(ownAgain.pid, { markers: ['setInterval'] })
  const misPid = { ...otherCapture.record, pid: ownAgain.pid + 100000 }
  const misSent = signalOwned(misPid, 'SIGKILL')
  log.evidence({ misSent, alive: observe(ownAgain.pid).alive })
  if (misSent.refused && observe(ownAgain.pid).alive) log.pass('a record naming a different pid was refused: the tool never searches or guesses beyond the supplied record')
  else log.fail(`the tool signalled beyond its record: ${JSON.stringify(misSent)}`)
  signalOwned(otherCapture.record, 'SIGKILL'); await confirmExit(ownAgain.pid)
} finally {
  for (const child of children) { try { process.kill(child.pid, 'SIGKILL') } catch {} }
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-28 signal tool pure controls', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'pure controls only; no product process signalled' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(44)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB28-signal totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
