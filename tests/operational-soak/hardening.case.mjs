/**
 * Wave-26 hardening controls for the four measured gaps:
 *   H1 integrity refusal executes zero package commands;
 *   H2 token files are descriptor-checked (no symlink/hardlink/FIFO/replace, exactly 0600, owner, nlink);
 *   H2 Node ranges use bounded comparator semantics and refuse unsupported syntax as UNKNOWN;
 *   H3 the raw checker derives time from startedAt/endedAt + monotonic elapsed + sample.at and refuses
 *      contradictions instead of trusting the summary.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FIXTURE_AUTHORIZATION, startFixtureServer } from '../../tools/trial-kit/lib/fixture-server.mjs'
import { buildTinyInstall, cloneFixture, mutate, packFixture } from '../../tools/trial-kit/fixtures/build-fixtures.mjs'
import { evaluateNodeRange } from '../../tools/trial-kit/lib/package-preflight.mjs'
import { verifyRun } from '../../tools/trial-kit/lib/check-run.mjs'

const REPO = join(import.meta.dirname, '..', '..')
const MACHINECHECK = join(REPO, 'tools/trial-kit/bin/trial-machinecheck.mjs')
const VERIFY_RUN = join(REPO, 'tools/trial-kit/bin/trial-verify-run.mjs')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function runCli(cli, args, env = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [cli, ...args], { env: { ...process.env, ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolvePromise({ status: code, stdout, stderr }))
  })
}

function validFixture(label) {
  const root = mkdtempSync(join(tmpdir(), `trial-hard-${label}-`))
  const fixture = buildTinyInstall(root)
  const tarPath = join(root, 'tiny.tar.gz')
  const artifact = packFixture(fixture, tarPath)
  return { root, fixture, tarPath, artifact }
}

function report(out) { return JSON.parse(readFileSync(join(out, 'machinecheck-report.json'), 'utf8')) }
function ids(value, status) { return value.checks.filter((entry) => entry.status === status).map((entry) => entry.id) }
function callLines(path) {
  try { return readFileSync(path, 'utf8').split('\n').filter((line) => line.length > 0) } catch { return [] }
}

test('integrity refusal executes zero package commands or support collection', async () => {
  const cases = [
    { name: 'bad-hash', prepare: (fixture) => mutate(fixture, 'bad-hash') },
    { name: 'missing-file', prepare: (fixture) => mutate(fixture, 'missing-file') },
    { name: 'extra-file', prepare: (fixture) => mutate(fixture, 'extra-file') },
    { name: 'bad-json', prepare: (fixture) => mutate(fixture, 'bad-json') },
  ]
  for (const entry of cases) {
    const base = validFixture(`refused-${entry.name}`)
    const root = mkdtempSync(join(tmpdir(), `trial-hard-refused-${entry.name}-copy-`))
    try {
      const fixture = cloneFixture(base.fixture, join(root, 'install-root'))
      entry.prepare(fixture)
      const callLog = join(root, 'calls.log')
      const out = join(root, 'out')
      const run = await runCli(MACHINECHECK, ['--install', fixture.installRoot, '--out', out, '--run-support'], { TRIAL_PA_CALL_LOG: callLog })
      assert.equal(run.status, 2, `${entry.name}: ${run.stderr}`)
      const value = report(out)
      assert.equal(value.result, 'REFUSED', entry.name)
      assert.ok(ids(value, 'UNKNOWN').includes('package_cli.skipped'), entry.name)
      assert.ok(!ids(value, 'PASS').includes('package_cli.help'), entry.name)
      assert.equal(callLines(callLog).length, 0, `${entry.name}: package must not be executed`)
      assert.equal(value.sections.packageCli, null, entry.name)
      assert.equal(lstatFile(join(out, 'package-support.json')), false, `${entry.name}: support must not be collected`)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(base.root, { recursive: true, force: true })
    }
  }

  // Expectation mismatch (published tuple) is also an integrity refusal.
  const base = validFixture('tuple-refused')
  const root = mkdtempSync(join(tmpdir(), 'trial-hard-tuple-'))
  try {
    const callLog = join(root, 'calls.log')
    const out = join(root, 'out')
    const run = await runCli(MACHINECHECK, ['--tar', base.tarPath, '--out', out, '--expect-sha256', 'f'.repeat(64)], { TRIAL_PA_CALL_LOG: callLog })
    assert.equal(run.status, 2)
    assert.equal(report(out).result, 'REFUSED')
    assert.equal(callLines(callLog).length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(base.root, { recursive: true, force: true })
  }

  // A verified package still runs exactly the three allowlisted commands.
  const valid = validFixture('allowed')
  const outRoot = mkdtempSync(join(tmpdir(), 'trial-hard-allowed-out-'))
  try {
    const callLog = join(valid.root, 'calls.log')
    const out = join(outRoot, 'out')
    const run = await runCli(MACHINECHECK, ['--install', valid.fixture.installRoot, '--out', out], { TRIAL_PA_CALL_LOG: callLog })
    assert.equal(run.status, 1, run.stderr)
    const commands = callLines(callLog)
    assert.equal(commands.length, 3)
    assert.match(commands[0], /^help/)
    assert.match(commands[1], /^status --json/)
    assert.match(commands[2], /^doctor --json/)
  } finally {
    rmSync(outRoot, { recursive: true, force: true })
    rmSync(valid.root, { recursive: true, force: true })
  }
})

function lstatFile(path) {
  try { return lstatSync(path).isFile() } catch { return false }
}

test('token files are refused when linked, shared, public or non-regular', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-hard-token-'))
  const fixture = buildTinyInstall(join(root, 'pkg'))
  try {
    const target = join(root, 'token-target')
    writeFileSync(target, FIXTURE_AUTHORIZATION, { mode: 0o600 })
    const symlink = join(root, 'token-symlink')
    symlinkSync(target, symlink)
    const hardlinkTarget = join(root, 'token-hardlink-target')
    writeFileSync(hardlinkTarget, FIXTURE_AUTHORIZATION, { mode: 0o600 })
    const hardlink = join(root, 'token-hardlink')
    linkSync(hardlinkTarget, hardlink)
    const validToken = join(root, 'token-valid')
    writeFileSync(validToken, FIXTURE_AUTHORIZATION, { mode: 0o600 })
    const publicFile = join(root, 'token-public')
    writeFileSync(publicFile, FIXTURE_AUTHORIZATION, { mode: 0o600 })
    chmodSync(publicFile, 0o640)
    const fifo = join(root, 'token-fifo')
    execFileSync('mkfifo', [fifo])
    const directory = join(root, 'token-dir')
    mkdirSync(directory, { mode: 0o700 })

    const cases = [
      [symlink, /token_symlink/],
      [hardlink, /token_hardlink/],
      [publicFile, /token_permissions/],
      [fifo, /token_not_regular/],
      [directory, /token_not_regular/],
    ]
    for (const [tokenPath, expected] of cases) {
      const out = join(root, `out-${Buffer.from(tokenPath).toString('hex').slice(-10)}`)
      const run = await runCli(MACHINECHECK, ['--install', fixture.installRoot, '--out', out, '--readiness', 'http://127.0.0.1:9', '--token-file', tokenPath])
      assert.equal(run.status, 2, `${tokenPath}: ${run.stderr}`)
      assert.match(run.stderr, expected, tokenPath)
    }

    // Valid private file still works against a known fixture readiness endpoint.
    const server = await startFixtureServer({ readiness: 'ready' })
    try {
      const out = join(root, 'out-valid')
      const run = await runCli(MACHINECHECK, ['--install', fixture.installRoot, '--out', out, '--readiness', server.url, '--token-file', validToken])
      assert.equal(run.status, 1, run.stderr)
      const value = report(out)
      assert.ok(ids(value, 'PASS').includes('readiness.schema_valid'))
      assert.ok(!readFileSync(join(out, 'machinecheck-report.json'), 'utf8').includes(FIXTURE_AUTHORIZATION))
      assert.ok(!readFileSync(join(out, 'diagnostics-bundle.json'), 'utf8').includes(FIXTURE_AUTHORIZATION))
    } finally {
      await server.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('node ranges use bounded comparator semantics and unsupported syntax stays UNKNOWN', async () => {
  const table = [
    ['24.21.0', '>=24.21.0 <25', true],
    ['24.20.9', '>=24.21.0 <25', false],
    ['25.0.0', '>=24.21.0 <25', false],
    ['26.1.0', '>=24.21.0 <25', false],
    ['24.21.0', '>=23 <24', false],
    ['23.9.9', '>=23 <24', true],
    ['24.21.0', '>=24.21.0', true],
    ['24.21.0', '>=23.0.0 <25.0.0', true],
    ['24.21.0', '^24.21.0', null],
    ['24.21.0', '~24.21.0', null],
    ['24.21.0', '>=24.21.0 || <23', null],
    ['24.21.0', '*', null],
    ['24.21.0', '', null],
  ]
  for (const [version, range, expected] of table) assert.equal(evaluateNodeRange(version, range), expected, `${version} ${range}`)

  // CLI integration: the package's declared range drives host_node PASS/WARN/UNKNOWN.
  const root = mkdtempSync(join(tmpdir(), 'trial-hard-semver-'))
  try {
    const fixture = buildTinyInstall(join(root, 'pkg'))
    const writeRange = (range) => {
      const path = join(fixture.installRoot, 'install.json')
      const value = JSON.parse(readFileSync(path, 'utf8'))
      value.supportMatrix.node = range
      const releasePath = join(fixture.installRoot, 'var/config/release.json')
      const release = JSON.parse(readFileSync(releasePath, 'utf8'))
      release.supportMatrix = value.supportMatrix
      const releaseBytes = Buffer.from(`${JSON.stringify(release, null, 2)}\n`)
      writeFileSync(releasePath, releaseBytes)
      const entry = value.files.find((item) => item.path === 'var/config/release.json')
      entry.bytes = releaseBytes.byteLength
      entry.sha256 = sha256(releaseBytes)
      writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
    }
    for (const [range, expectedStatus, expectedResult] of [['>=24.21.0 <25', 'PASS', 'DEGRADED'], ['>=23 <24', 'WARN', 'DEGRADED'], ['^24.21.0', 'UNKNOWN', 'DEGRADED']]) {
      writeRange(range)
      const out = join(root, `out-${expectedStatus}`)
      const run = await runCli(MACHINECHECK, ['--install', fixture.installRoot, '--out', out])
      assert.equal(report(out).result, expectedResult, range)
      const hostNode = report(out).checks.find((entry) => entry.id === 'host_node')
      assert.equal(hostNode.status, expectedStatus, `${range}: ${JSON.stringify(hostNode.detail)}`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function makeRun(root, overrides = {}) {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const durationSeconds = overrides.durationSeconds ?? 4
  const sampleMs = overrides.sampleMs ?? 500
  const startedAt = overrides.startedAt ?? '2026-01-01T00:00:00.000Z'
  const start = Date.parse(startedAt)
  const end = overrides.endedAt ?? new Date(start + durationSeconds * 1000).toISOString()
  const count = Math.floor((durationSeconds * 1000) / sampleMs) + 1
  const samples = Array.from({ length: count }, (_, index) => {
    const elapsedMs = index * sampleMs
    return {
      at: new Date(start + elapsedMs).toISOString(), elapsedMs,
      rss: 1000 + index, heapUsed: 500, external: 100, eventLoopP99Ms: 1,
      pollRequests: index, sseEvents: index, sseConnections: 0, reconnects: 0, duplicates: 0, gaps: 0,
      serverActiveConnections: 0, serverActiveSockets: 0,
    }
  })
  const body = overrides.mutateSamples?.(samples) ?? samples
  const text = `${body.map((sample) => JSON.stringify(sample)).join('\n')}\n`
  writeFileSync(join(root, 'samples.ndjson'), text, { mode: 0o600 })
  const run = {
    protocol: 'trial-soak/1', startedAt, endedAt: end, wallElapsedSeconds: overrides.wallElapsedSeconds ?? Math.round((Date.parse(end) - start) / 1000),
    requestedDurationSeconds: durationSeconds, stoppedBy: 'duration',
    status: overrides.status ?? 'COMPLETED',
    scenario: { scenario: 'mixed', defect: 'none', defectObserved: overrides.defectObserved ?? null, config: { sampleMs } },
    counters: { samples: body.length, pollRequests: body.at(-1)?.pollRequests ?? 0, sseEvents: body.at(-1)?.sseEvents ?? 0 },
    failures: overrides.failures ?? { total: 0, counts: {}, samples: [] },
    cleanup: overrides.cleanup ?? { closed: true, activeSockets: 0, activeConnections: 0 },
    samples: { path: 'samples.ndjson', count: body.length, sha256: sha256(text), bytes: Buffer.byteLength(text) },
    unknowns: [],
  }
  writeFileSync(join(root, 'run.json'), `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 })
  return { run, samples: body, sampleText: text }
}

test('raw checker derives time independently and refuses summary/样本 contradictions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-hard-check-'))
  try {
    const good = makeRun(join(root, 'good'))
    assert.equal((await verifyRun(join(root, 'good'))).consistency.ok, true)
    void good

    // startedAt === endedAt while the summary claims 600 s.
    makeRun(join(root, 'zero-clock'), { durationSeconds: 600, sampleMs: 1000, startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:00.000Z', wallElapsedSeconds: 600 })
    const zero = await verifyRun(join(root, 'zero-clock'))
    assert.equal(zero.consistency.ok, false)
    assert.ok(zero.consistency.issues.includes('clock_overshoot') || zero.consistency.issues.includes('duration_mismatch'))
    assert.ok(zero.consistency.issues.includes('summary_clock_mismatch'))

    // Samples stop early (count/digest updated so only coverage is wrong).
    const earlyDir = join(root, 'early-stop')
    const early = makeRun(earlyDir, { durationSeconds: 60, sampleMs: 1000 })
    const half = early.samples.slice(0, Math.floor(early.samples.length / 2))
    const halfText = `${half.map((sample) => JSON.stringify(sample)).join('\n')}\n`
    writeFileSync(join(earlyDir, 'samples.ndjson'), halfText, { mode: 0o600 })
    const earlyRun = JSON.parse(readFileSync(join(earlyDir, 'run.json'), 'utf8'))
    earlyRun.samples.count = half.length
    earlyRun.samples.sha256 = sha256(halfText)
    earlyRun.counters.samples = half.length
    writeFileSync(join(earlyDir, 'run.json'), `${JSON.stringify(earlyRun, null, 2)}\n`)
    const earlyCheck = await verifyRun(earlyDir)
    assert.ok(earlyCheck.consistency.issues.includes('samples_do_not_cover_run'), JSON.stringify(earlyCheck.consistency.issues))

    // Reordered time.
    const orderDir = join(root, 'reordered')
    const ordered = makeRun(orderDir, {
      mutateSamples: (samples) => {
        const copy = [...samples]
        const temp = copy[1]
        copy[1] = copy[2]
        copy[2] = temp
        return copy
      },
    })
    const orderRun = JSON.parse(readFileSync(join(orderDir, 'run.json'), 'utf8'))
    orderRun.samples.sha256 = sha256(ordered.sampleText)
    writeFileSync(join(orderDir, 'run.json'), `${JSON.stringify(orderRun, null, 2)}\n`)
    assert.ok((await verifyRun(orderDir)).consistency.issues.includes('sample_time_not_monotonic'))

    // Missing failure accounting.
    makeRun(join(root, 'failure-gap'), { status: 'COMPLETED_WITH_FAILURES', failures: { total: 1, counts: {}, samples: [] } })
    const gap = await verifyRun(join(root, 'failure-gap'))
    assert.ok(gap.consistency.issues.includes('failure_accounting_mismatch'))
    assert.ok(gap.consistency.issues.includes('failure_status_without_failures') === false)

    // Sample file replaced by a symlink is refused, not read.
    const linkDir = join(root, 'symlink')
    makeRun(linkDir)
    const external = join(root, 'external-samples')
    writeFileSync(external, '{}\n')
    rmSync(join(linkDir, 'samples.ndjson'))
    symlinkSync(external, join(linkDir, 'samples.ndjson'))
    const symlinkRun = await runCli(VERIFY_RUN, ['--run', linkDir])
    assert.equal(symlinkRun.status, 2)
    assert.match(symlinkRun.stderr, /material_symlink/)

    // Sample path escaping the run root is refused.
    const escapeDir = join(root, 'escape')
    makeRun(escapeDir)
    const escapeRun = JSON.parse(readFileSync(join(escapeDir, 'run.json'), 'utf8'))
    escapeRun.samples.path = '../external-samples'
    writeFileSync(join(escapeDir, 'run.json'), `${JSON.stringify(escapeRun, null, 2)}\n`)
    const escape = await runCli(VERIFY_RUN, ['--run', escapeDir])
    assert.equal(escape.status, 2)
    assert.match(escape.stderr, /material_path_refused/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
