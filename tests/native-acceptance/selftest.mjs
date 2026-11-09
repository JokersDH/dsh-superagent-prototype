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
    projects: [{
      id: 'project-real',
      dispatchAllowed: true,
      profileIds: ['profile-codex-native'],
      scope: { allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
      defaultCriteria: [{ kind: 'machine', id: 'node_test', required: true, description: 'check passes', checkDefinitionRef: 'check-node-test' }],
    }],
  }
  const command = buildCreateWork(configuration, { id: 'profile-codex-native' }, 'add a function')
  assert.equal(command.projectId, 'project-real')
  assert.equal(command.profileId, 'profile-codex-native')
  assert.equal(command.criteria.length, 1)
  assert.equal(command.scope.projectId, 'project-real')
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

// --- B1 additions: legal contract, project selection, strict exit ------------

import { assertLoopback } from './harness.mjs'
import { selectProject, validateCommand } from './cases.mjs'

test('create_work satisfies the shared UserCommand schema', async () => {
  const { UserCommandSchema } = await import('../../packages/contracts/src/schemas.ts')
  const configuration = {
    projects: [{
      id: 'project-a',
      dispatchAllowed: true,
      profileIds: ['profile-codex-native'],
      scope: { allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
      defaultCriteria: [
        { kind: 'machine', id: 'node_test', required: true, description: 'the registered node_test check passes', checkDefinitionRef: 'check-node-test' },
        { kind: 'human', id: 'review', required: true, description: 'review the patch' },
      ],
    }],
  }
  const command = buildCreateWork(configuration, { id: 'profile-codex-native' }, 'add a function')
  const result = validateCommand(UserCommandSchema, command)
  assert.equal(result.ok, true, result.error)
  // Every published default is kept, including the required human criterion.
  assert.equal(command.criteria.length, 2)
  assert.ok(command.criteria.some(criterion => criterion.kind === 'human' && criterion.required))
})

test('a project that cannot dispatch the profile is never selected', () => {
  const configuration = {
    projects: [
      { id: 'project-fixture-only', dispatchAllowed: true, profileIds: ['profile-fixture-pass'] },
      { id: 'project-blocked', dispatchAllowed: false, profileIds: ['profile-codex-native'] },
      { id: 'project-codex', dispatchAllowed: true, profileIds: ['profile-codex-native'] },
    ],
  }
  const selection = selectProject(configuration, { id: 'profile-codex-native' })
  assert.equal(selection.project.id, 'project-codex')
  assert.deepEqual(selection.admitted, ['project-codex'])
})

test('projects[0] is never used as a fallback', () => {
  const configuration = {
    projects: [
      { id: 'project-first', dispatchAllowed: true, profileIds: ['profile-fixture-pass'] },
      { id: 'project-second', dispatchAllowed: true, profileIds: ['profile-codex-native'] },
    ],
  }
  assert.equal(selectProject(configuration, { id: 'profile-codex-native' }).project.id, 'project-second')
})

test('a command missing the required goal is rejected by the shared parser', async () => {
  const { UserCommandSchema } = await import('../../packages/contracts/src/schemas.ts')
  const result = validateCommand(UserCommandSchema, { commandId: 'c1', conversationId: 'conv', kind: 'create_work', projectId: 'p', profileId: 'pr' })
  assert.equal(result.ok, false)
})

test('private credentials are never sent to a non-loopback target', () => {
  assert.ok(assertLoopback('http://127.0.0.1:8796'))
  assert.ok(assertLoopback('http://localhost:8796'))
  assert.throws(() => assertLoopback('https://example.com'), /non-loopback/)
  assert.throws(() => assertLoopback('not-a-url'), /Invalid product URL/)
})

test('strict mode turns an unexecuted required native case into a non-zero exit', async () => {
  const { execFileSync } = await import('node:child_process')
  let failed = false
  try {
    execFileSync(process.execPath, ['tests/native-acceptance/run.mjs', '--url', 'http://127.0.0.1:1', '--state', '/nonexistent', '--require-native'], {
      cwd: new URL('../..', import.meta.url).pathname,
      encoding: 'utf8',
      timeout: 120_000,
    })
  } catch (error) {
    failed = (error.status ?? 0) !== 0
  }
  assert.equal(failed, true, 'strict mode must exit non-zero when native cases cannot run')
})
