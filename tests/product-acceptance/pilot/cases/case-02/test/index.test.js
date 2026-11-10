import assert from 'node:assert/strict'
import { test } from 'node:test'
import { slugify } from '../src/index.js'

test('normalises a title', () => {
  assert.equal(slugify('  Hello, World! '), 'hello-world')
})
