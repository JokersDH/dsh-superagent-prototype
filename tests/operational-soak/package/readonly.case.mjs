import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TAR = '/Users/hh/Desktop/joker/pa-artifacts/wave30-target/wave30-target-8296720.tar.gz'
const SCRIPT = join(import.meta.dirname, 'produce-readonly2.mjs')

test('exact package status/recovery-status stay isolated across two private roots', () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-readonly-'))
  try {
    const output = execFileSync(process.execPath, [SCRIPT, '--out', join(root, 'run'), '--tar', TAR], { encoding: 'utf8', timeout: 120000 })
    const report = JSON.parse(output)
    assert.equal(report.status, 'OK_WITH_NOT_REACHED', JSON.stringify(report.failed))
    assert.deepEqual(report.failed, [])
    assert.equal(report.checks.rootsIsolated, true)
    assert.equal(report.checks.markerAbsentNotAuthority, true)
    assert.equal(report.checks.noTaskStarted, true)
    assert.match(report.sse, /^NOT_REACHED/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
