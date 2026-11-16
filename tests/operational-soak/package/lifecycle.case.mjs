import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TAR = '/Users/hh/Desktop/joker/pa-artifacts/wave30-target/wave30-target-8296720.tar.gz'
const PRODUCE = join(import.meta.dirname, 'produce-lifecycle2.mjs')

test('exact package first-run/start/readiness/health/console/SSE/REUSED/stop in a private root', () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-lifecycle-'))
  try {
    const run = spawnSync(process.execPath, [PRODUCE, '--out', join(root, 'run'), '--tar', TAR], { encoding: 'utf8', timeout: 180000 })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    const report = JSON.parse(readFileSync(join(root, 'run', 'report.json'), 'utf8'))
    assert.deepEqual(report.failed, [])
    assert.equal(report.checks.readinessModeFixture, true)
    assert.equal(report.checks.readinessAuthorizationNone, true)
    assert.equal(report.checks.healthOk, true)
    assert.equal(report.checks.consoleServed, true)
    assert.equal(report.checks.sseConnected, true)
    assert.equal(report.checks.reusedSamePid, true)
    assert.equal(report.checks.reviewOnFixtureRefused, true)
    assert.equal(report.checks.stoppedOwnInstance, true)
    assert.equal(report.checks.stoppedNotServing, true)
    assert.equal(report.checks.noHSignal, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
