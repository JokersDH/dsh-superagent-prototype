import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chunk } from '../cases/case-06/src/index.js'

test('rejects invalid sizes', () => {
  assert.throws(() => chunk([1], 0), RangeError)
  assert.throws(() => chunk([1], 1.5), RangeError)
})
