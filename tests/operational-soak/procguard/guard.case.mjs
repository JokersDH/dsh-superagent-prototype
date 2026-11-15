/**
 * Birth/fresh-signal controls: only an exact own record may be signalled; forged, sibling, recycled,
 * pre-record and unknown records send nothing, and unknown material is retained.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { observeProcess, pureControls, signalFresh, spawnOwnProbe, waitGone } from './guard.mjs'

const PRODUCE = join(import.meta.dirname, 'produce.mjs')

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

test('own probe birth, TERM and fresh KILL are recorded; foreign records send nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-procguard-'))
  try {
    const produced = await run(['--out', join(root, 'run')])
    assert.equal(produced.status, 0, produced.stderr)
    const report = JSON.parse(readFileSync(join(root, 'run', 'report.json'), 'utf8'))
    assert.equal(report.ok, true)
    for (const field of ['pid', 'ppid', 'uid', 'start', 'command', 'root', 'config', 'operation'])
      assert.ok(report.births.normal[field] !== undefined && report.births.normal[field] !== null, field)
    assert.equal(report.checks.pureRefusals, true)
    assert.equal(report.checks.siblingRefused, true)
    assert.equal(report.checks.siblingUnaffected, true)
    assert.equal(report.checks.noForeignSignals, true)
    assert.equal(report.counts.foreignSignals, 0)
    assert.equal(report.checks.stubbornIgnoredTerm, true)
    assert.equal(report.checks.killFreshSent, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a forged record cannot signal a live own probe and unknown material is kept', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-procguard-forge-'))
  try {
    const probe = await spawnOwnProbe({ root, operation: 'wave28-test-forge' })
    const controls = pureControls(probe.record)
    assert.equal(controls.find((entry) => entry.id === 'own_matches').expected.ok, true)
    for (const entry of controls.filter((item) => item.id !== 'own_matches'))
      assert.equal(entry.expected.ok, false, entry.id)

    const forged = signalFresh({ record: { ...probe.record, start: 'Thu Jan  1 00:00:00 1970' }, signal: 'SIGTERM' })
    assert.equal(forged.sent, false)
    assert.equal(forged.refused, 'identity_not_fresh')
    assert.equal(observeProcess(probe.record.pid).alive, true)

    const unknown = signalFresh({ record: { ...probe.record, pid: 999999 }, signal: 'SIGKILL' })
    assert.equal(unknown.sent, false)
    assert.equal(observeProcess(probe.record.pid).alive, true)

    const term = signalFresh({ record: probe.record, signal: 'SIGTERM' })
    assert.equal(term.sent, true)
    assert.equal((await waitGone(probe.record.pid)).gone, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
