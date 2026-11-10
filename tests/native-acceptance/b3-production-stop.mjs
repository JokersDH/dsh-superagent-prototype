#!/usr/bin/env node
/**
 * B3: stop through the PRODUCTION Runner surface, never a manual process.kill of the unit under test.
 *
 * Everything goes through `ProcessHost`: spawn registers ownership, `inventory()` reports the trusted
 * list, `stopOwned()` performs the stop and returns the quiescence verdict, `closeAdmission()` closes
 * the door. The test only cleans up leftovers in `finally`.
 *
 * Demonstrated separately: core stopped, a cancel ACK, and an actual process exit are three different
 * observations — only `inventory()` plus observed stillness releases a writer.
 */
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaseLog, environmentIdentity, writeReport } from './harness.mjs'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-b3prod-'))
const { ProcessHost } = await import('../../apps/runner/src/process-host.ts')

const size = path => (existsSync(path) ? readFileSync(path).length : 0)
const waitFor = async (predicate, timeoutMs = 6000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return predicate()
}

/** A writer whose script is written to disk so quoting cannot silently break it. */
function writerScript(name, { ignoreTerm = false } = {}) {
  const target = join(root, `${name}.log`)
  const script = join(root, `${name}.mjs`)
  writeFileSync(
    script,
    [
      "import { appendFileSync } from 'node:fs'",
      `const target = ${JSON.stringify(target)}`,
      'let n = 0',
      "setInterval(() => appendFileSync(target, `line ${++n}\\n`), 20)",
      ignoreTerm ? "process.on('SIGTERM', () => {})" : "process.on('SIGTERM', () => process.exit(0))",
    ].join('\n'),
  )
  return { script, target }
}

const host = new ProcessHost()

// 1. The trusted inventory is the only source of ownership.
log.begin('B3-INVENTORY', 'spawned resources appear in the trusted inventory', 'controlled')
const active = writerScript('active')
const resource = await host.spawn({
  executable: process.execPath,
  argv: [active.script],
  cwdRef: root,
  environmentRef: 'inherit',
})
const inventory = host.inventory()
log.evidence({ ref: resource.resourceRef, inventory: inventory.map(item => ({ ref: item.ref, writer: item.writer })) })
const owned = inventory.find(item => item.ref === resource.resourceRef)
if (owned && owned.writer === 'active') log.pass(`inventory reports ${owned.ref} as active (${inventory.length} owned)`)
else log.fail(`the spawned resource is not owned in the inventory: ${JSON.stringify(owned)}`)

// 2. The writer is genuinely writing before any stop is attempted.
log.begin('B3-ACTIVE', 'the writer is proven to be writing before the stop', 'controlled')
const writing = await waitFor(() => size(active.target) > 200)
log.evidence({ bytes: size(active.target) })
if (writing) log.pass(`writing (${size(active.target)} bytes)`)
else log.fail(`the writer never produced evidence of activity`)

// 3. Production stop returns the quiescence verdict and the file stops growing.
log.begin('B3-PRODUCTION-STOP', 'stopOwned stops the group and reports its verdict', 'controlled')
const verdict = await host.stopOwned(resource.resourceRef, 4000)
const sizeAfter = size(active.target)
await new Promise(resolve => setTimeout(resolve, 300))
const grewAfter = size(active.target) > sizeAfter
const afterInventory = host.inventory()
log.evidence({ verdict, grewAfter, inventoryAfter: afterInventory.map(item => ({ ref: item.ref, writer: item.writer })) })
if (verdict.quiescence === 'confirmed' && !grewAfter) {
  log.pass(`quiescence=${verdict.quiescence}; the writer stopped growing`)
} else {
  log.fail(`stop did not confirm stillness: quiescence=${verdict.quiescence} grewAfter=${grewAfter}`)
}

// 4. A TERM-ignoring writer must not be reported as confirmed without escalation.
log.begin('B3-ESCALATION', 'a TERM-ignoring writer is escalated before confirmation', 'controlled')
const stubborn = writerScript('stubborn', { ignoreTerm: true })
const stubbornResource = await host.spawn({ executable: process.execPath, argv: [stubborn.script], cwdRef: root, environmentRef: 'inherit' })
await waitFor(() => size(stubborn.target) > 200)
const stubbornVerdict = await host.stopOwned(stubbornResource.resourceRef, 8000)
const stubbornAfter = size(stubborn.target)
await new Promise(resolve => setTimeout(resolve, 300))
log.evidence({ verdict: stubbornVerdict, grewAfter: size(stubborn.target) > stubbornAfter })
if (stubbornVerdict.quiescence === 'confirmed' && size(stubborn.target) === stubbornAfter) {
  log.pass(`escalated and confirmed (${stubbornVerdict.evidenceRefs.join(',')})`)
} else {
  log.fail(`a TERM-ignoring writer was not confirmed stopped: ${stubbornVerdict.quiescence}`)
}

// 5. An unknown owner is indeterminate, never confirmed.
log.begin('B3-UNKNOWN-OWNER', 'an unknown owner cannot be reported as stopped', 'controlled')
const unknown = await host.stopOwned('pid-never-owned', 500)
log.evidence({ unknown })
if (unknown.quiescence === 'indeterminate') log.pass('unknown owner reported indeterminate')
else log.fail(`unknown owner reported ${unknown.quiescence}`)

// 6. A closed admission refuses new writers while the existing inventory stays addressable.
log.begin('B3-CLOSED-ADMISSION', 'a closed admission refuses new writers', 'controlled')
host.closeAdmission()
let refused = false
try {
  await host.spawn({ executable: process.execPath, argv: ['-e', 'setInterval(()=>{},1000)'], cwdRef: root, environmentRef: 'inherit' })
} catch {
  refused = true
}
log.evidence({ refused, inventoryStillReadable: Array.isArray(host.inventory()) })
if (refused && Array.isArray(host.inventory())) log.pass('new writers refused; the inventory is still readable for recovery')
else log.fail(`closed admission still spawned a writer (refused=${refused})`)

const report = writeReport(
  { cases: log.cases, environment: environmentIdentity({ lane: 'B3 production stop (controlled)', modelCalls: 0 }) },
  new URL('./reports/b3-production-stop.json', import.meta.url).pathname,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(22)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB3 production stop totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
