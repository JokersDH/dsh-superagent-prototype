import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RecoveryTargetConfigurationSchema, RecoveryTargetInventorySchema, RecoveryTargetMaterialSchema } from '../src/index.ts'

const configuration = { protocol: 'recovery-target-configuration/1', projects: [{ sourceProjectId: 'old-project', targetProjectId: 'new-project',
  registration: { path: '/tmp/project', check: 'node_test' } }], executor: { profileId: 'codex', revision: 1, identityDigest: 'a'.repeat(64) } }
test('target configuration reuses operator registration and rejects credentials, argv or mapping collapse', () => {
  assert.equal(RecoveryTargetConfigurationSchema.safeParse(configuration).success, true)
  for (const change of [{ apiKey: 'not-public' }, { argv: ['execute'] }, { projects: [...configuration.projects, ...configuration.projects] }])
    assert.equal(RecoveryTargetConfigurationSchema.safeParse({ ...configuration, ...change }).success, false)
})
test('material and inventory cannot claim authority; source digests and full table identities remain explicit', () => {
  const material = { protocol: 'recovery-target-material/1', activationId: 'activation', generationId: 'generation', stateRoot: '/tmp/target',
    intentDigest: 'a'.repeat(64), configurationDigest: 'b'.repeat(64), manifestDigest: 'c'.repeat(64), productSchema: 15,
    preparedAt: '2026-11-11T00:00:00.000Z', startupAvailable: false }
  const inventory = { protocol: 'recovery-target-inventory/1', stateRoot: '/tmp/target', observedAt: material.preparedAt, productSchema: 15,
    databaseDigest: 'a'.repeat(64), integrity: 'ok', completeness: 'complete', tables: [{ name: 'works', category: 'business', rows: 0 }], issues: [], startupAvailable: false }
  assert.equal(RecoveryTargetMaterialSchema.safeParse(material).success, true)
  assert.equal(RecoveryTargetInventorySchema.safeParse(inventory).success, true)
  assert.equal(RecoveryTargetMaterialSchema.safeParse({ ...material, startupAvailable: true }).success, false)
  assert.equal(RecoveryTargetInventorySchema.safeParse({ ...inventory, startupAvailable: true }).success, false)
  assert.equal(RecoveryTargetInventorySchema.safeParse({ ...inventory, tables: [...inventory.tables, ...inventory.tables] }).success, false)
})
