import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMainRecovery } from './main-recovery2.mjs'

test('H independently consumes main owner-exit takeover: same Work, question, check, acceptance and artifacts', { timeout: 60000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-main-recovery-'))
  try {
    const report = await runMainRecovery({ root })
    const failed = Object.entries(report.checks).filter(([, ok]) => ok !== true)
    assert.deepEqual(failed, [], JSON.stringify({ failed, readback: report.readback }))
    assert.equal(report.trace.virtualResources, 1)
    assert.equal(report.trace.turnStarts, 1)
    assert.equal(report.trace.nativeEffects, 1)
    assert.equal(report.successor.workId, report.original.workId)
    assert.equal(report.successor.attemptId, report.original.target.attemptId)
    assert.equal(report.readback.questionId, report.original.question.id)
    assert.equal(report.readback.questionValidity, 'answered')
    assert.equal(report.readback.bindingAfter, 'ended')
    assert.equal(report.readback.verification.results.find(row => row.criterionId === 'machine').outcome, 'PASS')
    assert.ok(report.readback.acceptance.criterionIds.includes('human'))
    assert.equal(report.readback.artifactCount, 3)
    assert.ok(report.readback.artifacts.every(entry => entry.bytes > 0))
    assert.equal(report.layers.physical, 'NOT_TESTED')
    assert.equal(report.layers.ackLost, 'NOT_TESTED')
    assert.equal(report.layers.schedulerSlots, 'NOT_TESTED')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
