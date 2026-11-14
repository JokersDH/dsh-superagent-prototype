#!/usr/bin/env node
/** Pure controls for birth-time probe ownership and cleanup; only this script's own probes are signalled. */
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupBornResources, processSnapshot, registerSpawn, verifyBornRecord } from './lib/live-cleanup.mjs'

const root = mkdtempSync(join(tmpdir(), 'pa-cleanup-controls-')); chmodSync(root, 0o700)
const result = { protocol: 'wave24-cleanup-controls/1', status: 'FAIL', steps: [] }
const step = (id, status, detail) => result.steps.push({ id, status, detail })
let parent = null, childPid = null
try {
  const install = join(root, 'install'); const config = join(root, 'config'); const data = join(root, 'state')
  const childCode = "setTimeout(() => {}, 60000)"
  const parentCode = `const {spawn}=require('child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(childCode)},'demo.ts','--state',${JSON.stringify(data)},'--console-origin','http://127.0.0.1:1','--startup-mode','normal',${JSON.stringify(install)},${JSON.stringify(config)}],{stdio:'ignore'});console.log(c.pid);setTimeout(()=>{},60000)`
  parent = spawn(process.execPath, ['-e', parentCode, 'start', install, config, data], { stdio: ['ignore', 'pipe', 'ignore'] })
  childPid = await new Promise((resolve) => { let text = ''; parent.stdout.on('data', (chunk) => { text += chunk; const line = text.split('\n')[0]; if (/^\d+$/.test(line)) resolve(Number(line)) }) ; setTimeout(() => resolve(null), 3000) })
  if (!childPid) throw new Error('probe child did not start')
  const childStart = await (async () => { for (let i = 0; i < 50; i++) { const snap = processSnapshot(childPid); if (snap) return snap; await new Promise((r) => setTimeout(r, 50)) } return null })()
  const base = registerSpawn({ pid: parent.pid, install, config, data, operation: 'start' })
  const record = { ...base, uid: processSnapshot(parent.pid)?.uid ?? null, processStart: base.processStart ?? processSnapshot(parent.pid)?.startText ?? null,
    recordedStartMs: base.recordedStartMs ?? processSnapshot(parent.pid)?.startMs ?? null,
    children: [{ role: 'api', pid: childPid, processStart: childStart?.startText, recordedStartMs: childStart?.startMs, uid: childStart?.uid, config: config, entry: 'demo.ts', operation: 'normal', capturedTokens: childStart?.tokens }] }
  const owned = verifyBornRecord(record, { install, dataRoot: data, operation: 'start' })
  step('positive-complete-own', owned.owned ? 'PASS' : 'FAIL', { proof: owned })
  const badChildStart = verifyBornRecord({ ...record, children: [{ ...record.children[0], recordedStartMs: (record.children[0].recordedStartMs ?? 0) + 5000 }] }, { install, dataRoot: data })
  step('child-start-mismatch-refused', !badChildStart.owned ? 'PASS' : 'FAIL', { proof: badChildStart })
  const sibling = verifyBornRecord({ ...record, data: join(root, 'state-sibling') }, { install, dataRoot: data })
  step('sibling-root-refused', !sibling.owned ? 'PASS' : 'FAIL', { proof: sibling })
  const wrongOperation = verifyBornRecord(record, { install, dataRoot: data, operation: 'review' })
  step('wrong-operation-refused', !wrongOperation.owned ? 'PASS' : 'FAIL', { proof: wrongOperation })
  const reusedPid = verifyBornRecord({ ...record, recordedStartMs: (record.recordedStartMs ?? 0) + 5000 }, { install, dataRoot: data })
  step('pid-reuse-start-refused', !reusedPid.owned ? 'PASS' : 'FAIL', { proof: reusedPid })
  const childConfigWrong = verifyBornRecord({ ...record, children: [{ ...record.children[0], config: join(root, 'sibling-config') }] }, { install, dataRoot: data })
  step('child-config-refused', !childConfigWrong.owned ? 'PASS' : 'FAIL', { proof: childConfigWrong })
  const childEntryWrong = verifyBornRecord({ ...record, children: [{ ...record.children[0], entry: 'other.ts' }] }, { install, dataRoot: data })
  step('child-entry-refused', !childEntryWrong.owned ? 'PASS' : 'FAIL', { proof: childEntryWrong })
  const missing = verifyBornRecord(null, { install, dataRoot: data })
  step('missing-record-refused', !missing.owned ? 'PASS' : 'FAIL', { proof: missing })
  const fakeCli = join(root, 'no-stop.mjs')
  const fs = await import('node:fs'); fs.writeFileSync(fakeCli, 'process.exit(1)\n', { mode: 0o700 })
  const first = await cleanupBornResources({ cli: process.execPath, install, roots: { config, data }, records: [record], args: [fakeCli], env: process.env, allowDirectSignal: false })
  const second = await cleanupBornResources({ cli: process.execPath, install, roots: { config, data }, records: [record], args: [fakeCli], env: process.env, allowDirectSignal: false })
  step('cleanup-failure-retains-material', first.status === 'UNKNOWN' && first.retained ? 'PASS' : 'FAIL', { first })
  step('repeated-finally-still-unknown', second.status === 'UNKNOWN' && second.retained ? 'PASS' : 'FAIL', { second })
  const slowCli = join(root, 'slow-stop.mjs'); fs.writeFileSync(slowCli, 'setTimeout(() => process.exit(1), 500)\n', { mode: 0o700 })
  const simple = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', 'start', install, config, data], { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 200))
  const simpleBase = registerSpawn({ pid: simple.pid, install, config, data, operation: 'start' })
  const simpleSnap = processSnapshot(simple.pid)
  const simpleRecord = { ...simpleBase, processStart: simpleSnap.startText, recordedStartMs: simpleSnap.startMs, uid: simpleSnap.uid, children: [], instanceMissing: false }
  const timeoutClean = await cleanupBornResources({ cli: process.execPath, install, roots: { config, data }, records: [simpleRecord], args: [slowCli], env: process.env, allowDirectSignal: true })
  step('stop-timeout-clean-through-fresh-proof', timeoutClean.status === 'CLEAN' && timeoutClean.stopped[0]?.method === 'proven-direct-signal' ? 'PASS' : 'FAIL', { timeoutClean })
  const empty = await cleanupBornResources({ cli: process.execPath, install, roots: { config, data }, records: [], args: [fakeCli], env: process.env })
  const mixed = await cleanupBornResources({ cli: process.execPath, install, roots: { config, data }, records: [record, null], args: [fakeCli], env: process.env, allowDirectSignal: false })
  step('mixed-valid-null-keeps-unknown', mixed.status === 'UNKNOWN' && mixed.retained && mixed.unknown.some((u) => u.reason === 'record_missing_in_mixed_set') ? 'PASS' : 'FAIL', { mixed })
  step('empty-record-is-unknown', empty.status === 'UNKNOWN' && empty.retained && empty.unknown.length > 0 ? 'PASS' : 'FAIL', { empty })
  if (!owned.owned) throw new Error('positive ownership failed; refusing to signal the probes')
  for (const pid of [childPid, parent.pid]) { const snap = processSnapshot(pid); if (snap) { try { process.kill(pid, 'SIGTERM') } catch {} } }
  result.status = result.steps.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL'
} catch (error) { result.error = String(error?.stack ?? error) }
finally { for (const pid of [childPid, parent?.pid]) { if (!pid) continue; const snap = processSnapshot(pid); if (snap) { try { process.kill(pid, 'SIGKILL') } catch {} } } rmSync(root, { recursive: true, force: true }) }
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = result.status === 'PASS' ? 0 : 1
