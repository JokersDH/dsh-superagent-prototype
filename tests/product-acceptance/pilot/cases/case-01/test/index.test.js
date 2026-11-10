import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sumRange } from '../src/index.js'

test('sums a small range', () => {
  assert.equal(sumRange(2, 4), 5)
})
