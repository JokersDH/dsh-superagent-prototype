/** CLI parsing, release admission and instance-record rules that other stages depend on. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
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
