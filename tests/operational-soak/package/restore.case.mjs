import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const TAR = '/Users/hh/Desktop/joker/pa-artifacts/wave30-target/wave30-target-8296720.tar.gz'
const PRODUCE = join(import.meta.dirname, 'produce-restore2.mjs')

test('exact package backup/verify/restore keeps the original Work/question/answer and refuses overwrite', () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-restore-'))
  try {
    const output = execFileSync(process.execPath, [PRODUCE, '--out', join(root, 'run'), '--tar', TAR], { encoding: 'utf8', timeout: 180000 })
    const report = JSON.parse(output)
    assert.equal(report.status, 'OK_WITH_NOT_REACHED', JSON.stringify(report.failed))
    assert.deepEqual(report.failed, [])
    assert.equal(report.checks.backupCreated, true)
    assert.equal(report.checks.verifyOk, true)
    assert.equal(report.checks.restoreOk, true)
    assert.equal(report.checks.nativeApplied, true)
    assert.equal(report.checks.secondRestoreRefused, true)
    const written = JSON.parse(readFileSync(join(root, 'run', 'report.json'), 'utf8'))
    assert.match(written.reviewStartup, /^NOT_REACHED/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
