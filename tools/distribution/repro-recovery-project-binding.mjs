#!/usr/bin/env node
/**
 * Wave-05 D1: restored project bindings under `--startup-mode recovery_readonly`.
 *
 * Wave-04 reported RECOVERY-PROJECT-BINDINGS: main's runtime treated a restored project scope `.`
 * as a controlled `src/` fixture grant and refused to start. main has since preserved the restored
 * project scope in recovery_readonly and disabled start-bound business effects.
 *
 * This probe now asserts the fixed behaviour (not the old error):
 *   - the coordinator starts and reports startupMode=recovery_readonly;
 *   - the restored project is readable through GET /v1/configuration;
 *   - a business POST is rejected (422 unsupported_capability);
 *   - old queued rows, answers and parked verifications are unchanged (no replay/consumption);
 *   - the launcher/CLI does not delete the restore marker.
 *
 * It also checks the same state WITHOUT project bindings as a control. Temporary state only, no
 * user services, no native/model calls.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProductStore } from '../../packages/storage/dist/index.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'pa-repro-recovery-projects-'))
const evidence = {
  case: 'RECOVERY-PROJECT-BINDINGS',
  previousBlocker: 'wave-04 reported a controlled-fixture grant error for restored project scope "."',
  checkedAt: new Date().toISOString(),
  sourceCommit: process.env.PA_SOURCE_COMMIT ?? null,
  status: 'FAIL',
  modelCalls: 0,
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

const queueSnapshot = (state) => {
  const store = new ProductStore({ path: join(state, 'state.sqlite') })
  try {
    const now = Date.now()
    return {
      queued: ['application.execute', 'application.assistant.reply', 'question.answer']
        .flatMap((kind) => store.queue.dueRows(kind, now + 86_400_000, 100).map((row) => ({ kind, key: row.key, seq: row.seq, generation: row.generation, payload: row.payload }))),
      parked: store.queue.parked().map((row) => ({ kind: row.kind, key: row.key, seq: row.seq, reason: row.parkedReason })),
      answers: { answer: store.answers.get('answer-old') ?? null, deliveries: store.answers.deliveries('answer-old') },
    }
  } finally {
    store.close()
  }
}

function createState(state, withProjects) {
  mkdirSync(state, { recursive: true, mode: 0o700 })
  const store = new ProductStore({ path: join(state, 'state.sqlite') })
  try {
    const now = new Date().toISOString()
    store.queue.enqueue('application.execute', 'fixture-begin', JSON.stringify({ kind: 'begin' }), 1, 0, now)
    store.queue.enqueue('application.execute', 'fixture-deliver', JSON.stringify({ kind: 'deliver' }), 2, 0, now)
    store.queue.enqueue('application.assistant.reply', 'fixture-chat', JSON.stringify({ messageId: 'm-old' }), 3, 0, now)
    store.queue.enqueue('question.answer', 'fixture-answer', '{}', 4, 0, now)
    store.queue.enqueue('verification.retry', 'fixture-verify', '{}', 5, 0, now)
    const parked = store.queue.oldestRow('verification.retry')
    store.queue.park('verification.retry', parked.key, parked.seq, parked.generation, 'unknown-native-send', now)
    store.answers.record('answer-old', { questionId: 'question-old', expectedVersion: 1, digest: 'digest-old', answer: { kind: 'choices', optionIds: ['allow'] } })
    store.answers.upsertDelivery('answer-old', 'target-old', 'pending', 'historical')
  } finally {
    store.close()
  }
  writeFileSync(join(state, 'restore-report.json'), '{"protocol":"personal-restore/1","requiresRevalidation":["native environment"]}\n', { mode: 0o600 })
  if (withProjects)
    writeFileSync(
      join(state, 'native-projects.json'),
      JSON.stringify({
        version: 1,
        projects: [{
          id: 'project-restored',
          path: '/tmp/restored-project',
          displayName: 'restored project',
          check: 'node_test',
          environment: { policy: 'offline_install', storeDir: '/tmp/offline-store' },
        }],
      }),
      { mode: 0o600 },
    )
}

async function probe(withProjects) {
  const state = join(root, withProjects ? 'with-projects' : 'without-projects')
  createState(state, withProjects)
  const before = queueSnapshot(state)
  const apiKey = (() => {
    try { return readFileSync(join(state, 'api.key'), 'utf8').trim() } catch { return null }
  })()
  const port = await freePort()
  const child = spawn(
    process.execPath,
    ['apps/coordinator/product/demo.ts', '--state', state, '--port', String(port), '--startup-mode', 'recovery_readonly', '--local-access'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let logs = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { logs += chunk })
  child.stderr.on('data', (chunk) => { logs += chunk })
  let health = null
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok) { health = await response.json(); break }
    } catch { /* not ready */ }
    if (child.exitCode !== null || child.signalCode !== null) break
    await wait(50)
  }
  const result = { withProjects, health, startupMode: health?.startupMode ?? null, projectRead: null, commandStatus: null, commandCode: null, queueUnchanged: null, markerPresent: null, exit: null, logs: [] }
  if (health !== null) {
    const token = apiKey ?? (() => { try { return readFileSync(join(state, 'api.key'), 'utf8').trim() } catch { return null } })()
    const configuration = await fetch(`http://127.0.0.1:${port}/v1/configuration`, {
      headers: { connection: 'close', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    })
    if (configuration.ok) {
      const body = await configuration.json()
      result.projectRead = body.projects?.some((project) => project.id === 'project-restored') ?? false
    } else result.projectRead = `http_${configuration.status}`
    const command = await fetch(`http://127.0.0.1:${port}/v1/commands`, {
      method: 'POST',
      headers: { connection: 'close', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ commandId: 'recovery-project-probe', conversationId: 'conv-main', kind: 'create_work' }),
    })
    result.commandStatus = command.status
    const commandBody = await command.json().catch(() => null)
    result.commandCode = commandBody?.error?.code ?? null
  }
  const after = queueSnapshot(state)
  result.queueUnchanged = JSON.stringify(before) === JSON.stringify(after)
  result.markerPresent = readFileSync(join(state, 'restore-report.json'), 'utf8').includes('personal-restore/1')
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    await wait(1000)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  result.exit = child.exitCode
  result.logs = logs.split('\n').filter(Boolean).slice(-8)
  return result
}

try {
  const withoutProjects = await probe(false)
  const withProjects = await probe(true)
  evidence.withoutProjects = withoutProjects
  evidence.withProjects = withProjects
  const readonly = (probe) => probe.startupMode === 'recovery_readonly' && probe.queueUnchanged === true && probe.markerPresent === true
  evidence.fixed = readonly(withoutProjects) && readonly(withProjects) &&
    withProjects.projectRead === true && withProjects.commandStatus === 422 && withProjects.commandCode === 'unsupported_capability'
  evidence.status = evidence.fixed ? 'PASS_RECOVERY_PROJECT_BINDINGS' : 'FAIL'
  evidence.owner = 'main (fix) / D (probe)'
  evidence.limitations = [
    'Temporary state only; no user services, credentials, native tasks or model calls were used.',
    'darwin/arm64 + Node 24.21.x measured candidate only.',
    'A 422 on the probe command does not prove every business route is rejected; the recovery smoke covers queue/answer/parked non-consumption.',
  ]
  evidence.nextConsumer = [
    'E: use a restored state with project bindings in its installation test; expect read-only start, readable project, rejected business POST, unchanged old business.',
    'main: keep recovery_readonly project-scope preservation and no-start-effects behaviour under test; do not remove the restore marker automatically.',
  ]
} catch (error) {
  evidence.status = 'PROBE_ERROR'
  evidence.error = String(error?.stack ?? error)
} finally {
  rmSync(root, { recursive: true, force: true })
}

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS_RECOVERY_PROJECT_BINDINGS' ? 0 : 1
