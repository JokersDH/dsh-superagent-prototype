import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retryDelay } from '../cases/case-07/src/index.js'

test('doubles and caps', () => {
  assert.deepEqual([1, 2, 3].map(retryDelay), [1000, 2000, 4000])
  assert.equal(retryDelay(10), 30000)
})
