import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retryDelay } from '../src/index.js'

test('starts at one second', () => {
  assert.equal(retryDelay(1), 1000)
})
