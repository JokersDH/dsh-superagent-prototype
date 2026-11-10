import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ExecutionProfileRef, RouteAdvice, Scope } from '@personal-agent/contracts'
import { adviseRoute, profileRefKey, validateAdviceForConfirmation } from '../src/index.ts'
import type { EligibilityReasonCode, EligibilityResult, RouteAdviceInput } from '../src/index.ts'

const NOW = '2026-11-10T00:00:00.000Z'
const scope: Scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const ref = (id = 'profile-a', digest = 'a'.repeat(64)): ExecutionProfileRef => ({
  profileId: id,
  revision: 1,
  identityDigest: digest,
})
const eligible = (value: ExecutionProfileRef, evidence = [`evidence-${value.profileId}`]): EligibilityResult => ({
  ref: value,
  eligible: true,
  reasons: [],
  evidenceRefs: evidence,
  budgetUnknown: false,
})
const excluded = (value: ExecutionProfileRef, code: EligibilityReasonCode = 'evidence_missing'): EligibilityResult => ({
  ref: value,
  eligible: false,
  reasons: [{ code, evidenceRefs: [`evidence-${value.profileId}`] }],
  evidenceRefs: [`evidence-${value.profileId}`],
  budgetUnknown: false,
})
const evidenceFor = (...values: ExecutionProfileRef[]) =>
  Object.fromEntries(values.map((value) => [profileRefKey(value), [`evidence-${value.profileId}`]]))

const baseInput = (overrides: Partial<RouteAdviceInput> = {}): RouteAdviceInput => ({
  id: 'advice-1',
  projectId: 'project-1',
  sourceRef: 'source-1',
  taskContextDigest: 'a'.repeat(64),
  catalogRevision: 'b'.repeat(64),
  policyRevision: 'policy-1',
  eligibility: [],
  evidenceByProfile: {},
  now: new Date(NOW),
  ...overrides,
})

const adviceOf = (input: RouteAdviceInput): RouteAdvice => {
  const result = adviseRoute(input)
  assert.equal(result.kind, 'advice')
  if (result.kind !== 'advice') throw new Error('unreachable')
  return result.advice
}

test('no eligible profile yields none_eligible with stable exclusions', () => {
  const advice = adviceOf(baseInput({ eligibility: [excluded(ref('profile-a'), 'not_admitted')] }))
  assert.equal(advice.basis, 'none_eligible')
  assert.equal(advice.suggestedProfileRef, null)
  assert.deepEqual(advice.eligibleProfileRefs, [])
  assert.equal(advice.excluded[0]?.reason, 'not_admitted')
  assert.equal(Date.parse(advice.expiresAt) > Date.parse(advice.createdAt), true)
})

test('one eligible profile is only_eligible with its evidence', () => {
  const value = ref('profile-a')
  const advice = adviceOf(baseInput({ eligibility: [eligible(value)], evidenceByProfile: evidenceFor(value) }))
  assert.equal(advice.basis, 'only_eligible')
  assert.deepEqual(advice.suggestedProfileRef, value)
  assert.deepEqual(advice.evidenceRefs, ['evidence-profile-a'])
  assert.equal(advice.reviewSuggested, true)
})

test('multiple eligible profiles need an explicit operator default or fixed rule', () => {
  const a = ref('profile-a')
  const b = ref('profile-b')
  const value = (overrides: Partial<RouteAdviceInput> = {}) =>
    baseInput({
      eligibility: [eligible(a), eligible(b)],
      evidenceByProfile: evidenceFor(a, b),
      ...overrides,
    })

  const operator = adviceOf(value({ operatorDefaultProfileRef: b }))
  assert.equal(operator.basis, 'operator_default')
  assert.deepEqual(operator.suggestedProfileRef, b)

  const fixed = adviceOf(
    value({ fixedRule: { profileRef: a, description: 'Repository default', evidenceRefs: ['rule-evidence'] } }),
  )
  assert.equal(fixed.basis, 'fixed_rule')
  assert.deepEqual(fixed.suggestedProfileRef, a)
  assert.ok(fixed.evidenceRefs.includes('rule-evidence'))

  const noRule = adviseRoute(value())
  assert.equal(noRule.kind, 'needs_operator_choice')
  if (noRule.kind === 'needs_operator_choice') assert.deepEqual(noRule.eligible, [a, b])
})

test('eligible advice without supporting evidence is blocked instead of fabricated', () => {
  const a = ref('profile-a')
  const result = adviseRoute(
    baseInput({
      eligibility: [eligible(a, [])],
      evidenceByProfile: {},
    }),
  )
  assert.equal(result.kind, 'blocked')
  if (result.kind === 'blocked') assert.equal(result.reason, 'evidence_missing')
})

test('review suggestion follows the explicit policy and never measured history', () => {
  const a = ref('profile-a')
  assert.equal(adviceOf(baseInput({ eligibility: [eligible(a)], evidenceByProfile: evidenceFor(a), reviewPolicy: 'never' })).reviewSuggested, false)
  assert.equal(adviceOf(baseInput({ eligibility: [eligible(a)], evidenceByProfile: evidenceFor(a), reviewPolicy: 'required' })).reviewSuggested, true)
})

test('confirmation revalidates expiry, task/catalog/policy, profile identity and scope', () => {
  const a = ref('profile-a')
  const advice = adviceOf(baseInput({ eligibility: [eligible(a)], evidenceByProfile: evidenceFor(a) }))
  const current = (overrides: Record<string, unknown> = {}) => ({
    now: new Date(NOW),
    projectId: 'project-1',
    taskContextDigest: 'a'.repeat(64),
    catalogRevision: 'b'.repeat(64),
    policyRevision: 'policy-1',
    projectScope: scope,
    profiles: [{ ref: a, admitted: true, allowedScope: scope, currentIdentityDigest: 'a'.repeat(64) }],
    ...overrides,
  })
  assert.equal(validateAdviceForConfirmation(advice, current()).ok, true)

  assert.deepEqual(validateAdviceForConfirmation(advice, current({ now: new Date(Date.parse(NOW) + 10 * 60_000) })).reasons.map((reason) => reason.code), ['expired'])
  assert.deepEqual(validateAdviceForConfirmation(advice, current({ taskContextDigest: 'c'.repeat(64) })).reasons.map((reason) => reason.code), ['task_context_changed'])
  assert.deepEqual(validateAdviceForConfirmation(advice, current({ catalogRevision: 'c'.repeat(64) })).reasons.map((reason) => reason.code), ['catalog_changed'])
  assert.deepEqual(validateAdviceForConfirmation(advice, current({ policyRevision: 'policy-2' })).reasons.map((reason) => reason.code), ['policy_changed'])
  assert.deepEqual(validateAdviceForConfirmation(advice, current({ profiles: [] })).reasons.map((reason) => reason.code), ['profile_missing'])
  assert.deepEqual(
    validateAdviceForConfirmation(
      advice,
      current({ profiles: [{ ref: a, admitted: false, allowedScope: scope, currentIdentityDigest: 'a'.repeat(64) }] }),
    ).reasons.map((reason) => reason.code),
    ['profile_not_eligible'],
  )
  assert.deepEqual(
    validateAdviceForConfirmation(
      advice,
      current({ profiles: [{ ref: a, admitted: true, allowedScope: scope, currentIdentityDigest: 'c'.repeat(64) }] }),
    ).reasons.map((reason) => reason.code),
    ['identity_drift'],
  )
  assert.deepEqual(
    validateAdviceForConfirmation(
      advice,
      current({
        profiles: [{ ref: a, admitted: true, allowedScope: { ...scope, allowedPaths: ['private'] }, currentIdentityDigest: 'a'.repeat(64) }],
      }),
    ).reasons.map((reason) => reason.code),
    ['scope_denied'],
  )
})
