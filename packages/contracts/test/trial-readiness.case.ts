import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { CONTRACT_IDENTITY, TrialReadinessSchema } from '../src/index.ts'

const view = { protocol: 'trial-readiness/1', observedAt: '2026-11-14T04:00:00.000Z', configurationRevision: 'a'.repeat(64),
  mode: 'personal', startupMode: 'normal', discussion: 'unknown', execution: { state: 'unknown' }, development: 'unknown',
  projects: { development: 0, discussion: 1, dispatchable: 0 }, profiles: { native: 0, controlled: 0, admittedNative: 0, admittedControlled: 0 },
  capabilities: { contextHistory: true, contextSources: true, decisions: false, proposals: false }, authorization: 'none' }
test('configuration-only readiness is strict and cannot smuggle credentials or a grant', () => {
  assert.deepEqual(TrialReadinessSchema.parse(view), view)
  for (const change of [{ authorization: 'granted' }, { baseURL: 'https://private.invalid' }, { principal: { userId: 'private' } },
    { projects: { ...view.projects, development: -1 } }, { development: 'configuration_present' }, { startupMode: 'recovery_readonly' },
    { profiles: { ...view.profiles, admittedNative: 1 } }]) assert.equal(TrialReadinessSchema.safeParse({ ...view, ...change }).success, false)
})
test('additive readiness JSON schema keeps the frozen Runner identity and rejects invalid scalar bounds', () => {
  const document = JSON.parse(readFileSync(new URL('../generated/trial-readiness.schema.json', import.meta.url), 'utf8'))
  const manifest = JSON.parse(readFileSync(new URL('../generated/trial-readiness.manifest.json', import.meta.url), 'utf8'))
  const ajv = new Ajv2020({ strict: false, validateFormats: false }), validate = ajv.compile(document.$defs.TrialReadiness)
  assert.equal(validate(view), true, JSON.stringify(validate.errors))
  assert.equal(validate({ ...view, projects: { ...view.projects, discussion: 129 } }), false)
  assert.equal(manifest.runtimeContractSchemaHash, CONTRACT_IDENTITY.schemaHash)
  assert.equal(CONTRACT_IDENTITY.schemaHash, '74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d')
})
