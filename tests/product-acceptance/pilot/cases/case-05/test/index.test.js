import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPalindrome } from '../src/index.js'

test('accepts a simple palindrome', () => {
  assert.equal(isPalindrome('racecar'), true)
})
