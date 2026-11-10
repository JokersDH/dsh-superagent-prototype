import assert from 'node:assert/strict'
import { test } from 'node:test'
import { slugify } from '../cases/case-02/src/index.js'

test('collapses and trims separators', () => {
  assert.equal(slugify('--A  B--'), 'a-b')
  assert.equal(slugify('***'), '')
})
