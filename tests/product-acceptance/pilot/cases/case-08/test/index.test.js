import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatBytes } from '../src/index.js'

test('formats basic sizes', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KiB')
})
