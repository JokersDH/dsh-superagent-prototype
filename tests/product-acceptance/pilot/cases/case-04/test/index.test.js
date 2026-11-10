import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clamp } from '../src/index.js'

test('clamps both directions', () => {
  assert.equal(clamp(5, 0, 10), 5)
  assert.equal(clamp(-1, 0, 10), 0)
  assert.equal(clamp(11, 0, 10), 10)
})
