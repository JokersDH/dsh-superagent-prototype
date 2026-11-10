#!/usr/bin/env node
/**
 * Minimal reproduction for main (recovery composition + restored project bindings).
 *
 * A state restored from a bundle can contain `native-projects.json`. Main's
 * `--startup-mode recovery_readonly` composition loads that registry into the fixture project list,
 * and `createProductRuntime` then throws `Controlled fixture projects require the fixed src/
 * scratch grant` because the restored project scope is `.` rather than the controlled `src/` grant.
 * The daemon exits before serving read-only history, so a restored state with project bindings
 * cannot even be opened read-only.
 *
 * This probe uses only a temporary state directory, a controlled/no-model startup and no user
 * services. Owner: main (coordinator recovery composition). D does not patch that code.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { ProductStore } from '../../packages/storage/dist/index.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'pa-repro-recovery-projects-'))
const evidence = { status: 'FAIL', case: 'RECOVERY-PROJECT-BINDINGS', createdAt: new Date().toISOString(), modelCalls: 0 }
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

async function probe({ withProjects }) {
  const state = join(root, withProjects ? 'with-projects' : 'without-projects')
  mkdirSync(state, { recursive: true, mode: 0o700 })
  const store = new ProductStore({ path: join(state, 'state.sqlite') })
  store.close()
  writeFileSync(join(state, 'restore-report.json'), '{"protocol":"personal-restore/1"}\n', { mode: 0o600 })
  if (withProjects) {
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
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok) {
        health = await response.json()
        break
      }
    } catch {
      /* not ready yet */
    }
    if (child.exitCode !== null || child.signalCode !== null) break
    await wait(50)
  }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    await wait(1000)
  }
  return {
    withProjects,
    health,
    startupMode: health?.startupMode ?? null,
    exit: child.exitCode,
    signal: child.signalCode,
    controlledFixtureGrantError: /Controlled fixture projects require the fixed src\/ scratch grant/.test(logs),
    logs: logs.split('\n').filter(Boolean).slice(-12),
  }
}

try {
  const withoutProjects = await probe({ withProjects: false })
  const withProjects = await probe({ withProjects: true })
  evidence.withoutProjects = withoutProjects
  evidence.withProjects = withProjects
  evidence.reproduced = withoutProjects.startupMode === 'recovery_readonly' &&
    withProjects.startupMode === null &&
    withProjects.exit !== 0 &&
    withProjects.controlledFixtureGrantError
  evidence.status = evidence.reproduced ? 'REPRODUCED' : 'NOT_REPRODUCED'
  evidence.owner = 'main'
  evidence.affectedScope = 'A restored state that carries project bindings cannot be opened even read-only; restore+rebind cannot be consumed until recovery composition accepts restored project scopes (or ignores bindings in read-only mode).'
  evidence.note = 'D does not patch coordinator recovery composition; smoke proves recovery for states without project bindings and proves offline rebinding separately.'
  evidence.limitations = [
    'Temporary state only; no user services, credentials, native tasks or model calls were used.',
    'darwin/arm64 + Node 24.21.x measured candidate only.',
  ]
} catch (error) {
  evidence.status = 'PROBE_ERROR'
  evidence.error = String(error?.stack ?? error)
} finally {
  rmSync(root, { recursive: true, force: true })
}

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'REPRODUCED' ? 0 : 1
