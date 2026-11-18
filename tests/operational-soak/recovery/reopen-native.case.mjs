import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runReopenNative } from './reopen-native2.mjs'

test('graceful product.close ends the binding; reopening the ended Work rejects the old question (normal-close counterexample)', { timeout: 60000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-reopen-native-'))
  try {
    const report = await runReopenNative({ outRoot: root })
    assert.equal(report.checks.originalQuestionOpened, true)
    assert.equal(report.checks.sameAttempt, true)
    assert.equal(report.checks.noNewBeginCommand, true)
    assert.equal(report.checks.noSyntheticNewWork, true)
    assert.equal(report.checks.noVirtualNativeEffectAfterRestart, true)
    // Current main recovery gap: the original question is not projected after reopen and the
    // original answer is rejected as stale_binding. This is a baseline, not accepted recovery.
    assert.equal(report.reopen.answer.status, 'rejected')
    assert.equal(report.reopen.answer.error.code, 'stale_binding')
    assert.equal(report.observations.deliveriesAfterAnswer.some((delivery) => delivery.status === 'native_applied'), false)
    assert.equal(report.checks.originalAnswerNativeAppliedAfterRestart, false)
    assert.equal(report.observations.bindingAfterAnswer.state, 'ended')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
