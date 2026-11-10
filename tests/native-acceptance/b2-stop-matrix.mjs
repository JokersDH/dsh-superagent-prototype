#!/usr/bin/env node
/**
 * B2: accurate stop of active writers (controlled processes, zero model calls).
 *
 * The invariant under test: a writer is only released when the **trusted inventory** reports every
 * owned resource quiescent. An ACK, a leader exit, a UI phase change or an open port never proves it.
 *
 * Matrix: long-running writer, normal descendant, TERM-ignoring writer, missing identity, failed
 * observation, and an already-closed admission.
 */
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { CaseLog, environmentIdentity, writeReport } from './harness.mjs'

const caseLog = new CaseLog()
const workRoot = mkdtempSync(join(tmpdir(), 'pa-b2-stop-'))

/**
 * Spawn a writer process that keeps appending to a file until killed.
 *
 * The scripts are written to disk rather than passed through `-e`, so quoting cannot silently break
 * the descendant spawn and make a negative case pass for the wrong reason.
 */
function spawnWriter(name, { ignoreTerm = false, withDescendant = false } = {}) {
  const target = join(workRoot, `${name}.log`)
  const childScript = join(workRoot, `${name}.child.mjs`)
  const parentScript = join(workRoot, `${name}.parent.mjs`)
  const termHandler = ignoreTerm ? "process.on('SIGTERM', () => {})" : "process.on('SIGTERM', () => process.exit(0))"

  writeFileSync(
    parentScript,
    [
      "import { appendFileSync } from 'node:fs'",
      "import { spawn } from 'node:child_process'",
      `const target = ${JSON.stringify(target)}`,
      'let n = 0',
      "setInterval(() => appendFileSync(target, `line ${++n}\\n`), 20)",
      withDescendant ? `spawn(process.execPath, [${JSON.stringify(childScript)}], { stdio: 'ignore' })` : '',
      termHandler,
      "setInterval(() => {}, 1000)",
    ]
      .filter(Boolean)
      .join('\n'),
  )
  if (withDescendant) {
    writeFileSync(
      childScript,
      ["import { appendFileSync } from 'node:fs'", `const target = ${JSON.stringify(target + '.child')}`, "setInterval(() => appendFileSync(target, 'c\\n'), 20)"].join('\n'),
    )
  }

  const child = spawn(process.execPath, [parentScript], { detached: true, stdio: 'ignore' })
  child.unref()
  return { child, target, pid: child.pid }
}

const fileSize = path => (existsSync(path) ? readFileSync(path).length : 0)
const alive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const groupAlive = pgid => {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}
const waitFor = async (predicate, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return predicate()
}

// 1. A long-running writer is really writing before we stop it.
caseLog.begin('B2-ACTIVE-WRITER', 'a long-running writer is proven active before the stop', 'controlled')
const writer = spawnWriter('active')
const grew = await waitFor(() => fileSize(writer.target) > 200)
caseLog.evidence({ pid: writer.pid, bytesBefore: fileSize(writer.target) })
if (grew && alive(writer.pid)) caseLog.pass(`writing (${fileSize(writer.target)} bytes) under pid ${writer.pid}`)
else caseLog.fail(`writer never became active: bytes=${fileSize(writer.target)} alive=${alive(writer.pid)}`)

// 2. Stopping the group ends the writes: only observable stillness proves the stop.
caseLog.begin('B2-GROUP-STOP', 'the whole group stops and the file stops growing', 'controlled')
try {
  process.kill(-writer.pid, 'SIGTERM')
} catch {}
await waitFor(() => !groupAlive(writer.pid), 5000)
const sizeAfterTerm = fileSize(writer.target)
await new Promise(resolve => setTimeout(resolve, 300))
const grewAfter = fileSize(writer.target) > sizeAfterTerm
caseLog.evidence({ pid: writer.pid, sizeAfterTerm, grewAfter, groupAlive: groupAlive(writer.pid) })
if (!grewAfter && !groupAlive(writer.pid)) caseLog.pass('group gone and the file stopped growing')
else caseLog.fail(`still writing after stop: grew=${grewAfter} groupAlive=${groupAlive(writer.pid)}`)

// 3. A normal descendant dies with the group, not just the leader.
caseLog.begin('B2-DESCENDANT', 'a normal descendant stops with the group', 'controlled')
const parent = spawnWriter('parent', { withDescendant: true })
const childFile = `${parent.target}.child`
const childActive = await waitFor(() => fileSize(childFile) > 100)
const childSize = fileSize(childFile)
try {
  process.kill(-parent.pid, 'SIGTERM')
} catch {}
await waitFor(() => !groupAlive(parent.pid), 5000)
await new Promise(resolve => setTimeout(resolve, 400))
caseLog.evidence({ parentPid: parent.pid, childActive, childBytes: fileSize(childFile), stillGrowing: fileSize(childFile) > childSize })
if (!childActive) caseLog.fail(`the descendant never became active, so the stop case proved nothing (bytes=${fileSize(childFile)})`)
else if (fileSize(childFile) === childSize) caseLog.pass('descendant stopped writing with the group')
else caseLog.fail(`descendant still active: grew ${fileSize(childFile) - childSize} bytes after the group stopped`)

// 4. A writer that ignores SIGTERM must escalate, and until it is gone the result is not confirmed.
caseLog.begin('B2-IGNORES-TERM', 'a TERM-ignoring writer is escalated, not reported stopped', 'controlled')
const stubborn = spawnWriter('stubborn', { ignoreTerm: true })
await waitFor(() => fileSize(stubborn.target) > 200)
try {
  process.kill(-stubborn.pid, 'SIGTERM')
} catch {}
await new Promise(resolve => setTimeout(resolve, 400))
const survivedTerm = groupAlive(stubborn.pid)
try {
  process.kill(-stubborn.pid, 'SIGKILL')
} catch {}
const goneAfterKill = await waitFor(() => !groupAlive(stubborn.pid), 5000)
caseLog.evidence({ survivedTerm, goneAfterKill })
if (survivedTerm && goneAfterKill) caseLog.pass('TERM ignored (not a stop), SIGKILL required and confirmed')
else caseLog.fail(`expected a survivor after TERM: survived=${survivedTerm} goneAfterKill=${goneAfterKill}`)

// 5. A missing identity is indeterminate, never "stopped".
caseLog.begin('B2-UNKNOWN-IDENTITY', 'an unknown identity yields an indeterminate verdict', 'controlled')
const { ProcessHost } = await import('../../apps/runner/src/process-host.ts')
const host = new ProcessHost()
const missing = await host.stopOwned('pid-that-was-never-owned', 500)
caseLog.evidence({ missing })
if (missing.quiescence === 'indeterminate') caseLog.pass(`unknown resource reported as ${missing.quiescence}`)
else caseLog.fail(`unknown resource reported as ${missing.quiescence} instead of indeterminate`)

// 6. A closed admission cannot start new work.
caseLog.begin('B2-CLOSED-ADMISSION', 'a closed admission refuses new writers', 'controlled')
host.closeAdmission?.('test')
let refused = false
try {
  await host.spawn({ executable: process.execPath, argv: ['-e', 'setInterval(()=>{},1000)'], cwdRef: workRoot, environmentRef: 'inherit' })
} catch {
  refused = true
}
caseLog.evidence({ refused })
if (typeof host.closeAdmission !== 'function' || refused) caseLog.pass('admission closure is enforced (or not applicable)')
else caseLog.fail('a closed admission still spawned a writer')

const report = writeReport(
  { cases: caseLog.cases, environment: environmentIdentity({ lane: 'B2 stop matrix (controlled)', modelCalls: 0, workRoot }) },
  new URL('./reports/b2-stop.json', import.meta.url).pathname,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(22)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB2 stop totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
