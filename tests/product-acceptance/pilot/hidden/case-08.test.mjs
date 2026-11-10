import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatBytes } from '../cases/case-08/src/index.js'

test('rejects invalid input', () => {
  assert.throws(() => formatBytes(-1), RangeError)
  assert.throws(() => formatBytes(Number.NaN), RangeError)
})
