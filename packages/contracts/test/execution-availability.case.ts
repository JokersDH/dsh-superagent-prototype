import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApplicationConfigurationSchema } from '../src/configuration.ts'

const project = { id: 'discussion', displayName: '个人对话', scope: { projectId: 'discussion', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] },
  discussionOnly: true, profileIds: [], defaultCriteria: [{ id: 'review', kind: 'human', required: true, description: '审阅讨论内容' }],
  dispatchAllowed: false, blockedReason: 'unsupported_capability' }
const unavailable = { protocol: 'application-configuration/1', revision: 'a'.repeat(64), projects: [project], profiles: [], checks: [],
  executionAvailability: { state: 'unavailable', reason: 'not_installed' } }
test('unavailable execution exposes discussion without inventing a machine check or dispatch grant', () => {
  assert.ok(ApplicationConfigurationSchema.safeParse(unavailable).success)
  for (const reason of ['not_installed', 'incompatible_version', 'unsupported_platform', 'probe_failed', 'not_admitted', 'operator_disabled', 'recovery_readonly'])
    assert.ok(ApplicationConfigurationSchema.safeParse({ ...unavailable, executionAvailability: { state: 'unavailable', reason } }).success)
  assert.equal(ApplicationConfigurationSchema.safeParse({ ...unavailable, executionAvailability: { state: 'unavailable', reason: '/private/raw-diagnostic' } }).success, false)
  assert.equal(ApplicationConfigurationSchema.safeParse({ ...unavailable, executionAvailability: { state: 'available', kind: 'native' } }).success, false)
})
test('discussion and unavailable projections cannot turn a native or fixture profile into authority', () => {
  const profile = { id: 'native', revision: 1, displayName: 'Native', driverId: 'native', kind: 'native', readiness: 'native_test_passed', dispatchAllowed: true }
  assert.equal(ApplicationConfigurationSchema.safeParse({ ...unavailable, profiles: [profile] }).success, false)
  const enabled = { ...project, profileIds: ['native'], defaultProfileId: 'native', dispatchAllowed: true, blockedReason: undefined }
  assert.equal(ApplicationConfigurationSchema.safeParse({ ...unavailable, projects: [enabled], profiles: [profile] }).success, false)
  assert.equal(ApplicationConfigurationSchema.safeParse({ ...unavailable, projects: [enabled], profiles: [profile],
    executionAvailability: { state: 'available', kind: 'native' } }).success, false)
})
