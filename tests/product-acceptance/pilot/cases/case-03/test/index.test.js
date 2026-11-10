import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePort } from '../src/index.js'

test('parses a normal port', () => {
  assert.equal(parsePort('8080'), 8080)
})
