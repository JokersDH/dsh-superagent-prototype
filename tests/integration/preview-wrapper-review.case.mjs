import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { join } from 'node:path'

const source = readFileSync(new URL('../../tools/bootstrap/verify-personal-preview.mjs', import.meta.url), 'utf8')
const constants = source.slice(source.indexOf('const REVIEWED_WRAPPERS'), source.indexOf('\nconst MAX_FILE'))
const check = source.slice(source.indexOf('function scriptCheck('), source.indexOf('\nfunction identity('))
const old = '8de31c59d8c9afe90d6464a9b9208d3757a57e76ea49d7af20e473b90360c5dc'
const current = '339bdac0912a05da701d04de0670e7b6cd49cc1d86687536fb809f45396d866c'
function verify(actual, declared) {
  const scriptCheck = runInNewContext(`${constants}\n${check}\nscriptCheck`, { join, HEX64: /^[a-f0-9]{64}$/,
    shellEntry: value => value, demand: (value, code) => { if (!value) throw new Error(code) },
    regular: path => path.endsWith('.mjs') ? { sha256: actual } : { bytes: Buffer.from(path.includes('Start') ? 'start' : path.includes('Stop') ? 'stop' : 'settings'), mode: 0o755 },
  })
  return scriptCheck('/synthetic', { wrapperSha256: declared, packagerSha256: 'a'.repeat(64) })
}
test('only two explicitly reviewed wrappers pass and neither a forged manifest nor a third digest grants admission', () => {
  verify(old, old); verify(current, current)
  for (const [actual, declared] of [[old, current], [current, old], ['f'.repeat(64), 'f'.repeat(64)]])
    assert.throws(() => verify(actual, declared), /unreviewed_launcher_bytes/)
})
