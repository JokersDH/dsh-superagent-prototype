import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../../tools/bootstrap/personal-preview-launcher.mjs', import.meta.url), 'utf8')
const method = source.slice(source.indexOf('function privateDirectory('), source.indexOf('\nfunction context('))
const observe = overrides => ({ isDirectory: () => true, isSymbolicLink: () => false, mode: 0o700, uid: 123, ...overrides })
function invoke({ exists = false, mkdirError, stat = observe() } = {}) {
  const calls = []
  const check = runInNewContext(`${method}\nprivateDirectory`, {
    existsSync: () => exists,
    mkdirSync: () => { calls.push('mkdir'); if (mkdirError) throw mkdirError },
    lstatSync: () => { calls.push('inspect'); return stat }, process: { getuid: () => 123 },
  })
  return { calls, run: () => check('/synthetic/private') }
}
test('a concurrent first-start EEXIST is accepted only after checking the resulting private directory', () => {
  const h = invoke({ mkdirError: { code: 'EEXIST' } }); h.run()
  assert.deepEqual(h.calls, ['mkdir', 'inspect'])
})
test('racing symlink, public permissions, foreign owner and wrong type remain refused', () => {
  for (const stat of [observe({ isSymbolicLink: () => true }), observe({ mode: 0o755 }), observe({ uid: 456 }), observe({ isDirectory: () => false })]) {
    const h = invoke({ mkdirError: { code: 'EEXIST' }, stat }); assert.throws(h.run)
    assert.deepEqual(h.calls, ['mkdir', 'inspect'])
  }
})
test('other creation failures remain failures and existing directories are still checked', () => {
  const error = { code: 'EACCES' }, denied = invoke({ mkdirError: error })
  assert.throws(denied.run, value => value === error); assert.deepEqual(denied.calls, ['mkdir'])
  const existing = invoke({ exists: true }); existing.run(); assert.deepEqual(existing.calls, ['inspect'])
})
