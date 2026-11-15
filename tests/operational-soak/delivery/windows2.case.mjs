import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAckWindows, decideWindow } from './windows2.mjs'
import { evaluateResourceLedger, makeLedgerFixture, RESOURCE_KINDS } from './resources2.mjs'

test('ACK windows use original A rows: durable vs written vs unknown, zero resend', () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-windows-'))
  try {
    const report = runAckWindows({ root })
    const failed = Object.entries(report.checks).filter(([, ok]) => ok !== true)
    assert.deepEqual(failed, [], `failed: ${JSON.stringify(failed)}`)
    assert.equal(report.modelCalls, 0)
    assert.equal(report.vendorTurns, 0)
    assert.equal(report.signalsSent, 0)
    assert.ok(report.windows.length >= 8)
    assert.ok(report.windows.every((window) => window.resend === false && window.newCommandId === false && window.newAttempt === false))
    assert.match(report.notReached.join(' '), /NOT_REACHED|SIGKILL/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ACK window decisions treat observed-but-unpersisted and missing delivery as unknown', () => {
  assert.equal(decideWindow({ kind: 'receiver_observed_before_receipt', commandCount: 0, factCount: 0, answerPresent: false, deliveryStatus: null, receiverObserved: true }).state, 'indeterminate')
  assert.equal(decideWindow({ kind: 'missing_delivery', commandCount: 0, factCount: 1, answerPresent: true, deliveryStatus: null, receiverObserved: true }).durable, false)
  assert.equal(decideWindow({ kind: 'after_delivery_terminal', commandCount: 0, factCount: 1, answerPresent: true, deliveryStatus: 'response_written', receiverObserved: true }).state, 'unknown')
})

test('resource ledger: only a complete set with end evidence is quiescent; module close alone is not', () => {
  assert.deepEqual(RESOURCE_KINDS, ['process', 'child', 'socket', 'fd', 'timer', 'waiter', 'queue', 'journal', 'runner'])
  const full = evaluateResourceLedger(makeLedgerFixture('full'))
  assert.equal(full.quiescent, true)
  assert.equal(full.reason, 'all_known_resources_ended')
  for (const fixture of ['unknown', 'live', 'no-evidence', 'module-only']) {
    const result = evaluateResourceLedger(makeLedgerFixture(fixture))
    assert.equal(result.quiescent, false, `${fixture} must not be quiescent`)
    assert.equal(result.closeIsQuiescence, false)
  }
  assert.equal(evaluateResourceLedger({ resources: [], moduleClosed: true }).reason, 'empty_set')
  assert.equal(evaluateResourceLedger({ resources: [{ kind: 'made-up', id: 'x', ended: true, evidence: 'x' }] }).quiescent, false)
  assert.equal(evaluateResourceLedger({ resources: [{ kind: 'fd', id: '1', ended: true, evidence: 'a' }, { kind: 'fd', id: '1', ended: true, evidence: 'b' }] }).reason, 'duplicate_resource')
})
