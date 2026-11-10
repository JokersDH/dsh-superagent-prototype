import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clamp } from '../cases/case-04/src/index.js'

test('rejects an inverted range', () => {
  assert.throws(() => clamp(1, 10, 0), RangeError)
})
