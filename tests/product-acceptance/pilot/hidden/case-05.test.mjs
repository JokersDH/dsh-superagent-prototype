import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPalindrome } from '../cases/case-05/src/index.js'

test('ignores case and punctuation', () => {
  assert.equal(isPalindrome('A man, a plan, a canal: Panama'), true)
  assert.equal(isPalindrome('No lemon, no melon'), true)
})
