/**
 * P2 regression: reuse must never trust a hash or a timestamp, and time is always checked.
 *
 * Covers the wave-30 review point (same content with a future `observedAt` used to pass when the
 * caller supplied `now`), invalid clocks, malformed/unsupported current configuration, expired
 * scopes and drafts produced before `contentDigest` existed.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PreviewError,
  RecipeDraftError,
  matchRecipe,
  parseProjectRecipeDraft,
  previewInputs,
} from '../src/index.ts'
import { NOW, alphaFacts, configuration } from './fixtures.ts'

const draft = () => {
  const value = parseProjectRecipeDraft(matchRecipe({ facts: alphaFacts, configuration, kind: 'regression_fix', selection: { paths: ['src/'] }, now: NOW }))
  assert.equal(value.status, 'draft')
  if (value.status !== 'draft') throw new Error('fixture must draft')
  return value
}

const stale = (run: () => unknown): PreviewError => {
  try {
    run()
    assert.fail('expected a refusal')
  } catch (error) {
    assert.ok(error instanceof PreviewError, String(error))
    assert.equal(error.code, 'stale_inputs')
    return error
  }
}

test('a future observation of identical content is refused, with or without now', () => {
  const current = draft()
  const future = { ...alphaFacts, observedAt: '2099-01-01T00:00:00.000Z' }
  // Same content, so the content digest still matches — only the time is wrong.
  const withNow = stale(() => previewInputs(current, { configuration, facts: future, now: NOW }))
  assert.ok(withNow.staleInputs.includes('facts'))
  const withoutNow = stale(() => previewInputs(current, { configuration, facts: future }))
  assert.ok(withoutNow.staleInputs.includes('facts'))
})

test('invalid clocks are refused instead of being treated as current', () => {
  const current = draft()
  for (const now of ['not-a-time', '', '2026-13-45T99:99:99Z']) {
    assert.throws(
      () => previewInputs(current, { configuration, facts: alphaFacts, now }),
      (error: unknown) => error instanceof PreviewError && error.code === 'invalid_clock',
    )
  }
  for (const maxFactsAgeMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => previewInputs(current, { configuration, facts: alphaFacts, now: NOW, maxFactsAgeMs }),
      (error: unknown) => error instanceof PreviewError && error.code === 'invalid_clock',
    )
  }
})

test('an unsupported or malformed current configuration is stale configuration, not a trusted revision', () => {
  const current = draft()
  const v2 = stale(() => previewInputs(current, { configuration: { ...configuration, protocol: 'application-configuration/2' }, facts: alphaFacts, now: NOW }))
  assert.deepEqual(v2.staleInputs, ['configuration'])
  assert.match(v2.message, /配置版本不受支持/)

  const broken = stale(() => previewInputs(current, { configuration: { ...configuration, revision: 'nope' }, facts: alphaFacts, now: NOW }))
  assert.deepEqual(broken.staleInputs, ['configuration'])

  const removed = stale(() => previewInputs(current, { configuration: { ...configuration, projects: [] }, facts: alphaFacts, now: NOW }))
  assert.deepEqual(removed.staleInputs, ['configuration'])
})

test('an expired project scope is needs_input at generation and stale expiry at reuse', () => {
  const expiredConfig = {
    ...configuration,
    projects: [{ ...configuration.projects[0]!, scope: { ...configuration.projects[0]!.scope, expiresAt: '2026-11-14T11:00:00.000Z' } }],
  }
  const generated = parseProjectRecipeDraft(matchRecipe({ facts: alphaFacts, configuration: expiredConfig, kind: 'regression_fix', selection: { paths: ['src/'] }, now: NOW }))
  assert.equal(generated.status, 'needs_input')
  if (generated.status !== 'needs_input') return
  assert.deepEqual(generated.needsInput.map((item) => item.code), ['project_scope_expired'])

  // A draft made while the scope was still valid becomes stale once the expiry passes.
  const validConfig = {
    ...configuration,
    projects: [{ ...configuration.projects[0]!, scope: { ...configuration.projects[0]!.scope, expiresAt: '2026-11-14T13:00:00.000Z' } }],
  }
  const whileValid = parseProjectRecipeDraft(matchRecipe({ facts: alphaFacts, configuration: validConfig, kind: 'regression_fix', selection: { paths: ['src/'] }, now: NOW }))
  assert.equal(whileValid.status, 'draft')
  assert.throws(
    () => previewInputs(whileValid, { configuration: validConfig, facts: alphaFacts, now: '2026-11-14T13:30:00.000Z' }),
    (error: unknown) => error instanceof PreviewError && error.staleInputs.includes('expiry'),
  )
  // Before the expiry the same draft is still usable.
  assert.doesNotThrow(() => previewInputs(whileValid, { configuration: validConfig, facts: alphaFacts, now: '2026-11-14T12:30:00.000Z' }))
})

test('a draft from before contentDigest existed is refused with an explicit version error', () => {
  const current = draft()
  const { contentDigest: _dropped, ...olderFacts } = current.provenance.facts
  const older = { ...current, provenance: { ...current.provenance, facts: olderFacts } }
  assert.throws(
    () => parseProjectRecipeDraft(older),
    (error: unknown) => error instanceof RecipeDraftError && error.code === 'stale_draft_version',
  )
  assert.throws(
    () => previewInputs(older as typeof current, { configuration, facts: alphaFacts, now: NOW }),
    (error: unknown) => error instanceof PreviewError && error.code === 'stale_draft_version',
  )
})
