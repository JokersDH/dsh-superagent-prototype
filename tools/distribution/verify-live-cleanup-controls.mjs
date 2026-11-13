#!/usr/bin/env node
/** Pure controls for probe-born ownership/cleanup; no user service or unrelated PID is signalled. */
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupBornResources, verifyBornRecord } from './lib/live-cleanup.mjs'

const root = mkdtempSync(join(tmpdir(), 'pa-cleanup-controls-')); chmodSync(root, 0o700)
const result = { protocol: 'wave23-cleanup-controls/1', status: 'FAIL', steps: [] }
const step = (id, status, detail) => result.steps.push({ id, status, detail })
const psOf = (pid) => { const r = spawnSync('ps', ['-p', String(pid), '-o', 'lstart=,uid=,command='], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null }
try {
  const install = join(root, 'install'); const config = join(root, 'config'); const data = join(root, 'state')
  chmodSync(root, 0o700)
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', 'start', install, config, data], { stdio: 'ignore' })
  const startText = await (async () => { for (let i = 0; i < 50; i++) { const line = psOf(child.pid); if (line) return line.match(/^(\w{3}\s+\w{3}\s+\d+\s+\d+:\d+:\d+\s+\d{4})/)?.[1]; await new Promise((r) => setTimeout(r, 50)) } return null })()
  const record = { pid: child.pid, apiPid: null, consolePid: null, processStart: startText, recordedStartMs: Date.parse(startText), state: data, configRoot: config }
  const owned = verifyBornRecord(record, { cli: join(install, 'bin/pa'), install, dataRoot: data })
  step('positive-complete-own', owned.owned === true ? 'PASS' : 'FAIL', { proof: owned })
  const wrongRoot = verifyBornRecord({ ...record, state: join(root, 'other-state') }, { cli: join(install, 'bin/pa'), install, dataRoot: data })
  step('foreign-root-refused', wrongRoot.owned === false ? 'PASS' : 'FAIL', { proof: wrongRoot })
  const wrongStart = verifyBornRecord({ ...record, recordedStartMs: 0 }, { cli: join(install, 'bin/pa'), install, dataRoot: data })
  step('start-mismatch-refused', wrongStart.owned === false ? 'PASS' : 'FAIL', { proof: wrongStart })
  const missing = verifyBornRecord(null, { cli: join(install, 'bin/pa'), install, dataRoot: data })
  step('missing-record-refused', missing.owned === false ? 'PASS' : 'FAIL', { proof: missing })
  const fakeCli = join(root, 'no-stop.mjs')
  const fs = await import('node:fs'); fs.writeFileSync(fakeCli, 'process.exit(1)\n', { mode: 0o700 })
  const first = await cleanupBornResources({ cli: process.execPath, install, roots: { config, data }, records: [record], args: [fakeCli], env: process.env, allowDirectSignal: false })
  const second = await cleanupBornResources({ cli: process.execPath, install, roots: { config, data }, records: [record], args: [fakeCli], env: process.env, allowDirectSignal: false })
  step('cleanup-failure-retains-material', first.status === 'UNKNOWN' && first.retained === true ? 'PASS' : 'FAIL', { first })
  step('repeated-finally-still-unknown', second.status === 'UNKNOWN' && second.retained === true ? 'PASS' : 'FAIL', { second })
  if (!owned.owned) throw new Error('positive ownership failed; refusing to signal the probe')
  child.kill('SIGTERM')
  await new Promise((r) => child.once('exit', r))
  result.status = result.steps.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL'
} catch (error) { result.error = String(error?.stack ?? error) }
finally { try { if (typeof child !== 'undefined' && child.exitCode === null) child.kill('SIGKILL') } catch {} rmSync(root, { recursive: true, force: true }) }
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
process.exitCode = result.status === 'PASS' ? 0 : 1
