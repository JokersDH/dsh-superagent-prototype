/**
 * Outcome 3: one structured policy for "is this draft still current".
 *
 * Every cause has its own stable code, so a consumer (main/F) can render guidance without parsing
 * message text, and a hash or timestamp is never treated as an authorization.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CURRENCY_REASON_CODES,
  PreviewError,
  assertDraftCurrent,
  draftCurrency,
  matchRecipe,
  parseProjectRecipeDraft,
} from '../src/index.ts'
import { NOW, alphaFacts, configuration } from './fixtures.ts'

const expiring = {
  ...configuration,
  projects: [{ ...configuration.projects[0]!, scope: { ...configuration.projects[0]!.scope, expiresAt: '2026-11-14T13:00:00.000Z' } }],
}

const draftOf = (config: unknown = configuration) => {
  const value = parseProjectRecipeDraft(matchRecipe({ facts: alphaFacts, configuration: config, kind: 'regression_fix', selection: { paths: ['src/'] }, now: NOW }))
  assert.equal(value.status, 'draft')
  if (value.status !== 'draft') throw new Error('fixture must draft')
  return value
}

// The draft is always produced from the base configuration; the comparison target varies.
const codes = (against: unknown, facts: unknown, now: string | undefined = NOW, maxFactsAgeMs?: number) =>
  draftCurrency(draftOf(), { configuration: against, facts, now, ...(maxFactsAgeMs === undefined ? {} : { maxFactsAgeMs }) }).reasons.map(
    (entry) => entry.code,
  )

test('a current draft reports no reasons and full observation', () => {
  const currency = draftCurrency(draftOf(), { configuration, facts: alphaFacts, now: NOW })
  assert.equal(currency.current, true)
  assert.deepEqual(currency.reasons, [])
  assert.equal(currency.observationComplete, true)
})

test('configuration causes are separated: version, schema, revision, project removal', () => {
  assert.deepEqual(codes({ ...configuration, protocol: 'application-configuration/2' }, alphaFacts), ['configuration_unsupported_version'])
  assert.deepEqual(codes({ ...configuration, revision: 'nope' }, alphaFacts), ['configuration_invalid'])
  assert.deepEqual(codes({ ...configuration, revision: '9'.repeat(64) }, alphaFacts), ['configuration_changed'])
  assert.deepEqual(codes({ ...configuration, projects: [] }, alphaFacts), ['project_removed'])
})

test('facts causes are separated: parse, content, future, expiry', () => {
  assert.deepEqual(codes(configuration, { ...alphaFacts, protocol: 'project-facts/2' }), ['facts_invalid'])
  assert.deepEqual(codes(configuration, { ...alphaFacts, scripts: [...alphaFacts.scripts, 'lint'] }), ['facts_changed'])
  assert.deepEqual(codes(configuration, { ...alphaFacts, observedAt: '2099-01-01T00:00:00.000Z' }), ['facts_future'])
  assert.deepEqual(codes(configuration, alphaFacts, '2026-11-14T20:00:00.000Z'), ['facts_expired'])
})

test('a changed scope expiry is its own reason', () => {
  const draft = draftOf(expiring)
  assert.equal(draft.status, 'draft')
  const late = draftCurrency(draft, { configuration: expiring, facts: alphaFacts, now: '2026-11-14T13:30:00.000Z', maxFactsAgeMs: 4 * 60 * 60 * 1000 })
  assert.deepEqual(late.reasons.map((entry) => entry.code), ['expiry_passed'])
  assert.equal(late.reasons[0]!.field, 'expiry')
  const early = draftCurrency(draft, { configuration: expiring, facts: alphaFacts, now: '2026-11-14T12:30:00.000Z' })
  assert.equal(early.current, true)
})

test('an invalid clock is a clock reason, not a facts change', () => {
  for (const now of ['not-a-time', '']) {
    const currency = draftCurrency(draftOf(), { configuration, facts: alphaFacts, now })
    assert.deepEqual(currency.reasons.map((entry) => [entry.code, entry.field]), [['clock_invalid', 'clock']])
  }
  const negative = draftCurrency(draftOf(), { configuration, facts: alphaFacts, now: NOW, maxFactsAgeMs: -1 })
  assert.deepEqual(negative.reasons.map((entry) => entry.code), ['clock_invalid'])
})

test('an incomplete observation stays current by content but is not claimed complete', () => {
  const sparse = { ...alphaFacts, missing: ['lockfile' as const], omissions: [{ field: 'scripts' as const, reason: 'truncated' as const }] }
  const draft = parseProjectRecipeDraft(matchRecipe({ facts: sparse, configuration, kind: 'regression_fix', selection: { paths: ['src/'] }, now: NOW }))
  assert.equal(draft.status, 'draft')
  const currency = draftCurrency(draft, { configuration, facts: sparse, now: NOW })
  assert.equal(currency.current, true)
  assert.equal(currency.observationComplete, false)
})

test('assertDraftCurrent keeps the established error contract on top of the reasons', () => {
  assert.throws(
    () => assertDraftCurrent(draftOf(), { configuration, facts: { ...alphaFacts, scripts: [] }, now: NOW }),
    (error: unknown) => error instanceof PreviewError && error.code === 'stale_inputs' && error.staleInputs.includes('facts'),
  )
  assert.throws(
    () => assertDraftCurrent(draftOf(), { configuration, facts: alphaFacts, now: 'bad' }),
    (error: unknown) => error instanceof PreviewError && error.code === 'invalid_clock',
  )
  assert.throws(
    () => assertDraftCurrent(draftOf(), { configuration: { ...configuration, protocol: 'application-configuration/2' }, facts: alphaFacts, now: NOW }),
    (error: unknown) => error instanceof PreviewError && /配置版本不受支持/.test(error.message),
  )
})

test('the reason vocabulary is closed and exported in a stable order', () => {
  assert.deepEqual([...CURRENCY_REASON_CODES], [
    'configuration_unsupported_version',
    'configuration_invalid',
    'configuration_changed',
    'project_removed',
    'facts_invalid',
    'facts_changed',
    'facts_future',
    'facts_expired',
    'expiry_passed',
    'clock_invalid',
  ])
})
