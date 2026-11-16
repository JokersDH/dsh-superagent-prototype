/**
 * Wave-34 B3: actionable, non-retrying diagnostics for Runner control failures.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeRunnerFailure } from '../../../packages/execution/src/runner-diagnostics.ts'

test('missing executor and protocol version failures are actionable without retry', () => {
  const missing = describeRunnerFailure(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
  assert.equal(missing.code, 'missing_executor')
  assert.match(missing.action, /Reinstall|fix/)
  assert.equal(missing.needsOriginalReconciliation, false)
  const version = describeRunnerFailure(Object.assign(new Error('bad'), { code: 'invalid_response' }))
  assert.equal(version.code, 'version_mismatch')
  assert.match(version.action, /same source version/)
})

test('auth and foreign identity are distinguished from transient failures', () => {
  assert.equal(describeRunnerFailure(Object.assign(new Error('401'), { code: 'auth_failed' })).code, 'auth_failed')
  assert.equal(describeRunnerFailure(Object.assign(new Error('foreign'), { code: 'identity_mismatch' })).code, 'foreign_attempt')
  assert.equal(describeRunnerFailure(Object.assign(new Error('foreign'), { code: 'refused', serverError: 'foreign_producer' })).code, 'foreign_attempt')
})

test('terminal channel, old lease and stopped admission are named before any retry', () => {
  assert.equal(describeRunnerFailure(Object.assign(new Error('x'), { code: 'refused', serverError: 'stale_connection' })).code, 'terminal_channel')
  assert.equal(describeRunnerFailure(Object.assign(new Error('x'), { code: 'refused', reason: 'stale_lease' })).code, 'late_callback')
  assert.equal(describeRunnerFailure(Object.assign(new Error('x'), { code: 'refused', reason: 'admission_closed' })).code, 'terminal_channel')
})

test('unknown outcome requires original reconciliation and never promises a safe replay', () => {
  const unknown = describeRunnerFailure(Object.assign(new Error('x'), { code: 'unknown_outcome' }))
  assert.equal(unknown.code, 'unknown_outcome')
  assert.equal(unknown.needsOriginalReconciliation, true)
  assert.match(unknown.action, /do not automatically retry/i)
  const fallback = describeRunnerFailure(new Error('opaque'))
  assert.equal(fallback.code, 'unknown')
  assert.equal(fallback.needsOriginalReconciliation, true)
})
