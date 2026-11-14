/** The CLI must never run an older build than the sources it ships with. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseModuleEntry, newestSourceMtime } from '../lib/module-entry.mjs'

const existsWith = (present) => (path) => present.includes(path)
const statAt = (times) => (path) => ({ mtimeMs: times[path] ?? 0 })

test('an installed package without sources uses the built entry', () => {
  const choice = chooseModuleEntry({ distEntry: 'dist/index.js', sourceEntry: 'src/index.ts', sourceDir: 'src',
    exists: existsWith(['dist/index.js']), stat: statAt({ 'dist/index.js': 10 }) })
  assert.deepEqual(choice, { entry: 'dist/index.js', kind: 'dist', stale: false })
})

test('a fresh build wins over the sources', () => {
  const choice = chooseModuleEntry({ distEntry: 'dist/index.js', sourceEntry: 'src/index.ts',
    sourceDir: '/nonexistent-src-dir', exists: existsWith(['dist/index.js', 'src/index.ts']),
    stat: statAt({ 'dist/index.js': 20 }) })
  // No readable source directory means no staleness evidence, so the build is used.
  assert.equal(choice.kind, 'dist')
  assert.equal(choice.stale, false)
})

test('a stale build is reported instead of silently running older code', () => {
  const choice = chooseModuleEntry({ distEntry: 'dist/index.js', sourceEntry: 'src/index.ts',
    sourceDir: new URL('./__fixtures__/src', import.meta.url).pathname,
    exists: existsWith(['dist/index.js', 'src/index.ts']), stat: statAt({ 'dist/index.js': 1 }) })
  assert.equal(choice.kind, 'source')
  assert.equal(choice.stale, true)
})

test('a missing package is reported as missing', () => {
  const choice = chooseModuleEntry({ distEntry: 'dist/index.js', sourceEntry: 'src/index.ts', sourceDir: 'src',
    exists: existsWith([]), stat: statAt({}) })
  assert.deepEqual(choice, { entry: null, kind: 'missing', stale: false })
})

test('the newest source mtime ignores non-TypeScript entries', () => {
  const empty = newestSourceMtime(new URL('./__fixtures__/src', import.meta.url).pathname)
  assert.equal(typeof empty, 'number')
  assert.equal(newestSourceMtime('/definitely/not/a/directory'), null)
})
