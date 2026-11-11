/**
 * Negative cases for the B4 cost preflight (wave-06).
 *
 * The packet names four things that must NOT be accepted as proof of a bounded native turn:
 * a wall-clock timeout, an already-sent cancel, a single max_output_tokens field, and usage that
 * only arrives at the end. Each has a test here.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { currentRuntimePreflight, preflight } from './cost-preflight.mjs'

const complete = (over = {}) => ({
  priceSource: 'provider-price-table', provider: 'openai', model: 'gpt-5-codex',
  priceObservedAt: '2026-11-11', canStopWithinQuota: true, usageAvailableBeforeCompletion: true,
  fields: { maxTurns: 4 }, ...over,
})

test('the installed runtime is BLOCKED today, with every missing component named', () => {
  const result = currentRuntimePreflight()
  assert.equal(result.verdict, 'BLOCKED')
  assert.ok(result.blockers.length > 0)
  assert.match(result.blockers.join(' '), /no authoritative price source/)
  assert.match(result.blockers.join(' '), /usage arrives only after the turn/)
})

test('a fully specified bound is READY, or the preflight proves nothing', () => {
  const result = preflight(complete())
  assert.equal(result.verdict, 'READY')
  assert.equal(result.blockers.length, 0)
})

test('usage that only arrives after the turn cannot bound that turn', () => {
  const result = preflight(complete({ usageAvailableBeforeCompletion: false }))
  assert.equal(result.verdict, 'BLOCKED')
  assert.match(result.blockers.join(' '), /usage arrives only after the turn/)
})

test('a wall-clock timeout is not a bound', () => {
  // The only "limit" offered is elapsed time, which says nothing about tokens spent in it.
  const result = preflight(complete({ fields: { maxTurns: 4, wallClockTimeoutMs: 60_000 } }))
  const components = result.components.filter(item => item.component !== 'toolRounds')
  assert.ok(components.every(item => item.bounded), 'priced components stay bounded; the timeout adds nothing')
  // A timeout must not be what makes it pass: removing the price must still block it.
  const noPrice = preflight(complete({ fields: { maxTurns: 4, wallClockTimeoutMs: 60_000 }, priceSource: null }))
  assert.equal(noPrice.verdict, 'BLOCKED')
})

test('max_output_tokens alone is rejected as insufficient', () => {
  const result = preflight(complete({ fields: { maxOutputTokens: 8000 } }))
  assert.equal(result.verdict, 'BLOCKED')
  assert.match(result.blockers.join(' '), /maxOutputTokens alone bounds output only/)
  assert.match(result.blockers.join(' '), /toolRounds is not bounded/)
})

test('priced but unable to stop inside the quota is still BLOCKED', () => {
  const result = preflight(complete({ canStopWithinQuota: false }))
  assert.equal(result.verdict, 'BLOCKED')
  assert.match(result.blockers.join(' '), /cannot stop inside the remaining quota/)
})

test('a price with no concrete model cannot be applied', () => {
  const result = preflight(complete({ model: null }))
  assert.equal(result.verdict, 'BLOCKED')
  assert.match(result.blockers.join(' '), /no concrete model id/)
})

test('a price with no observed-at date is refused, because prices move', () => {
  const result = preflight(complete({ priceObservedAt: null }))
  assert.equal(result.verdict, 'BLOCKED')
  assert.match(result.blockers.join(' '), /no observed-at date/)
})

test('an alias without a provider is not a price identity', () => {
  const result = preflight(complete({ provider: null }))
  assert.equal(result.verdict, 'BLOCKED')
  assert.match(result.blockers.join(' '), /an alias is not a price identity/)
})

test('every billed component is enumerated, including cache write and reasoning', () => {
  const result = preflight(complete())
  const names = result.components.map(item => item.component)
  assert.deepEqual(names, [
    'inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens',
    'outputTokens', 'reasoningOutputTokens', 'toolRounds',
  ])
})
