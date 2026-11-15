/**
 * Wave-29 guard2 controls: registered birth only, exact args, UNKNOWN not gone, fresh TERM/KILL.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { classifyFixtures, compareRecord2, pureControls, signalFresh, spawnOwnProbe, waitGone } from './guard2.mjs'

const PRODUCE = join(import.meta.dirname, 'produce2.mjs')

function run(args) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [PRODUCE, ...args], { env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolvePromise({ status: code, stdout, stderr }))
  })
}

test('registered birth, exact arguments, UNKNOWN not gone, fresh TERM/KILL', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-guard2-'))
  try {
    const produced = await run(['--out', join(root, 'run')])
    assert.equal(produced.status, 0, produced.stderr)
    const report = JSON.parse(readFileSync(join(root, 'run', 'report.json'), 'utf8'))
    assert.equal(report.ok, true)
    assert.equal(report.checks.exactArgs, true)
    assert.equal(report.checks.birthRootConfigOperation, true)
    assert.equal(report.checks.pureControls, true)
    assert.equal(report.checks.unknownNotGone, true)
    assert.equal(report.checks.unknownSignalRefused, true)
    assert.equal(report.checks.noForeignSignals, true)
    assert.equal(report.counts.foreignSignals, 0)
    assert.equal(report.checks.killFreshSent, true)
    assert.equal(report.psClassification.gone.state, 'gone')
    assert.equal(report.psClassification.unknownPermission.state, 'unknown')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('plain record and prefix identity are refused; UNKNOWN observation sends nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-guard2-pure-'))
  try {
    const probe = await spawnOwnProbe({ root, operation: 'wave29-test-op' })
    const plain = signalFresh({ handle: { ...probe.record }, signal: 'SIGTERM' })
    assert.equal(plain.sent, false)
    assert.equal(plain.refused, 'not_registered')
    const unknown = signalFresh({ handle: probe.handle, signal: 'SIGTERM', observer: () => ({ state: 'unknown', reason: 'ps_failed' }) })
    assert.equal(unknown.sent, false)
    assert.equal(unknown.refused, 'unknown_observation')
    const prefix = compareRecord2({ ...probe.record, root: `${probe.record.root}-sibling`, operation: `${probe.record.operation}-sibling` }, { state: 'alive', ...probe.record })
    assert.equal(prefix.ok, false)
    assert.ok(prefix.issues.includes('start_mismatch') || prefix.issues.includes('argv_mismatch') || prefix.issues.includes('birth_root_mismatch'))
    const notGone = await waitGone(probe.handle, 100, () => ({ state: 'unknown', reason: 'ps_failed' }))
    assert.equal(notGone.gone, false)
    assert.equal(notGone.unknown, true)
    const controls = pureControls(probe.handle)
    assert.equal(controls.find((entry) => entry.id === 'prefix_root').expected ?? false, false)
    const term = signalFresh({ handle: probe.handle, signal: 'SIGTERM' })
    assert.equal(term.sent, true)
    assert.equal((await waitGone(probe.handle)).gone, true)
    assert.equal(classifyFixtures().unknownParse.state, 'unknown')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
