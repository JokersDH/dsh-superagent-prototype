import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { admittedNativeProfile, NativeAdmissionError, preparePersonalStartup } from '../../apps/coordinator/product/native-startup.ts'

const supported = process.platform === 'darwin' && process.arch === 'arm64'
const admittedVersion = JSON.parse(readFileSync(new URL('../../reports/releases/native-mvp/native-product.json', import.meta.url), 'utf8')).profileVersion
function fixture(t, { loginStatus = 0, version = admittedVersion } = {}) {
  const root = mkdtempSync('/tmp/pa-native-admission-'), bin = join(root, 'private bin'), state = join(root, 'state'), calls = join(root, 'calls.log')
  mkdirSync(bin, { mode: 0o700 }); mkdirSync(state, { mode: 0o700 }); writeFileSync(calls, '', { mode: 0o600 })
  const executable = join(bin, 'codex')
  writeFileSync(join(bin, 'which'), '#!' + process.execPath + '\nconsole.log(' + JSON.stringify(executable) + ')\n', { mode: 0o700 })
  const configure = status => writeFileSync(executable, '#!' + process.execPath + '\n' +
    'const fs=require("node:fs");const args=process.argv.slice(2);fs.appendFileSync(' + JSON.stringify(calls) + ',JSON.stringify(args)+"\\n");' +
    'if(args.length===1&&args[0]==="--version"){console.log(' + JSON.stringify(version) + ');process.exit(0)}' +
    'if(args.length===2&&args[0]==="login"&&args[1]==="status"){console.error("fixture-private-account");console.log("fixture-private-auth-material");process.exit(' + status + ')}' +
    'process.exit(98)\n', { mode: 0o700 })
  configure(loginStatus)
  const oldPath = process.env.PATH
  process.env.PATH = bin
  t.after(() => { if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }) })
  return { state, executable, configure, calls: () => readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) }
}
const reason = expected => error => error instanceof NativeAdmissionError && error.reason === expected &&
  !/fixture-private/.test(error.message)

test('native admission checks the exact CLI local login status without starting a task', { skip: !supported }, t => {
  const h = fixture(t)
  const profile = admittedNativeProfile()
  assert.equal(profile.executable, h.executable)
  assert.deepEqual(h.calls(), [['--version'], ['login', 'status']])
  assert.doesNotMatch(JSON.stringify(profile), /fixture-private/)
})

test('missing local authentication keeps personal startup in discussion mode with no starter or native admission', { skip: !supported }, t => {
  const h = fixture(t, { loginStatus: 1 })
  const result = preparePersonalStartup(h.state)
  assert.equal(result.executionUnavailable, 'needs_auth')
  assert.equal('native' in result, false)
  assert.deepEqual(result.projects, [])
  assert.deepEqual(h.calls(), [['--version'], ['login', 'status']])
  assert.doesNotMatch(JSON.stringify(result), /fixture-private/)
})

test('a ready first startup requires explicit project import instead of modifying a shared starter repository', { skip: !supported }, t => {
  const h = fixture(t)
  const result = preparePersonalStartup(h.state)
  assert.equal(result.native.profile.executable, h.executable)
  assert.deepEqual(result.native.projects, [])
  assert.deepEqual(result.projects, [])
  assert.deepEqual(result.registry.list(), [])
  assert.deepEqual(h.calls(), [['--version'], ['login', 'status']])
})

test('unexpected authentication inspection failure is unknown instead of logged in', { skip: !supported }, t => {
  const h = fixture(t, { loginStatus: 2 })
  assert.throws(() => admittedNativeProfile(), reason('probe_failed'))
  assert.deepEqual(h.calls(), [['--version'], ['login', 'status']])
})

test('an incompatible CLI does not inspect accounts or acquire authentication authority', { skip: !supported }, t => {
  const h = fixture(t, { version: 'codex-cli 0.0.0-incompatible' })
  assert.throws(() => admittedNativeProfile(), reason('incompatible_version'))
  assert.deepEqual(h.calls(), [['--version']])
})

test('local authentication admission is checked again on a later startup instead of cached', { skip: !supported }, t => {
  const h = fixture(t)
  admittedNativeProfile()
  h.configure(1)
  assert.throws(() => admittedNativeProfile(), reason('needs_auth'))
  assert.deepEqual(h.calls(), [['--version'], ['login', 'status'], ['--version'], ['login', 'status']])
})

test('explicit discussion-only does not invoke the native CLI', { skip: !supported }, t => {
  const h = fixture(t)
  const result = preparePersonalStartup(h.state, { discussionOnly: true })
  assert.equal(result.executionUnavailable, 'operator_disabled')
  assert.deepEqual(h.calls(), [])
})
