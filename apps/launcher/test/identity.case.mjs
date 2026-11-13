/** Requested-identity comparison, exact argv parsing and startup serialization. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  argvMatchesCommand,
  daemonInvocationMismatches,
  identityDifferences,
  parseDaemonInvocation,
} from '../lib/identity.mjs'
import { StartLockHeld, acquireStartLock } from '../lib/start-lock.mjs'
import { verifyCoordinatorProcess } from '../lib/instance.mjs'

const record = () => ({
  protocol: 'personal-product-instance/1',
  pid: 12345,
  processStart: 'Mon Nov 10 12:00:00 2026',
  apiPid: 12346,
  consolePid: 12345,
  apiURL: 'http://127.0.0.1:8790',
  consoleURL: 'http://127.0.0.1:5190',
  state: '/tmp/pa-state',
  install: '/work/product',
  buildId: 'build-1',
  mode: 'fixture',
  access: 'local-development',
  startupMode: 'normal',
  startedAt: '2026-11-10T00:00:00.000Z',
})

test('reuse compares every requested identity field', () => {
  const desired = {
    install: '/work/product',
    state: '/tmp/pa-state',
    mode: 'fixture',
    access: 'local-development',
    buildId: 'build-1',
    startupMode: 'normal',
    consoleURL: 'http://127.0.0.1:5190',
    apiURL: 'http://127.0.0.1:8790',
  }
  assert.deepEqual(identityDifferences(record(), desired), [])
  const changes = [
    ['install', { install: '/other/product' }],
    ['state', { state: '/tmp/other' }],
    ['mode', { mode: 'personal' }],
    ['access', { access: 'token' }],
    ['buildId', { buildId: 'build-2' }],
    ['startupMode', { startupMode: 'recovery_readonly' }],
    ['consoleURL', { consoleURL: 'http://127.0.0.1:5191' }],
    ['apiURL', { apiURL: 'http://127.0.0.1:8791' }],
  ]
  for (const [field, patch] of changes) {
    const differences = identityDifferences(record(), { ...desired, ...patch })
    assert.equal(differences.length, 1, field)
    assert.equal(differences[0].field, field)
  }
})

test('exact argv comparison accepts ps basename but not a different argument token', () => {
  const argv = ['/usr/local/bin/node', '/work/product/apps/launcher/bin/pa.mjs', 'start', '--port', '5190']
  assert.equal(argvMatchesCommand(argv, 'node /work/product/apps/launcher/bin/pa.mjs start --port 5190'), true)
  assert.equal(
    argvMatchesCommand(argv, 'node /work/product/apps/launcher/bin/pa.mjs start --port 5190 --extra', { baseDir: '/work/product' }),
    false,
  )
  assert.equal(
    argvMatchesCommand(argv, 'node /work/product/apps/launcher/bin/pa.mjs start --port 51901', { baseDir: '/work/product' }),
    false,
  )
  // Relative script tokens are canonicalized against the install root.
  assert.equal(argvMatchesCommand(argv, 'node apps/launcher/bin/pa.mjs start --port 5190', { baseDir: '/work/product' }), true)
  assert.equal(argvMatchesCommand(argv, 'node apps/launcher/bin/other.mjs start --port 5190', { baseDir: '/work/product' }), false)
})

test('the coordinator --state value is compared as an exact token, not a substring', () => {
  const base = record()
  const parsed = parseDaemonInvocation([
    '/usr/local/bin/node',
    '/work/product/apps/coordinator/product/demo.ts',
    '--port',
    '8790',
    '--state',
    '/tmp/pa-state',
    '--console-origin',
    'http://127.0.0.1:5190',
    '--startup-mode',
    'normal',
  ])
  assert.equal(parsed.options.state, '/tmp/pa-state')
  assert.deepEqual(daemonInvocationMismatches(base, [
    '/usr/local/bin/node',
    '/work/product/apps/coordinator/product/demo.ts',
    '--port', '8790',
    '--state', '/tmp/pa-state-other',
    '--console-origin', 'http://127.0.0.1:5190',
    '--startup-mode', 'normal',
  ]), ['state'])
  assert.deepEqual(daemonInvocationMismatches(base, [
    '/usr/local/bin/node',
    '/work/product/apps/coordinator/product/demo.ts',
    '--port', '8790',
    '--state', '/tmp/pa-state',
    '--console-origin', 'http://127.0.0.1:5190',
    '--startup-mode', 'recovery_readonly',
  ]), ['startup_mode'])
})

test('concurrent startup is serialized: a live holder wins, a dead breadcrumb is replaced', async (t) => {
  const configRoot = mkdtempSync(join(tmpdir(), 'pa-start-lock-'))
  try {
    const first = await acquireStartLock(configRoot)
    try {
      await assert.rejects(() => acquireStartLock(configRoot), (error) => error instanceof StartLockHeld)
    } finally {
      first.release()
    }
    const second = await acquireStartLock(configRoot)
    second.release()
    // A dead holder pid cannot block forever; the breadcrumb is removed and the lock acquired.
    writeFileSync(join(configRoot, 'start.lock'), JSON.stringify({ pid: 999_999, processStart: 'gone' }), { mode: 0o600 })
    const recovered = await acquireStartLock(configRoot)
    const content = JSON.parse(readFileSync(join(configRoot, 'start.lock'), 'utf8'))
    assert.equal(content.pid, process.pid)
    recovered.release()
  } finally {
    rmSync(configRoot, { recursive: true, force: true })
  }
})

test('a reused/foreign PID is never accepted as the recorded coordinator child', { timeout: 30_000 }, async () => {
  const decoy = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })
  try {
    const fake = {
      ...record(),
      apiPid: decoy.pid,
      apiArgv: ['/usr/local/bin/node', '/work/product/apps/coordinator/product/demo.ts', '--port', '8790', '--state', '/tmp/pa-state'],
      apiProcessStart: 'not-the-real-start-time',
      apiUid: typeof process.getuid === 'function' ? process.getuid() : 0,
    }
    // The live pid is real but is not the coordinator for this state: identity fails and it is kept alive.
    const verification = await verifyCoordinatorProcess(fake)
    assert.equal(verification.ok, false)
    assert.ok(verification.failures.includes('api_argv'))
    assert.ok(verification.failures.includes('api_process_start'))
    assert.equal(decoy.exitCode, null, 'a foreign live PID is never signalled')
  } finally {
    decoy.kill('SIGTERM')
    await once(decoy, 'exit')
  }
})
