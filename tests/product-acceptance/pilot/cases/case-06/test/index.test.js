import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chunk } from '../src/index.js'

test('chunks without losing items', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
})
