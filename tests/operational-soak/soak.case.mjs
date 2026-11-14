/**
 * Operational-soak controls: short positive runs, every bounded defect mode, an interrupt, output
 * privacy and resume material. Long 600 s/1800 s runs are executed separately and indexed in
 * reports/trial-operations; they are not part of this fast suite.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const REPO = join(import.meta.dirname, '..', '..')
const CLI = join(REPO, 'tools/trial-kit/bin/trial-soak.mjs')

function run(args, { signalAfterMs = null } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    if (signalAfterMs !== null) setTimeout(() => child.kill('SIGTERM'), signalAfterMs)
    child.on('close', (code, signal) => resolvePromise({ status: code, signal, stdout, stderr }))
  })
}

function runReport(out) { return JSON.parse(readFileSync(join(out, 'run.json'), 'utf8')) }

test('positive mixed scenario completes with bounded work and clean shutdown', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-soak-ok-'))
  const out = join(root, 'out')
  try {
    const result = await run(['--scenario', 'mixed', '--duration-seconds', '5', '--poll-ms', '400', '--sse-interval-ms', '400',
      '--reopen-seconds', '2', '--sample-ms', '400', '--out', out])
    assert.equal(result.status, 0, result.stderr)
    const reportValue = runReport(out)
    assert.equal(reportValue.status, 'COMPLETED')
    assert.equal(reportValue.stoppedBy, 'duration')
    assert.ok(reportValue.wallElapsedSeconds >= 4, `actual duration must be recorded: ${reportValue.wallElapsedSeconds}`)
    assert.equal(reportValue.failures.total, 0)
    assert.equal(reportValue.cleanup.activeSockets, 0)
    assert.equal(reportValue.cleanup.activeConnections, 0)
    assert.ok(reportValue.counters.pollRequests >= 5)
    assert.ok(reportValue.counters.sseEvents >= 5)
    assert.ok(reportValue.counters.samples >= 3)
    assert.ok(reportValue.samples.sha256.length === 64)
    assert.ok(reportValue.resume.arguments.join(' ').includes('--duration-seconds 5'))
    assert.match(readFileSync(join(out, 'resume.txt'), 'utf8'), /trial-soak/)
    assert.equal(statSync(join(out, 'run.json')).mode & 0o777, 0o600)
    assert.equal(statSync(join(out, 'samples.ndjson')).mode & 0o777, 0o600)
    assert.ok(reportValue.unknowns.length >= 3, 'unobservable dimensions stay explicit unknowns')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('http-only and sse-only scenarios limit themselves to their channels', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-soak-channels-'))
  try {
    const httpOut = join(root, 'http')
    const http = await run(['--scenario', 'http', '--duration-seconds', '3', '--poll-ms', '300', '--sample-ms', '500', '--out', httpOut])
    assert.equal(http.status, 0, http.stderr)
    const httpReport = runReport(httpOut)
    assert.equal(httpReport.counters.sseConnections, 0)
    assert.equal(httpReport.counters.reopens, 0)

    const sseOut = join(root, 'sse')
    const sse = await run(['--scenario', 'sse', '--duration-seconds', '3', '--sse-interval-ms', '300', '--reopen-seconds', '1', '--sample-ms', '500', '--out', sseOut])
    assert.equal(sse.status, 0, sse.stderr)
    const sseReport = runReport(sseOut)
    assert.equal(sseReport.counters.pollRequests, 0)
    assert.ok(sseReport.counters.sseConnections >= 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('bounded defect modes are observed and reported, not hidden', async () => {
  const modes = ['truncate', 'duplicate', 'unauthorized', 'bad_json', 'oversized', 'unknown_field', 'slow']
  const root = mkdtempSync(join(tmpdir(), 'trial-soak-defects-'))
  try {
    for (const mode of modes) {
      const out = join(root, mode)
      const result = await run(['--scenario', 'mixed', '--duration-seconds', '3', '--poll-ms', '300', '--poll-timeout-ms', '150',
        '--sse-interval-ms', '300', '--reconnect-backoff-ms', '100', '--reopen-seconds', '0', '--sample-ms', '500',
        '--max-errors', '20', '--failure-mode', mode, '--out', out])
      assert.equal(result.status, 0, `${mode}: ${result.stderr}`)
      const reportValue = runReport(out)
      assert.equal(reportValue.status, 'COMPLETED_WITH_OBSERVED_DEFECT', mode)
      assert.equal(reportValue.scenario.defectObserved, true, mode)
      assert.ok(reportValue.failures.total > 0, mode)
      assert.equal(reportValue.cleanup.activeSockets, 0, `${mode} must release fixture sockets`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an interrupted run reports its actual duration and never claims completion', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-soak-interrupt-'))
  const out = join(root, 'out')
  try {
    const result = await run(['--scenario', 'mixed', '--duration-seconds', '10', '--poll-ms', '400', '--sse-interval-ms', '400', '--reopen-seconds', '0', '--sample-ms', '400', '--out', out], { signalAfterMs: 1200 })
    assert.equal(result.status, 1)
    const reportValue = runReport(out)
    assert.equal(reportValue.status, 'INTERRUPTED')
    assert.equal(reportValue.stoppedBy, 'signal')
    assert.ok(reportValue.wallElapsedSeconds >= 1 && reportValue.wallElapsedSeconds < 8, `actual ${reportValue.wallElapsedSeconds}`)
    assert.ok(reportValue.requestedDurationSeconds === 10)
    assert.equal(reportValue.cleanup.activeSockets, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('invalid bounds and an existing output root are refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-soak-usage-'))
  try {
    const tooLong = await run(['--duration-seconds', '9999', '--out', join(root, 'a')])
    assert.equal(tooLong.status, 2)
    const badScenario = await run(['--scenario', 'everything', '--out', join(root, 'b')])
    assert.equal(badScenario.status, 2)
    const first = await run(['--duration-seconds', '1', '--sample-ms', '500', '--poll-ms', '300', '--out', join(root, 'c')])
    assert.equal(first.status, 0)
    const second = await run(['--duration-seconds', '1', '--out', join(root, 'c')])
    assert.equal(second.status, 2)
    assert.match(second.stderr, /output_exists/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('raw run material is re-checkable and tampering is detected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-soak-verify-'))
  const out = join(root, 'run')
  try {
    const created = await run(['--duration-seconds', '2', '--poll-ms', '300', '--sse-interval-ms', '300', '--reopen-seconds', '0', '--sample-ms', '400', '--out', out])
    assert.equal(created.status, 0, created.stderr)
    const verifyCli = join(REPO, 'tools/trial-kit/bin/trial-verify-run.mjs')
    const ok = await new Promise((resolvePromise) => {
      const child = spawn(process.execPath, [verifyCli, '--run', out, '--out', join(root, 'check')])
      let stdout = ''
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.on('close', (code) => resolvePromise({ code, stdout }))
    })
    assert.equal(ok.code, 0, ok.stdout)
    assert.match(ok.stdout, /CONSISTENT/)

    const samples = join(out, 'samples.ndjson')
    const lines = readFileSync(samples, 'utf8').split('\n').filter(Boolean)
    writeFileSync(samples, `${lines.slice(0, -1).join('\n')}\n`)
    const tampered = await new Promise((resolvePromise) => {
      const child = spawn(process.execPath, [verifyCli, '--run', out])
      let stdout = ''
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.on('close', (code) => resolvePromise({ code, stdout }))
    })
    assert.equal(tampered.code, 1)
    assert.match(tampered.stdout, /INCONSISTENT|sample_digest_mismatch/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
