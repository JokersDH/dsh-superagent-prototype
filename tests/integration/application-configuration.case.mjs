import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { applicationConfiguration } from '../../apps/coordinator/product/configuration.ts'

const source = () => ({
  projects: [
    {
      id: 'project-scratch',
      displayName: 'Scratch',
      scope: { projectId: 'project-scratch', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
      defaultCriteria: [
        {
          id: 'output',
          kind: 'machine',
          required: true,
          description: 'Registered output check',
          checkDefinitionRef: 'check-output',
        },
      ],
    },
  ],
  profiles: [
    {
      id: 'profile-fixture',
      revision: 1,
      displayName: 'Controlled fixture',
      driverId: 'controlled-fixture',
      kind: 'controlled_fixture',
      readiness: 'fixture_ready',
    },
    {
      id: 'profile-native',
      revision: 1,
      displayName: 'Unverified agent',
      driverId: 'native-protocol',
      kind: 'native',
      readiness: 'not_tested',
    },
  ],
  checks: [{ id: 'check-output', revision: 1, displayName: 'Registered output check' }],
  enabledProfileIds: ['profile-fixture'],
})
const headers = { authorization: `Bearer ${'a'.repeat(64)}` }
const http = (read) =>
  createLocalHttpApp({
    application: {},
    principal: { userId: 'local-user', authorityRef: 'local-authority' },
    apiToken: 'a'.repeat(64),
    bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5174'],
    mode: 'fixture',
    ...(read ? { read } : {}),
  })

test('trusted runtime admission selects defaults and inspection never adds a profile to it', () => {
  const input = source()
  input.profiles[1].readiness = 'native_test_passed'
  const configuration = applicationConfiguration(input)
  assert.deepEqual(configuration.projects[0].profileIds, ['profile-fixture'])
  assert.equal(configuration.projects[0].defaultProfileId, 'profile-fixture')
  assert.equal(configuration.profiles[1].dispatchAllowed, false)
  assert.deepEqual(configuration, applicationConfiguration(input))
  input.enabledProfileIds.push('profile-native')
  assert.equal(applicationConfiguration(input).profiles[1].dispatchAllowed, true)
  input.profiles[1].readiness = 'inspection_passed'
  assert.throws(() => applicationConfiguration(input))
})
test('grant expiry blocks new defaults and changes the revision; broadened default scopes are refused', () => {
  const input = source()
  input.projects[0].scope.expiresAt = '2026-11-09T12:00:00.000Z'
  const before = applicationConfiguration(input, Date.parse('2026-11-09T11:00:00.000Z'))
  const expired = applicationConfiguration(input, Date.parse('2026-11-09T12:00:00.000Z'))
  assert.equal(expired.projects[0].dispatchAllowed, false)
  assert.equal(expired.projects[0].defaultProfileId, undefined)
  assert.equal(expired.projects[0].blockedReason, 'stale_contract')
  assert.notEqual(expired.revision, before.revision)
  input.projects[0].defaultScope = { ...input.projects[0].scope, allowedPaths: ['private/'] }
  assert.throws(() => applicationConfiguration(input), /exceed/)
})
test('bad admission identities and unregistered default checks fail closed', () => {
  for (const enabledProfileIds of [['unknown'], ['profile-fixture', 'profile-fixture']])
    assert.throws(() => applicationConfiguration({ ...source(), enabledProfileIds }))
  assert.throws(() => applicationConfiguration({ ...source(), checks: [] }))
  const blocked = applicationConfiguration({ ...source(), enabledProfileIds: [] })
  assert.equal(blocked.projects[0].dispatchAllowed, false)
  assert.equal(blocked.projects[0].defaultProfileId, undefined)
})
test('configuration is authenticated, bounded and strict; it accepts no actor or project query', async () => {
  let reads = 0
  const app = http({
    configuration: async () => {
      reads++
      return applicationConfiguration(source())
    },
  })
  assert.equal((await app.request('http://127.0.0.1/v1/configuration')).status, 401)
  assert.equal(reads, 0)
  for (const suffix of ['?actor=human', '?projectId=another'])
    assert.equal((await app.request(`http://127.0.0.1/v1/configuration${suffix}`, { headers })).status, 400)
  assert.equal(reads, 0)
  const response = await app.request('http://127.0.0.1/v1/configuration', { headers })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((await response.json()).projects[0].id, 'project-scratch')
  assert.equal(reads, 1)
  assert.equal((await http().request('http://127.0.0.1/v1/configuration', { headers })).status, 422)
})
test('a malformed backend projection cannot expose native credentials or launch metadata', async () => {
  const configuration = applicationConfiguration(source())
  const app = http({
    configuration: async () => ({
      ...configuration,
      profiles: [
        { ...configuration.profiles[0], executable: '/private/agent', credentialReference: 'secret-account-reference' },
      ],
    }),
  })
  const response = await app.request('http://127.0.0.1/v1/configuration', { headers })
  assert.equal(response.status, 400)
  assert.doesNotMatch(await response.text(), /secret-account-reference|private\/agent/)
})
