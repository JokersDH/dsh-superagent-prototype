import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sumRange } from '../cases/case-01/src/index.js'

test('inclusive range includes both ends', () => {
  assert.equal(sumRange(1, 5), 15)
  assert.equal(sumRange(2, 4), 9)
})
