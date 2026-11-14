import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
// @ts-expect-error - the driver primitive module is plain JavaScript.
import { DriverError, REQUIRED_PACKAGE_CHECKS, applyCleanupOutcome, httpJson, logSink, remaining, stopChild, validatePackageIdentity, waitUntil } from '../../context/tools/driver-lib.mjs'

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

async function serve(handler: (socket: import('node:net').Socket) => void): Promise<{ url: string; close(): Promise<void> }> {
  const sockets = new Set<import('node:net').Socket>()
  const server = createServer((socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); handler(socket) })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((done) => {
    for (const socket of sockets) socket.destroy()
    server.close(() => done())
  }) }
}

test('a connected but silent peer is cancelled by the per-request budget', async () => {
  const peer = await serve(() => undefined)
  try {
    const started = Date.now()
    await assert.rejects(
      httpJson(`${peer.url}/v1/health`, {}, { perRequestMs: 200, deadlineAt: Date.now() + 5000 }),
      (error: { code?: string }) => error.code === 'request_timeout',
    )
    assert.ok(Date.now() - started < 2000)
  } finally { await peer.close() }
})

test('a half JSON body is an invalid response, not an empty success', async () => {
  const peer = await serve((socket) => {
    socket.end('HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 5\r\n\r\n{"a":')
  })
  try {
    await assert.rejects(httpJson(`${peer.url}/x`, {}, { perRequestMs: 2000, deadlineAt: Date.now() + 5000 }),
      (error: { code?: string }) => error.code === 'invalid_json')
  } finally { await peer.close() }
})

test('readiness fails immediately on an entry that already exited and on deadline', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(3)'], { stdio: 'ignore' })
  await sleep(100)
  const logs = logSink(64)
  await assert.rejects(waitUntil(() => true, { deadlineAt: Date.now() + 5000, child, logs }),
    (error: { code?: string; detail?: { exitCode?: number } }) => error.code === 'entry_exited' && error.detail?.exitCode === 3)
  const started = Date.now()
  await assert.rejects(waitUntil(() => false, { deadlineAt: Date.now() + 300 }), (error: { code?: string }) => error.code === 'readiness_timeout')
  assert.ok(Date.now() - started < 1500)
})

test('bounded logs keep only the tail and an elapsed deadline is rejected', () => {
  const logs = logSink(100)
  logs.push('x'.repeat(500))
  assert.equal(logs.value.length, 100)
  assert.equal(logs.value, 'x'.repeat(100))
  assert.throws(() => remaining(Date.now() - 1, 1000), (error: { code?: string }) => error.code === 'deadline_exceeded')
})

test('cleanup escalates exactly once and leaves no owned child behind', async () => {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});process.stdout.write("ready");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'ignore'] })
  await new Promise<void>((done) => child.stdout!.once('data', () => done()))
  assert.ok(child.pid)
  const result = await stopChild(child, { graceMs: 300, killMs: 2000 })
  assert.deepEqual(result, { stopped: true, escalated: true })
  assert.equal(child.exitCode === null || child.signalCode !== null, true)
  assert.throws(() => process.kill(child.pid!, 0))
})

test('an HTTP error status is returned for the caller to assert instead of being treated as data', async () => {
  const peer = await serve((socket) => {
    socket.end('HTTP/1.1 422 Unprocessable Entity\r\ncontent-type: application/json\r\ncontent-length: 2\r\n\r\n{}')
  })
  try {
    const response = await httpJson(`${peer.url}/x`, {}, { perRequestMs: 2000, deadlineAt: Date.now() + 5000 })
    assert.equal(response.status, 422)
    assert.deepEqual(response.json, {})
  } finally { await peer.close() }
  const error = new DriverError('usage', 'x') as { code?: string }
  assert.equal(error.code, 'usage')
  await sleep(1)
})

test('an owned stop failure downgrades verified success while reuse and keep stay explicit', () => {
  const verified = { status: 'verified-flow', verified: true, cleanup: { attempted: true, owned: true, stopped: true, detail: 'pa-stop-verified' } }
  assert.equal(applyCleanupOutcome(verified).status, 'verified-flow')
  const failedStop = applyCleanupOutcome({ status: 'verified-flow', verified: true,
    cleanup: { attempted: true, owned: true, stopped: false, detail: 'pa-stop-unverified', error: { code: 'cleanup_failed' } } })
  assert.equal(failedStop.status, 'failed')
  assert.equal(failedStop.verified, false)
  assert.equal(failedStop.failure.code, 'cleanup_failed')
  const reused = applyCleanupOutcome({ status: 'reused', verified: true, cleanup: { attempted: true, owned: false, stopped: false, detail: 'reused-left-running' } })
  assert.equal(reused.status, 'reused')
  const kept = applyCleanupOutcome({ status: 'verified-flow', verified: true, cleanup: { attempted: true, owned: true, stopped: false, detail: 'kept-running' } })
  assert.equal(kept.status, 'verified-flow')
  const noCleanup = applyCleanupOutcome({ status: 'observed', verified: false, cleanup: { attempted: true, owned: true, stopped: false, detail: 'x' } })
  assert.equal(noCleanup.status, 'observed')
})

test('package identity requires every launcher/API field and check with no optional shortcut', () => {
  const checks = REQUIRED_PACKAGE_CHECKS.map((id: string) => ({ id, ok: true }))
  const instance = { pid: 10, processStart: 'start', apiPid: 11, apiProcessStart: 'api-start', state: '/state', install: '/install',
    configRoot: '/config', mode: 'personal', startupMode: 'recovery_readonly', apiURL: 'http://127.0.0.1:5000',
    apiArgv: ['node', 'pa.mjs', 'start', '--review-restored-scope', '/review.json'],
    launcherArgv: ['node', 'pa.mjs', 'start'] }
  const expected = { instance, checks, expectedState: '/state', expectedInstall: '/install', expectedConfigRoot: '/config',
    expectedReview: '/review.json', expectedApiPort: 5000 }
  assert.deepEqual(validatePackageIdentity(expected), { ok: true, missing: [], mismatches: [] })
  for (const field of ['pid', 'apiPid', 'processStart', 'apiProcessStart']) {
    const copy = structuredClone(instance) as Record<string, unknown>; delete copy[field]
    const result = validatePackageIdentity({ ...expected, instance: copy })
    assert.equal(result.ok, false, field)
    assert.ok(result.missing.includes(field), field)
  }
  const noChecks = validatePackageIdentity({ ...expected, checks: [] })
  assert.equal(noChecks.ok, false)
  assert.ok(noChecks.missing.includes('check:launcher_alive'))
  const partialChecks = validatePackageIdentity({ ...expected, checks: checks.filter((check: { id: string }) => check.id !== 'api_process_start') })
  assert.equal(partialChecks.ok, false)
  assert.ok(partialChecks.missing.includes('check:api_process_start'))
  for (const [label, patch, key] of [
    ['processStart', { processStart: 'other' }, 'check:process_start'],
    ['apiProcessStart', { apiProcessStart: 'other' }, 'check:api_process_start'],
    ['state', { state: '/other-state' }, 'state'],
    ['install', { install: '/other-install' }, 'install'],
    ['configRoot', { configRoot: '/other-config' }, 'configRoot'],
    ['argv', { apiArgv: ['node', 'pa.mjs', 'start'], launcherArgv: ['node', 'pa.mjs', 'start'] }, 'reviewArgv'],
  ] as const) {
    const copy = { ...instance, ...patch }
    const mutatedChecks = checks.map((check: { id: string; ok: boolean }) =>
      (label === 'processStart' && check.id === 'process_start') || (label === 'apiProcessStart' && check.id === 'api_process_start')
        ? { ...check, ok: false } : check)
    const result = validatePackageIdentity({ ...expected, instance: copy, checks: mutatedChecks })
    assert.equal(result.ok, false, label)
    assert.ok(result.missing.includes(key) || result.mismatches.includes(key), label)
  }
  const wrongStart = validatePackageIdentity({ ...expected, checks: checks.map((check: { id: string; ok: boolean }) => check.id === 'api_process_start' ? { ...check, ok: false } : check) })
  assert.equal(wrongStart.ok, false)
  assert.ok(wrongStart.mismatches.includes('check:api_process_start'))
})
