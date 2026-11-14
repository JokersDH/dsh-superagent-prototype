/**
 * Machinecheck controls: package commands, readiness fixtures (positive + each refusal), token
 * privacy, stale/cross-subject expectations, support references and overwrite refusal.
 *
 * The fixture server runs in this process, so the CLI is spawned asynchronously (a blocking
 * spawnSync would stop the event loop and turn every request into a client-side deadline).
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FIXTURE_AUTHORIZATION, startFixtureServer } from '../../tools/trial-kit/lib/fixture-server.mjs'
import { buildTinyInstall } from '../../tools/trial-kit/fixtures/build-fixtures.mjs'

const REPO = join(import.meta.dirname, '..', '..')
const CLI = join(REPO, 'tools/trial-kit/bin/trial-machinecheck.mjs')

function runCli(args, env = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolvePromise({ status: code, stdout, stderr }))
  })
}

function report(out) { return JSON.parse(readFileSync(join(out, 'machinecheck-report.json'), 'utf8')) }
function ids(reportValue, status) { return reportValue.checks.filter((entry) => entry.status === status).map((entry) => entry.id) }

test('valid package + ready fixture produces reviewable material without leaking the token', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-mc-ok-'))
  const fixture = buildTinyInstall(root)
  const server = await startFixtureServer({ readiness: 'ready' })
  try {
    const out = join(root, 'out')
    const run = await runCli(['--install', fixture.installRoot, '--out', out, '--readiness', server.url,
      '--token-env', 'TRIAL_FIXTURE_TOKEN', '--expect-mode', 'fixture', '--max-observation-age-seconds', '300'],
    { TRIAL_FIXTURE_TOKEN: FIXTURE_AUTHORIZATION })
    assert.equal(run.status, 1, run.stderr)
    const value = report(out)
    assert.equal(value.result, 'DEGRADED')
    assert.ok(ids(value, 'PASS').includes('package_cli.doctor_required'))
    assert.ok(ids(value, 'PASS').includes('package_cli.no_state_writes'))
    assert.ok(ids(value, 'PASS').includes('readiness.http_status'))
    assert.ok(ids(value, 'PASS').includes('readiness.schema_valid'))
    assert.ok(ids(value, 'PASS').includes('readiness.authorization_none'))
    assert.ok(ids(value, 'PASS').includes('readiness.expected_subject'))
    assert.deepEqual(ids(value, 'FAIL'), [])
    assert.equal(value.sections.readiness.readiness.startupMode, 'normal')
    for (const name of ['machinecheck-report.json', 'diagnostics-bundle.json', 'reproduce.txt']) {
      const path = join(out, name)
      assert.equal(statSync(path).mode & 0o777, 0o600, `${name} must be 0600`)
      assert.ok(!readFileSync(path, 'utf8').includes(FIXTURE_AUTHORIZATION), `${name} must not contain the token`)
    }
    assert.match(readFileSync(join(out, 'reproduce.txt'), 'utf8'), /--token-env <YOUR_ENV_NAME>/)
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('readiness refusals are accurate for 401/500/invalid/oversized/unknown-field/stale/cross-subject', async () => {
  const cases = [
    { mode: 'unauthorized', expected: 'readiness.http_status', args: [] },
    { mode: 'server_error', expected: 'readiness.http_status', args: [] },
    { mode: 'invalid_schema', expected: 'readiness.schema_valid', args: [] },
    { mode: 'unknown_field', expected: 'readiness.schema_valid', args: [] },
    { mode: 'bad_json', expected: 'readiness.json_valid', args: [] },
    { mode: 'oversized', expected: 'readiness.body_size', args: [] },
  ]
  for (const entry of cases) {
    const root = mkdtempSync(join(tmpdir(), `trial-mc-${entry.mode}-`))
    const fixture = buildTinyInstall(root)
    const server = await startFixtureServer({ readiness: entry.mode })
    try {
      const out = join(root, 'out')
      const run = await runCli(['--install', fixture.installRoot, '--out', out, '--readiness', server.url, '--token-env', 'TRIAL_FIXTURE_TOKEN', ...entry.args],
        { TRIAL_FIXTURE_TOKEN: FIXTURE_AUTHORIZATION })
      assert.equal(run.status, 2, `${entry.mode}: ${run.stderr}`)
      assert.ok(ids(report(out), 'FAIL').includes(entry.expected), `${entry.mode}: ${ids(report(out), 'FAIL')}`)
    } finally {
      await server.close()
      rmSync(root, { recursive: true, force: true })
    }
  }

  // Stale observation and an explicitly wrong configuration revision.
  const root = mkdtempSync(join(tmpdir(), 'trial-mc-subject-'))
  const fixture = buildTinyInstall(root)
  const staleServer = await startFixtureServer({ readiness: 'ready', readinessObservedAt: '2020-01-01T00:00:00.000Z' })
  try {
    const outStale = join(root, 'out-stale')
    const stale = await runCli(['--install', fixture.installRoot, '--out', outStale, '--readiness', staleServer.url, '--token-env', 'TRIAL_FIXTURE_TOKEN', '--max-observation-age-seconds', '60'], { TRIAL_FIXTURE_TOKEN: FIXTURE_AUTHORIZATION })
    assert.equal(stale.status, 2)
    assert.ok(ids(report(outStale), 'FAIL').includes('readiness.observation_fresh'))
  } finally { await staleServer.close() }

  const wrongServer = await startFixtureServer({ readiness: 'ready' })
  try {
    const outWrong = join(root, 'out-wrong')
    const wrong = await runCli(['--install', fixture.installRoot, '--out', outWrong, '--readiness', wrongServer.url, '--token-env', 'TRIAL_FIXTURE_TOKEN', '--expect-configuration-revision', 'b'.repeat(64)], { TRIAL_FIXTURE_TOKEN: FIXTURE_AUTHORIZATION })
    assert.equal(wrong.status, 2)
    assert.ok(ids(report(outWrong), 'FAIL').includes('readiness.expected_subject'))
  } finally { await wrongServer.close() }
  rmSync(root, { recursive: true, force: true })
})

test('readiness deadline is a bounded failure, not a hang', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-mc-timeout-'))
  const fixture = buildTinyInstall(root)
  const server = await startFixtureServer({ readiness: 'ready', delayMs: 1500 })
  try {
    const out = join(root, 'out')
    const started = Date.now()
    const run = await runCli(['--install', fixture.installRoot, '--out', out, '--readiness', server.url, '--token-env', 'TRIAL_FIXTURE_TOKEN', '--timeout-ms', '200'], { TRIAL_FIXTURE_TOKEN: FIXTURE_AUTHORIZATION })
    assert.equal(run.status, 2)
    assert.ok(Date.now() - started < 5000, 'the client must stop at its own deadline')
    assert.ok(ids(report(out), 'FAIL').includes('readiness.deadline'))
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('token files must be private, and non-loopback targets are refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-mc-token-'))
  const fixture = buildTinyInstall(root)
  try {
    const insecure = join(root, 'token.txt')
    writeFileSync(insecure, FIXTURE_AUTHORIZATION, { mode: 0o644 })
    const publicToken = await runCli(['--install', fixture.installRoot, '--out', join(root, 'out-a'), '--readiness', 'http://127.0.0.1:9', '--token-file', insecure])
    assert.equal(publicToken.status, 2)
    assert.match(publicToken.stderr, /token_permissions/)

    const privateToken = join(root, 'private-token')
    writeFileSync(privateToken, FIXTURE_AUTHORIZATION, { mode: 0o600 })
    const remote = await runCli(['--install', fixture.installRoot, '--out', join(root, 'out-b'), '--readiness', 'http://example.com:80', '--token-file', privateToken])
    assert.equal(remote.status, 2)
    assert.match(remote.stderr, /refused_target|loopback/)

    const missingToken = await runCli(['--install', fixture.installRoot, '--out', join(root, 'out-c'), '--readiness', 'http://127.0.0.1:9'])
    assert.equal(missingToken.status, 2)
    assert.match(missingToken.stderr, /token-file|token-env/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('support is referenced, never auto-run over a database, and can be collected on an empty own root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-mc-support-'))
  const fixture = buildTinyInstall(root)
  try {
    const bundle = join(root, 'support.json')
    writeFileSync(bundle, JSON.stringify({ protocol: 'pa-support/1', generatedAt: '2026-01-01T00:00:00.000Z', productSchema: 18, roots: {}, secretExtra: 'drop-me' }), { mode: 0o600 })
    const out = join(root, 'out')
    const run = await runCli(['--install', fixture.installRoot, '--out', out, '--support', bundle])
    assert.equal(run.status, 1, run.stderr)
    const value = report(out)
    assert.ok(ids(value, 'PASS').includes('support.reference'))
    assert.ok(!readFileSync(join(out, 'diagnostics-bundle.json'), 'utf8').includes('drop-me'), 'non-whitelisted support fields are dropped')

    const outRun = join(root, 'out-run')
    const runSupport = await runCli(['--install', fixture.installRoot, '--out', outRun, '--run-support'])
    assert.equal(runSupport.status, 1, runSupport.stderr)
    assert.ok(ids(report(outRun), 'PASS').includes('support.collected'))
    assert.equal(statSync(join(outRun, 'package-support.json')).mode & 0o777, 0o600)

    // A database under the own data root blocks automatic support collection.
    const outDb = join(root, 'out-db')
    const runDb = await runCli(['--install', fixture.installRoot, '--out', outDb])
    assert.equal(runDb.status, 1)
    writeFileSync(join(outDb, 'roots', 'data', 'state.sqlite'), 'not-a-real-db', { mode: 0o600 })
    const second = await runCli(['--install', fixture.installRoot, '--out', outDb])
    assert.equal(second.status, 2)
    assert.match(second.stderr, /output_exists/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
