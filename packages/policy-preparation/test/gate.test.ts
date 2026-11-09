/** WP-06 prepared-policy gate: only enforced, verified, undrifted policies admit work. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PolicyPreparation, admitPreparedPolicy } from '../src/index.ts'
import type { AgentProfile, PreparedExecutionPolicy } from '../../contracts/src/types.ts'

const contract = { workId: 'work-1', revision: 1, digest: 'd'.repeat(64) }
const spec = { ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract }
const profile: AgentProfile = {
  id: 'p', revision: 1, driverId: 'd', driverApiMajor: 1, driverRelease: 'r',
  executable: '/abs/bin', argv: [], expectedVersion: '1', nativeConfigRef: 'c',
  permissionPolicyRevision: 'policy-1', requiredFeatures: [],
}
const context = { currentFingerprint: 'f'.repeat(64), profile }
const record = (overrides: Partial<PreparedExecutionPolicy> = {}): PreparedExecutionPolicy => ({
  ...spec,
  requestedPolicyRevision: 'policy-1',
  nativeAppliedSettingsRef: 'settings-1',
  effectiveConfigFingerprint: 'f'.repeat(64),
  enforcement: 'enforced',
  verification: 'passed',
  evidenceRef: 'evidence-1',
  ...overrides,
})

test('an enforced, verified, matching policy is admitted', () => {
  assert.deepEqual(admitPreparedPolicy(record(), spec, context), { allowed: true })
})

test('a missing record is not_prepared', () => {
  const decision = admitPreparedPolicy(undefined, spec, context)
  assert.equal(decision.allowed, false)
  assert.equal((decision as { reason: string }).reason, 'not_prepared')
})

test('another attempt cannot borrow a prepared policy', () => {
  for (const field of ['ticketId', 'assignmentId', 'attemptId'] as const) {
    const decision = admitPreparedPolicy(record({ [field]: 'other' } as never), spec, context)
    assert.equal((decision as { reason: string }).reason, 'identity_mismatch', field)
  }
  const otherEpoch = admitPreparedPolicy(record({ fenceEpoch: 2 }), spec, context)
  assert.equal((otherEpoch as { reason: string }).reason, 'identity_mismatch')
  const otherContract = admitPreparedPolicy(record({ contract: { ...contract, revision: 2 } }), spec, context)
  assert.equal((otherContract as { reason: string }).reason, 'identity_mismatch')
})

test('advisory and approval-guarded policies never admit work', () => {
  for (const enforcement of ['advisory', 'approval_guarded'] as const) {
    const decision = admitPreparedPolicy(record({ enforcement }), spec, context)
    assert.equal((decision as { reason: string }).reason, 'advisory_only', enforcement)
  }
})

test('an untested or failed verification is unverified', () => {
  for (const verification of ['not_tested', 'failed'] as const) {
    const decision = admitPreparedPolicy(record({ verification }), spec, context)
    assert.equal((decision as { reason: string }).reason, 'unverified', verification)
  }
})

test('config drift invalidates a previously good preparation', () => {
  const decision = admitPreparedPolicy(record(), spec, { ...context, currentFingerprint: '9'.repeat(64) })
  assert.equal((decision as { reason: string }).reason, 'config_drift')
})

test('a changed permission policy invalidates the preparation', () => {
  const decision = admitPreparedPolicy(record(), spec, { ...context, profile: { ...profile, permissionPolicyRevision: 'policy-2' } })
  assert.equal((decision as { reason: string }).reason, 'permission_policy_changed')
})

test('a held attempt refuses work but can still be cancelled', () => {
  const preparation = new PolicyPreparation()
  preparation.prepare(record())
  assert.deepEqual(preparation.admit(spec, context), { allowed: true })
  preparation.hold('config_drift', 'config changed on disk')
  const decision = preparation.admit(spec, context)
  assert.equal((decision as { reason: string }).reason, 'config_drift')
  assert.equal(preparation.canCancel(), true)
  // The record stays for diagnosis.
  assert.ok(preparation.record)
})

test('re-preparing clears the hold', () => {
  const preparation = new PolicyPreparation()
  preparation.prepare(record())
  preparation.hold('config_drift', 'changed')
  preparation.prepare(record())
  assert.deepEqual(preparation.admit(spec, context), { allowed: true })
})
