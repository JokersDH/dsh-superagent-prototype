import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import {
  ApplicationConfigurationSchema,
  CONFIGURATION_PROTOCOL,
  CONTRACT_IDENTITY,
  ExecutionProfileViewSchema,
} from '../src/index.ts'
import { criteria, scope } from './fixtures.ts'

const profile = {
  id: 'profile-fixture',
  revision: 1,
  displayName: 'Controlled Fixture',
  driverId: 'controlled-fixture',
  kind: 'controlled_fixture' as const,
  readiness: 'fixture_ready' as const,
  dispatchAllowed: true,
}
const project = {
  id: scope.projectId,
  displayName: 'Scratch project',
  scope,
  profileIds: [profile.id],
  defaultProfileId: profile.id,
  defaultCriteria: criteria,
  dispatchAllowed: true,
}
const configuration = {
  protocol: CONFIGURATION_PROTOCOL,
  revision: 'a'.repeat(64),
  projects: [project],
  profiles: [profile],
  checks: [{ id: 'check-1', revision: 1, displayName: 'Registered checks' }],
}

test('configuration is a typed read resource with explicit controlled fixture identity', () => {
  assert.deepEqual(ApplicationConfigurationSchema.parse(JSON.parse(JSON.stringify(configuration))), configuration)
  assert.equal(
    ApplicationConfigurationSchema.safeParse({ ...configuration, protocol: 'application-configuration/2' }).success,
    false,
  )
})
test('public configuration rejects launch paths, credentials, arbitrary fields and duplicate IDs', () => {
  for (const extra of [
    { executable: '/private/bin/agent' },
    { argv: ['--token', 'secret'] },
    { nativeConfigRef: 'private-config' },
    { credentialReference: 'private-key' },
  ])
    assert.equal(
      ApplicationConfigurationSchema.safeParse({ ...configuration, profiles: [{ ...profile, ...extra }] }).success,
      false,
    )
  for (const field of ['profiles', 'projects', 'checks'] as const)
    assert.equal(
      ApplicationConfigurationSchema.safeParse({
        ...configuration,
        [field]: [...configuration[field], ...configuration[field]],
      }).success,
      false,
    )
})
test('a vendor name or successful inspection alone cannot enable native execution', () => {
  const native = {
    ...profile,
    id: 'profile-native',
    kind: 'native',
    readiness: 'not_tested',
    dispatchAllowed: false,
    blockedReason: 'unsupported_capability',
  }
  assert.equal(ExecutionProfileViewSchema.safeParse(native).success, true)
  for (const readiness of ['not_tested', 'missing', 'needs_setup', 'needs_auth', 'incompatible', 'inspection_passed'])
    assert.equal(
      ExecutionProfileViewSchema.safeParse({ ...native, readiness, dispatchAllowed: true, blockedReason: undefined })
        .success,
      false,
    )
  assert.equal(
    ExecutionProfileViewSchema.safeParse({
      ...native,
      readiness: 'native_test_passed',
      dispatchAllowed: true,
      blockedReason: undefined,
    }).success,
    true,
  )
  assert.equal(ExecutionProfileViewSchema.safeParse({ ...native, readiness: 'fixture_ready' }).success, false)
  assert.equal(
    ExecutionProfileViewSchema.safeParse({ ...profile, blockedReason: 'unsupported_capability' }).success,
    false,
  )
})
test('project defaults require matching scope, enabled profile references and registered machine checks', () => {
  for (const invalid of [
    { ...project, id: 'another-project' },
    { ...project, profileIds: [profile.id, profile.id] },
    { ...project, defaultProfileId: 'unknown-profile' },
    { ...project, defaultProfileId: undefined },
    { ...project, defaultCriteria: criteria.filter((item) => item.kind === 'human') },
    { ...project, defaultCriteria: [{ ...criteria[0], checkDefinitionRef: 'unregistered' }] },
  ])
    assert.equal(ApplicationConfigurationSchema.safeParse({ ...configuration, projects: [invalid] }).success, false)
  assert.equal(
    ApplicationConfigurationSchema.safeParse({
      ...configuration,
      profiles: [{ ...profile, dispatchAllowed: false, blockedReason: 'unsupported_capability' }],
    }).success,
    false,
  )
})
test('the generated configuration schema validates independently and retains the frozen runtime identity', () => {
  const document = JSON.parse(readFileSync(new URL('../generated/configuration.schema.json', import.meta.url), 'utf8'))
  const ajv = new Ajv2020({ strict: false, validateFormats: false })
  const validate = ajv.compile(document)
  assert.equal(validate(configuration), true, JSON.stringify(validate.errors))
  assert.equal(validate({ ...configuration, profiles: [{ ...profile, executable: '/private/bin/agent' }] }), false)
  const manifest = JSON.parse(
    readFileSync(new URL('../generated/configuration.manifest.json', import.meta.url), 'utf8'),
  )
  assert.equal(manifest.runtimeContractSchemaHash, CONTRACT_IDENTITY.schemaHash)
  assert.equal(CONTRACT_IDENTITY.schemaHash, '74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d')
})
