import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ExecutionProfileRef, Scope } from '@personal-agent/contracts'
import { evaluateEligibility, evaluateProfiles } from '../src/index.ts'
import type { EligibilityRequest, ProfileFacts } from '../src/index.ts'

const scope: Scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const ref = (id = 'codex-native', digest = 'a'.repeat(64)): ExecutionProfileRef => ({
  profileId: id,
  revision: 1,
  identityDigest: digest,
})
const facts = (overrides: Partial<ProfileFacts> = {}): ProfileFacts => ({
  ref: ref(),
  currentIdentityDigest: 'a'.repeat(64),
  admitted: true,
  admissionLayer: 'actual_native',
  capabilities: [{ feature: 'code', proven: true, layer: 'actual_native', evidenceRefs: ['capability-1'] }],
  allowedScope: scope,
  budget: { available: true, evidenceRefs: ['budget-1'] },
  isolation: { kind: 'sealed_copy', proofRef: 'proof-1', capsuleManifestDigest: 'f'.repeat(64) },
  dataEgressAuthorized: true,
  evidenceRefs: ['admission-1'],
  ...overrides,
})
const withoutIsolation = (overrides: Partial<ProfileFacts> = {}): ProfileFacts => {
  const { isolation: _isolation, ...rest } = facts(overrides)
  return rest
}
const request = (overrides: Partial<EligibilityRequest> = {}): EligibilityRequest => ({
  projectId: 'project-1',
  projectScope: scope,
  requiredLayer: 'actual_native',
  requiredCapabilities: ['code'],
  requiresIsolation: false,
  readOnlyRequired: false,
  ...overrides,
})
const codes = (result: ReturnType<typeof evaluateEligibility>) => result.reasons.map((reason) => reason.code)

test('a fully admitted native profile with matching identity, capability, scope and budget is eligible', () => {
  const result = evaluateEligibility(facts(), request())
  assert.equal(result.eligible, true)
  assert.deepEqual(result.reasons, [])
  assert.ok(result.evidenceRefs.includes('admission-1'))
  assert.ok(result.evidenceRefs.includes('capability-1'))
})

test('admission, identity, scope, budget and capability gaps are excluded with stable reasons', () => {
  assert.deepEqual(codes(evaluateEligibility(facts({ admitted: false }), request())), ['not_admitted'])
  assert.deepEqual(codes(evaluateEligibility(facts({ currentIdentityDigest: 'b'.repeat(64) }), request())), ['identity_drift'])
  assert.deepEqual(
    codes(evaluateEligibility(facts({ allowedScope: { ...scope, allowedPaths: ['private'] } }), request())),
    ['scope_denied'],
  )
  assert.deepEqual(
    codes(evaluateEligibility(facts({ budget: { available: false } }), request())),
    ['budget_unavailable'],
  )
  const unknownBudget = evaluateEligibility(facts({ budget: { available: true, unknown: true } }), request())
  assert.deepEqual(codes(unknownBudget), ['budget_unavailable'])
  assert.equal(unknownBudget.budgetUnknown, true)
  assert.deepEqual(codes(evaluateEligibility(facts(), request({ requiredCapabilities: ['review'] }))), ['unsupported_capability'])
})

test('controlled or schema evidence cannot satisfy a native requirement', () => {
  assert.deepEqual(
    codes(evaluateEligibility(facts({ admissionLayer: 'controlled' }), request({ requiredLayer: 'actual_native' }))),
    ['evidence_missing'],
  )
  assert.deepEqual(
    codes(
      evaluateEligibility(
        facts({ capabilities: [{ feature: 'code', proven: true, layer: 'controlled', evidenceRefs: ['capability-1'] }] }),
        request({ requiredLayer: 'actual_native' }),
      ),
    ),
    ['evidence_missing'],
  )
  assert.deepEqual(
    codes(
      evaluateEligibility(
        facts({ ref: ref('codex-brand', 'a'.repeat(64)), admissionLayer: 'controlled' }),
        request({ requiredLayer: 'actual_native' }),
      ),
    ),
    ['evidence_missing'],
  )
})

test('isolation proof is required when review or read-only execution is requested', () => {
  assert.deepEqual(
    codes(evaluateEligibility(withoutIsolation(), request({ requiresIsolation: true }))),
    ['read_only_unproven'],
  )
  assert.deepEqual(
    codes(
      evaluateEligibility(
        facts({ isolation: { kind: 'sealed_copy', proofRef: 'proof-1', capsuleManifestDigest: 'not-a-digest' } }),
        request({ requiresIsolation: true }),
      ),
    ),
    ['read_only_unproven'],
  )
  assert.deepEqual(
    codes(
      evaluateEligibility(
        facts({ isolation: { kind: 'native_read_only', proofRef: 'proof-1' } }),
        request({ requiresIsolation: true, readOnlyRequired: true }),
      ),
    ),
    [],
  )
  assert.deepEqual(
    codes(evaluateEligibility(facts({ dataEgressAuthorized: false }), request({ requiresIsolation: true }))),
    ['scope_denied'],
  )
})

test('multiple profiles keep caller order and never widen authorization', () => {
  const results = evaluateProfiles(
    [facts({ ref: ref('profile-b') }), facts({ ref: ref('profile-a', 'b'.repeat(64)) })],
    request({ requiredCapabilities: [] }),
  )
  assert.deepEqual(results.map((result) => result.ref.profileId), ['profile-b', 'profile-a'])
  assert.equal(results[0]?.eligible, true)
  assert.equal(results[1]?.eligible, false)
})
