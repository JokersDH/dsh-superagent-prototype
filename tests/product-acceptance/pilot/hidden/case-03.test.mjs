import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePort } from '../cases/case-03/src/index.js'

test('rejects non-numeric, zero and out-of-range values', () => {
  for (const value of ['abc', '', '0', '65536', '1.5']) {
    assert.throws(() => parsePort(value), RangeError, value)
  }
})
