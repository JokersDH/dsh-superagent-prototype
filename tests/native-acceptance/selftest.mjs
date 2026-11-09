/**
 * Harness self-test: the acceptance tooling must be able to *fail*.
 *
 * A harness that can only report it works is worthless. This exercises the pure decision logic with
 * inputs that must be rejected, so a regression in the gate is caught without a running product.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCreateWork, isFixtureProfile, selectNativeProfile } from './cases.mjs'
import { ApiClient, CaseLog, parseArgs } from './harness.mjs'

test('a configuration with only fixture profiles yields no native selection', () => {
  const selection = selectNativeProfile({
    projects: [],
    profiles: [
      { id: 'profile-fixture-pass', kind: 'controlled_fixture', readiness: 'fixture_ready', dispatchAllowed: true },
      { id: 'profile-fixture-fail', kind: 'controlled_fixture', readiness: 'fixture_ready', dispatchAllowed: true },
    ],
  })
  assert.equal(selection.available, false)
  assert.match(selection.reason, /no native profile/)
})

test('a native profile that is not admitted is not selectable', () => {
  const selection = selectNativeProfile({
    profiles: [{ id: 'profile-codex-native', kind: 'native', readiness: 'inspection_passed', dispatchAllowed: false, blockedReason: 'policy_unprepared' }],
  })
  assert.equal(selection.available, false)
  assert.match(selection.reason, /none is admitted/)
})

test('an admitted native profile is selected by its published id', () => {
  const selection = selectNativeProfile({
    profiles: [
      { id: 'profile-other-native', kind: 'native', readiness: 'native_test_passed', dispatchAllowed: true },
      { id: 'profile-codex-native', kind: 'native', readiness: 'native_test_passed', dispatchAllowed: true },
    ],
  })
  assert.equal(selection.available, true)
  assert.equal(selection.profile.id, 'profile-codex-native')
})

test('fixture detection is exact, not a substring guess', () => {
  assert.equal(isFixtureProfile('profile-fixture-pass'), true)
  assert.equal(isFixtureProfile('profile-codex-native'), false)
  assert.equal(isFixtureProfile('profile-fixturex'), false)
})

test('create_work is built from the published configuration', () => {
  const configuration = {
    projects: [{ id: 'project-real', scope: { allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, defaultCriteria: [{ kind: 'machine', id: 'node_test', required: true }] }],
  }
  const command = buildCreateWork(configuration, { id: 'profile-codex-native' }, 'add a function')
  assert.equal(command.projectId, 'project-real')
  assert.equal(command.profileId, 'profile-codex-native')
  assert.equal(command.criteria.length, 1)
})

test('a case that cannot run is never recorded as PASS', () => {
  const log = new CaseLog()
  log.begin('X', 'x', 'native')
  log.notTested('prerequisite missing')
  assert.equal(log.cases[0].status, 'NOT_TESTED')
})

test('arguments are parsed strictly', () => {
  const parsed = parseArgs(['--url', 'http://127.0.0.1:9000', '--run-native'])
  assert.equal(parsed.url, 'http://127.0.0.1:9000')
  assert.equal(parsed.runNative, true)
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/)
})

test('the client never sends a bearer when none is configured', () => {
  const client = new ApiClient({ url: 'http://127.0.0.1:1' })
  assert.equal(client.base, 'http://127.0.0.1:1')
  assert.equal(ApiClient.bootstrapTokenFrom('/nonexistent-dir'), undefined)
})
