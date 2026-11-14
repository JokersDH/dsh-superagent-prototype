import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { buildPersonalChain, projectId, restoreSnapshot } from './helpers/personal-chain.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const driver = join(repoRoot, 'packages/context/tools/personal-review-driver.mjs')
const reviewTool = join(repoRoot, 'tools/dev/review-restored.mjs')
const paEntry = join(repoRoot, 'apps/launcher/bin/pa.mjs')
const workbenchEntry = join(repoRoot, 'tools/dev/workbench.mjs')

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done) => server.close(() => done()))
  return port
}
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))
async function waitGone(read: () => Promise<boolean>, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { try { if (!(await read())) return } catch { return } await sleep(100) }
  throw new Error('resource did not go away in time')
}

interface DriverResult {
  protocol: string; status: string; verified: boolean; mode: string; dialect: string; sourceOnly: boolean; packageSubject: string | null
  entries: Record<'review' | 'start' | 'identity' | 'demo', { path: string; sha256: string | null }>
  review: { file: string; sha256: string; mode: number; startupAvailable: boolean; projects: string[] | null } | null
  health: { mode: string; startupMode: string; restoredReviewDigest: string | null } | null
  identity: { bound: boolean; requestedDigest: string | null; actualHealthDigest: string | null; recordPid: number | null; childPid: number | null; stateRoot: string | null; requestedFile: string | null }
  cleanup: { owned: boolean; attempted: boolean; stopped: boolean; detail: string | null }
  data: {
    history?: { conversationId: string | null; entries: number }
    sources?: { messageId: string; state: string; diagnostic: { reasons: string[]; partial: boolean; withheldSourceCount: number; authorization: string } | null }
    candidate?: { index: number; payloadDigest: string } | { candidates: number; rejected: string | null }
    candidatePrepare?: number
    chat?: number
    work?: { phase: string | null }
    delivery?: { statuses: string[] }
  }
  assertions: { name: string; ok: boolean }[]
  failure?: { code: string; message: string; detail?: unknown }
  capability?: string; code?: string | null; message?: string | null
}

test('the driver asserts a real user flow, binds the actual consumer and rejects every requested mismatch', { timeout: 300000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave23-strict-'))
  const chain = await buildPersonalChain(root)
  const restoredV1 = join(root, 'restored-v1'), restoredV2 = join(root, 'restored-v2'), restoredCorrupt = join(root, 'restored-corrupt')
  restoreSnapshot(chain.v1, restoredV1)
  restoreSnapshot(chain.v2, restoredV2)
  mkdirSync(restoredCorrupt, { recursive: true, mode: 0o700 })
  cpSync(restoredV1, restoredCorrupt, { recursive: true })
  writeFileSync(join(restoredCorrupt, 'restore-report.json'), JSON.stringify({ protocol: 'personal-restore/1', targetPath: restoredCorrupt,
    database: { ...chain.v1.manifest.database }, evidence: { status: 'verified' } }), { mode: 0o600 })
  t.after(async () => { await chain.model.close(); rmSync(root, { recursive: true, force: true }) })

  const run = (state: string, ports: { console: number; api: number }, extra: string[] = []) => {
    const argv = [driver, '--install', repoRoot, '--state', state, '--project', projectId, '--allow-path', 'src/',
      '--console-port', String(ports.console), '--api-port', String(ports.api), '--model-config', chain.model.file, ...extra]
    try {
      const stdout = execFileSync(process.execPath, argv, { encoding: 'utf8', timeout: 240000 })
      return { code: 0, json: JSON.parse(stdout.trim().split('\n').at(-1)!) as DriverResult }
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string }
      const line = String(failure.stdout ?? '').trim().split('\n').at(-1)
      if (!line) throw new Error(`Driver produced no JSON: ${failure.stderr}`)
      return { code: failure.status ?? 1, json: JSON.parse(line) as DriverResult }
    }
  }
  const ports = async () => ({ console: await availablePort(), api: await availablePort() })
  const flowArgs = (format: string) => ['--format', format, '--work', chain.workId, '--question', chain.question.id,
    '--candidate-message', chain.sourceMessageId, '--expect-candidate-digest', chain.reviewedCandidate.payloadDigest]

  // 1. Source dialect, both v1 and v2, through the standard personal entry.
  for (const [state, format] of [[restoredV1, 'v1'], [restoredV2, 'v2']] as const) {
    const result = run(state, await ports(), flowArgs(format))
    assert.equal(result.code, 0)
    assert.equal(result.json.status, 'verified-flow')
    assert.equal(result.json.verified, true)
    assert.equal(result.json.identity.bound, true)
    assert.equal(result.json.identity.recordPid, result.json.identity.childPid)
    assert.equal(result.json.identity.actualHealthDigest, result.json.identity.requestedDigest)
    assert.equal(result.json.cleanup.stopped, true)
    assert.equal(result.json.data.sources?.state, 'verified')
    assert.deepEqual(result.json.data.sources?.diagnostic?.reasons, [])
    assert.equal(result.json.data.chat, 422)
    assert.equal(result.json.data.candidatePrepare, 422)
    assert.equal(result.json.data.work?.phase, 'delivered')
    assert.deepEqual(result.json.data.delivery?.statuses, ['native_applied'])
    assert.equal(result.json.data.candidate && 'payloadDigest' in result.json.data.candidate, true)
    assert.ok(result.json.assertions.length > 0)
    assert.ok(result.json.assertions.every((entry) => entry.ok))
  }

  // 2. Observation mode collects data but is never acceptance.
  const observed = run(restoredV1, await ports(), ['--observe', '--expect-chat', '200'])
  assert.equal(observed.code, 0)
  assert.equal(observed.json.status, 'observed')
  assert.equal(observed.json.verified, false)
  assert.equal(observed.json.data.chat, 422)
  assert.equal(observed.json.assertions.length, 0)

  // 3. Each requested result is asserted; changing one expectation fails with a precise code.
  for (const [label, extra] of [
    ['chat expectation', flowArgs('v1').concat(['--expect-chat', '200'])],
    ['work phase expectation', flowArgs('v1').concat(['--expect-work-phase', 'running'])],
    ['delivery expectation', flowArgs('v1').concat(['--expect-delivery', 'accepted'])],
    ['candidate digest expectation', flowArgs('v1').concat(['--expect-candidate-digest', '0'.repeat(64)])],
    ['missing work id', flowArgs('v1').concat(['--work', 'f'.repeat(32)])],
  ] as const) {
    const result = run(restoredV1, await ports(), [...extra])
    assert.equal(result.code, 1, `${label}: ${JSON.stringify(result.json.failure)}`)
    assert.equal(result.json.status, 'failed', label)
    assert.equal(result.json.verified, false, label)
    assert.equal(result.json.failure?.code, 'assertion_failed', `${label}: ${JSON.stringify(result.json.failure)}`)
  }

  // 4. A ready non-consumer is refused, not accepted by port identity.
  const mockPort = await availablePort()
  const sockets = new Set<import('node:net').Socket>()
  const mock = createServer((socket) => {
    sockets.add(socket); socket.on('error', () => undefined); socket.once('close', () => sockets.delete(socket))
    const body = JSON.stringify({ status: 'ok', mode: 'personal', startupMode: 'recovery_readonly' })
    socket.end(`HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`)
  })
  await new Promise<void>((done) => mock.listen(mockPort, '127.0.0.1', done))
  try {
    const fake = run(restoredV1, { console: await availablePort(), api: mockPort }, ['--start-entry', '/usr/bin/true', '--record', join(root, 'absent-record.json')])
    assert.equal(fake.code, 1)
    assert.equal(fake.json.status, 'failed')
    assert.ok(['entry_exited', 'consumer_not_alive', 'readiness_timeout'].includes(fake.json.failure?.code ?? ''), JSON.stringify(fake.json.failure))
    assert.equal(fake.json.cleanup.owned, true)
    const still = await fetch(`http://127.0.0.1:${mockPort}/v1/health`)
    assert.equal(still.status, 200)
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((done) => mock.close(() => done()))
  }

  // 5. Legitimate reuse keeps the original process; a different selection cannot reuse or bypass it.
  const reusePorts = await ports()
  const keptFile = join(root, 'kept-selection.json')
  execFileSync(process.execPath, [reviewTool, '--state', restoredV1, '--project', projectId, '--allow-path', 'src/', '--output', keptFile], { encoding: 'utf8' })
  let keptChild: ReturnType<typeof spawn> | undefined
  let keptLog = ''
  const stopKept = async () => {
    if (!keptChild || keptChild.exitCode !== null || keptChild.signalCode !== null) return
    const done = once(keptChild, 'exit')
    const timer = setTimeout(() => keptChild!.kill('SIGKILL'), 8000)
    keptChild.kill('SIGTERM')
    try { await done } finally { clearTimeout(timer) }
    keptChild = undefined
  }
  t.after(stopKept)
  keptChild = spawn(process.execPath, [workbenchEntry, '--state', restoredV1, '--port', String(reusePorts.console), '--api-port', String(reusePorts.api),
    '--discussion-only', '--review-restored-scope', keptFile], { cwd: repoRoot, env: { ...process.env, PA_MODEL_CONFIG: chain.model.file }, stdio: ['ignore', 'pipe', 'pipe'] })
  keptChild.stdout!.on('data', (bytes) => { keptLog += bytes })
  keptChild.stderr!.on('data', (bytes) => { keptLog += bytes })
  const reuseApi = `http://127.0.0.1:${reusePorts.api}`
  const deadline = Date.now() + 60000
  for (;;) {
    if (keptChild.exitCode !== null || keptChild.signalCode !== null) throw new Error(`workbench exited: ${keptLog.slice(-2000)}`)
    if (Date.now() > deadline) throw new Error(`workbench did not become ready: ${keptLog.slice(-2000)}`)
    try {
      const health = await fetch(`${reuseApi}/v1/health`)
      const current = existsSync(join(restoredV1, 'workbench.json')) ? JSON.parse(readFileSync(join(restoredV1, 'workbench.json'), 'utf8')) : null
      if (health.ok && current?.pid === keptChild.pid && typeof current.restoredReviewDigest === 'string') break
    } catch { /* retry */ }
    await sleep(50)
  }
  const record = JSON.parse(readFileSync(join(restoredV1, 'workbench.json'), 'utf8')) as { pid: number; restoredReviewDigest: string; apiURL: string }
  const reused = run(restoredV1, reusePorts, ['--review-file', keptFile, '--reuse', '--work', chain.workId, '--question', chain.question.id])
  console.error('W23_REUSED', JSON.stringify({code:reused.code,status:reused.json.status,failure:reused.json.failure,record,reusePorts,identity:reused.json.identity,cleanup:reused.json.cleanup}))
  assert.equal(reused.code, 0)
  assert.equal(reused.json.status, 'reused')
  assert.equal(reused.json.verified, true)
  assert.equal(reused.json.identity.recordPid, record.pid)
  assert.equal(reused.json.cleanup.owned, false)
  assert.equal(reused.json.cleanup.detail, 'reused-left-running')
  const different = join(root, 'different-selection.json')
  execFileSync(process.execPath, [reviewTool, '--state', restoredV1, '--project', projectId, '--allow-path', 'src/narrow/', '--output', different], { encoding: 'utf8' })
  const refused = run(restoredV1, reusePorts, ['--review-file', different, '--expect-entry-refusal', '只读恢复选择与本次请求不同'])
  assert.equal(refused.code, 0)
  assert.equal(refused.json.status, 'refused-verified')
  assert.equal(refused.json.verified, true)
  assert.equal(JSON.parse(readFileSync(join(restoredV1, 'workbench.json'), 'utf8')).pid, record.pid)
  const wrongState = run(restoredV2, await ports(), ['--review-file', keptFile, '--expect-entry-refusal', 'unavailable, stale or belongs to another local state'])
  assert.equal(wrongState.code, 0)
  assert.equal(wrongState.json.status, 'refused-verified')
  assert.equal(wrongState.json.verified, true)
  // Only the probe-born workbench child this test spawned is stopped.
  await stopKept()
  await waitGone(async () => { try { return (await fetch(`${reuseApi}/v1/health`)).ok } catch { return false } })

  // 6. Package dialect: the package review entry is actually used; a missing release is NOT_REACHED, never a checkout fallback.
  const pkg = run(restoredV1, await ports(), ['--dialect', 'package', '--pa-entry', paEntry, '--allow-not-reached'])
  console.error('W24_PKG', JSON.stringify({code:pkg.code,status:pkg.json.status,failure:pkg.json.failure,cleanup:pkg.json.cleanup}))
  assert.equal(pkg.code, 4)
  assert.equal(pkg.json.status, 'NOT_REACHED')
  assert.equal(pkg.json.verified, false)
  assert.equal(pkg.json.dialect, 'package')
  assert.equal(pkg.json.sourceOnly, false)
  assert.equal(pkg.json.entries.review.path, paEntry)
  assert.ok(['release_missing', 'first_run_required', 'runtime_mismatch'].includes(pkg.json.code ?? ''), JSON.stringify(pkg.json))
  assert.equal(pkg.json.review?.mode, 0o600)
  assert.deepEqual(pkg.json.review?.projects, [projectId])

  // 7. An unverified frozen artifact is reported as unverified with no content and no zero-count fabrication.
  const corruptFile = join(root, 'corrupt-wide.json')
  execFileSync(process.execPath, [reviewTool, '--state', restoredCorrupt, '--project', projectId, '--allow-path', 'src/', '--output', corruptFile], { encoding: 'utf8' })
  const artifact = join(restoredCorrupt, 'artifacts', chain.frozenDigest)
  const bytes = readFileSync(artifact)
  bytes[0] = bytes[0]! ^ 0xff
  writeFileSync(artifact, bytes, { mode: statSync(artifact).mode & 0o777 })
  const corrupt = run(restoredCorrupt, await ports(), ['--review-file', corruptFile, '--expect-source-state', 'unverified'])
  assert.equal(corrupt.code, 0)
  assert.equal(corrupt.json.status, 'verified-flow')
  assert.equal(corrupt.json.data.sources?.state, 'unverified')
  assert.equal(corrupt.json.data.sources?.diagnostic?.partial, true)
  assert.equal(corrupt.json.data.sources?.diagnostic?.withheldSourceCount, 0)

  // 8. Contradictory entry overrides are usage errors, never a hidden second consumer.
  for (const [label, extra] of [
    ['source with pa-entry', ['--pa-entry', join(repoRoot, 'apps/launcher/bin/pa.mjs')]],
    ['package with start-entry', ['--dialect', 'package', '--start-entry', join(repoRoot, 'tools/dev/start.mjs')]],
  ] as const) {
    const result = run(restoredV1, await ports(), [...extra])
    assert.equal(result.code, 2, label)
    assert.equal(result.json.status, 'failed', label)
    assert.equal(result.json.failure?.code, 'usage', label)
  }

  // 9. A readiness hang ends at the bounded deadline and stops the owned child.
  const hang = join(root, 'hang.mjs')
  writeFileSync(hang, 'setInterval(()=>{},1000)\n')
  const hangRun = run(restoredV1, await ports(), ['--start-entry', hang, '--readiness-ms', '500', '--deadline-ms', '3000'])
  assert.equal(hangRun.code, 1)
  assert.equal(hangRun.json.failure?.code, 'readiness_timeout')
  assert.equal(hangRun.json.cleanup.stopped, true)
})
