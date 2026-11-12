/** CLI parsing, release admission and instance-record rules that other stages depend on. */
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { EXIT, UsageError, intOption, parseArgs } from '../lib/cli.mjs'
import { satisfiesSupportedNode } from '../lib/doctor.mjs'
import {
  readInstanceRecord,
  removeInstanceRecord,
  validateInstanceRecord,
  verifyInstance,
  writeInstanceRecord,
} from '../lib/instance.mjs'
import { RELEASE_FORMAT, ReleaseError, validateRelease } from '../lib/release.mjs'

test('parseArgs handles valued options, inline values, booleans, lists and rejects unknown options', () => {
  const spec = { port: 'string', open: 'boolean', 'map-path': 'list' }
  assert.deepEqual(parseArgs(['--port', '5190', '--open'], spec), { values: { port: '5190', open: true }, positionals: [] })
  assert.deepEqual(parseArgs(['--port=5191'], spec), { values: { port: '5191' }, positionals: [] })
  assert.deepEqual(parseArgs(['--map-path', 'a=b', '--map-path=c=d'], spec), {
    values: { 'map-path': ['a=b', 'c=d'] },
    positionals: [],
  })
  assert.throws(() => parseArgs(['--unknown'], spec), UsageError)
  assert.throws(() => parseArgs(['--port'], spec), UsageError)
  assert.throws(() => parseArgs(['--open=yes'], spec), UsageError)
})

test('intOption enforces bounded integers', () => {
  assert.equal(intOption({ port: '80' }, 'port', { min: 1, max: 100, fallback: 50 }), 80)
  assert.equal(intOption({}, 'port', { min: 1, max: 100, fallback: 50 }), 50)
  assert.throws(() => intOption({ port: '0' }, 'port', { min: 1, max: 100, fallback: 50 }), UsageError)
  assert.throws(() => intOption({ port: '1.5' }, 'port', { min: 1, max: 100, fallback: 50 }), UsageError)
})

test('the distribution admits exactly Node >=24.21.0 <25', () => {
  assert.equal(satisfiesSupportedNode('24.21.0'), true)
  assert.equal(satisfiesSupportedNode('24.30.1'), true)
  assert.equal(satisfiesSupportedNode('24.20.9'), false)
  assert.equal(satisfiesSupportedNode('25.0.0'), false)
  assert.equal(satisfiesSupportedNode('23.9.9'), false)
  assert.equal(satisfiesSupportedNode('not-a-version'), false)
})

const validRelease = () => ({
  format: RELEASE_FORMAT,
  formatVersion: 1,
  buildId: 'abc123',
  createdAt: '2026-11-10T04:00:00.000Z',
  source: { commit: 'a'.repeat(40), branch: 'codex/g3-local-distribution', dirty: false },
  producer: {
    product: 'dsh-superagent',
    version: '0.1.0',
    node: '24.21.0',
    pnpm: '11.7.0',
    sqlite: '3.53.4',
    productSchema: 6,
    platform: 'darwin',
    arch: 'arm64',
  },
  build: { consoleMode: 'http', consoleRoot: 'apps/console/dist', packageCount: 10 },
  artifacts: [{ path: 'apps/console/dist/index.html', bytes: 100, sha256: 'b'.repeat(64), kind: 'console' }],
  admission: { node: '>=24.21.0 <25', platform: 'darwin', arch: 'arm64', sqlite: '>=3.53.4' },
  limitations: ['same-machine install model'],
})

test('release manifest validation rejects unsafe paths, duplicates and unsupported versions', () => {
  const parsed = validateRelease(validRelease())
  assert.equal(parsed.buildId, 'abc123')
  assert.equal(parsed.artifacts.length, 1)
  assert.throws(() => validateRelease({ ...validRelease(), formatVersion: 2 }), (error) => error instanceof ReleaseError && error.code === 'release_version_unsupported')
  assert.throws(() => validateRelease({ ...validRelease(), artifacts: [{ ...validRelease().artifacts[0], path: '../escape' }] }), ReleaseError)
  assert.throws(
    () => validateRelease({ ...validRelease(), artifacts: [validRelease().artifacts[0], validRelease().artifacts[0]] }),
    ReleaseError,
  )
  assert.throws(() => validateRelease({ ...validRelease(), buildId: '' }), ReleaseError)
})

test('instance records round-trip privately and unverified processes are never reported as running', async (t) => {
  const configRoot = mkdtempSync(join(tmpdir(), 'pa-instance-'))
  try {
    assert.equal(readInstanceRecord(configRoot), null)
    const record = {
      protocol: 'personal-product-instance/1',
      pid: process.pid,
      processStart: 'Mon Nov 10 12:00:00 2026',
      apiPid: process.pid,
      consolePid: process.pid,
      apiURL: 'http://127.0.0.1:8790',
      consoleURL: 'http://127.0.0.1:5190',
      state: join(configRoot, '..', 'data'),
      install: join(configRoot, '..'),
      buildId: 'abc123',
      mode: 'fixture',
      access: 'local-development',
      startupMode: 'normal',
      startedAt: new Date().toISOString(),
    }
    writeInstanceRecord(configRoot, record)
    assert.deepEqual(readInstanceRecord(configRoot), record)
    // The current test process is alive but is not the launcher process for this install.
    const verification = await verifyInstance(record)
    assert.equal(verification.ok, false)
    assert.ok(verification.failures.includes('launcher_command'))
    assert.throws(() => validateInstanceRecord({ ...record, protocol: 'other/1' }))
    assert.throws(() => validateInstanceRecord({ ...record, consoleURL: record.apiURL }))
    removeInstanceRecord(configRoot)
    assert.equal(readInstanceRecord(configRoot), null)
  } finally {
    rmSync(configRoot, { recursive: true, force: true })
  }
  assert.equal(EXIT.BLOCKED, 2)
})

test('restore markers force the expected startup mode without being deleted', async (t) => {
  const { expectedStartupMode, readRestoreMarker, recoverySummary } = await import('../lib/recovery.mjs')
  const stateDir = mkdtempSync(join(tmpdir(), 'pa-recovery-marker-'))
  try {
    assert.equal(expectedStartupMode(stateDir), 'normal')
    assert.equal(readRestoreMarker(stateDir).present, false)
    writeFileSync(
      join(stateDir, 'restore-report.json'),
      JSON.stringify({
        protocol: 'personal-restore/1',
        requiresRevalidation: ['native environment must be re-probed'],
        pathMappings: { pendingRebind: ['/old/repo'] },
      }),
      { mode: 0o600 },
    )
    assert.equal(expectedStartupMode(stateDir), 'recovery_readonly')
    const summary = recoverySummary(stateDir)
    assert.equal(summary.startupMode, 'recovery_readonly')
    assert.deepEqual(summary.pendingRebind, ['/old/repo'])
    assert.deepEqual(summary.requiresRevalidation, ['native environment must be re-probed'])
    // An unreadable marker is still authoritative and still read-only.
    writeFileSync(join(stateDir, 'restore-report.json'), '{not-json', { mode: 0o600 })
    assert.equal(expectedStartupMode(stateDir), 'recovery_readonly')
    const broken = recoverySummary(stateDir)
    assert.equal(broken.startupMode, 'recovery_readonly')
    assert.equal(broken.markerValid, false)
    assert.ok(existsSync(join(stateDir, 'restore-report.json')), 'marker is never deleted by the launcher')
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test('daemon output is redacted before it reaches the private log', async (t) => {
  const { redact, createBoundedLog } = await import('../lib/daemon.mjs')
  const token = 'a'.repeat(64)
  assert.match(redact(`token=${token}`), /^token=\[redacted/)
  const bearer = redact('authorization: Bearer abcdefghijklmnop')
  assert.doesNotMatch(bearer, /abcdefghijklmnop/)
  assert.match(bearer, /\[redacted\]/)
  assert.match(redact('apiKey: "sk-live-abcdefghij"'), /\[redacted\]/)
  assert.doesNotMatch(redact('apiKey: "sk-live-abcdefghij"'), /sk-live-abcdefghij/)
  assert.equal(redact('plain log line'), 'plain log line')
  const root = mkdtempSync(join(tmpdir(), 'pa-log-'))
  try {
    const log = createBoundedLog(root, 'build-1')
    log.write('hello')
    const { readFileSync } = await import('node:fs')
    assert.match(readFileSync(log.path, 'utf8'), /hello/)
    assert.equal(lstatSync(log.path).mode & 0o777, 0o600)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('stop refuses an unknown live process and cleans only a provably stale record', async (t) => {
  const { stopInstance } = await import('../lib/stop.mjs')
  const { ensureRoots, resolveRoots } = await import('@personal-agent/portability')
  const base = mkdtempSync(join(tmpdir(), 'pa-stop-'))
  mkdirSync(join(base, 'install'), { recursive: true })
  try {
    const roots = resolveRoots({
      installRoot: join(base, 'install'),
      home: base,
      platform: 'darwin',
      overrides: {
        config: join(base, 'config'),
        data: join(base, 'data'),
        cache: join(base, 'cache'),
        logs: join(base, 'logs'),
        workspace: join(base, 'workspace'),
      },
    })
    ensureRoots(roots)
    const empty = await stopInstance({ roots, timeoutMs: 1000 })
    assert.equal(empty.ok, true)
    assert.equal(empty.status, 'STOPPED')

    // A live process that is not the launcher for this install must never be signalled.
    const record = {
      protocol: 'personal-product-instance/1',
      pid: process.pid,
      processStart: 'unrelated',
      apiPid: process.pid,
      consolePid: process.pid,
      apiURL: 'http://127.0.0.1:8790',
      consoleURL: 'http://127.0.0.1:5190',
      state: roots.data,
      install: roots.install,
      buildId: 'b',
      mode: 'fixture',
      access: 'local-development',
      startupMode: 'normal',
      startedAt: new Date().toISOString(),
    }
    const { writeInstanceRecord } = await import('../lib/instance.mjs')
    writeInstanceRecord(roots.config, record)
    const refused = await stopInstance({ roots, timeoutMs: 1000 })
    assert.equal(refused.ok, false)
    // A record with a missing/mismatched start identity is UNKNOWN before any signal; the precise
    // blocked code is unknown_live_resource, not a claimed identity mismatch.
    assert.equal(refused.code, 'unknown_live_resource')
    assert.equal(process.exitCode ?? 0, 0, 'the test process was not signalled')

    // A stale record whose launcher pid no longer exists is cleaned without touching anything.
    writeInstanceRecord(roots.config, { ...record, pid: 999_999, apiPid: 999_999, consolePid: 999_999 })
    const cleaned = await stopInstance({ roots, timeoutMs: 1000 })
    assert.equal(cleaned.ok, true)
    assert.equal(cleaned.status, 'STALE_RECORD_CLEANED')
    const { readInstanceRecord } = await import('../lib/instance.mjs')
    assert.equal(readInstanceRecord(roots.config), null)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
