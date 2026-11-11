import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RecoveryPrepareSchema, RecoveryInspectionSchema } from '../src/index.ts'
test('recovery preflight is explicit, scoped and cannot carry a grant or force switch', () => {
  const value = { expectedFingerprint: 'a'.repeat(64), bindings: [{ sourceProjectId: 'project-one', project: { path: '/tmp/recovery-project', check: 'node_test' } }] }
  assert.equal(RecoveryPrepareSchema.safeParse(value).success, true)
  for (const change of [{ actor: 'forged' }, { force: true }, { authorization: true }, { bindings: [...value.bindings, ...value.bindings] }])
    assert.equal(RecoveryPrepareSchema.safeParse({ ...value, ...change }).success, false)
})
test('diagnostics cannot claim that recovery commit is available', () => {
  const value = { protocol: 'recovery-inspection/1', state: 'recovery_readonly', observedAt: '2026-11-11T00:00:00.000Z',
    inspectionFingerprint: 'a'.repeat(64), markerDigest: null, productSchema: 13, eventCursor: 0, heldQueue: { waiting: 0, parked: 0 },
    sourceWorksScanned: 0, sourceScanTruncated: false, projects: [], historicalAttempts: [], blockers: [], commitAvailable: false }
  assert.equal(RecoveryInspectionSchema.safeParse(value).success, true)
  assert.equal(RecoveryInspectionSchema.safeParse({ ...value, commitAvailable: true }).success, false)
})
