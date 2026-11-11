#!/usr/bin/env node
/**
 * Wave-06 D5: upgrade / rollback path across two frozen install builds of the same source.
 *
 * Two staged installs are produced from one checkout: build A and build B with an explicit build tag
 * (the tag only changes build identity, not product behavior). A normal fixture state is created with
 * public storage APIs (project settings + work + completed patch artifact), started with A, backed
 * up, started with B (upgrade), mutated with a new project-settings revision, then rolled back to the
 * pre-upgrade bundle and started with B again. The original work/artifact/settings must survive and the
 * post-upgrade revision must disappear; the backup evidence digest must match after rollback.
 *
 * Local temp roots/ports only; no user service, native executor or model call.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { readEvidenceSummary } from '../../packages/portability/dist/index.js'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PA = join(REPO_ROOT, 'apps/launcher/bin/pa.mjs')
const BUILD = join(REPO_ROOT, 'tools/distribution/build.mjs')
const results = []
const step = (id, status, detail) => results.push({ id, status, ...(detail === undefined ? {} : { detail }) })

const freePort = () => new Promise((resolve, reject) => {
  const socket = createServer()
  socket.once('error', reject)
  socket.listen(0, '127.0.0.1', () => {
    const { port } = socket.address()
    socket.close(() => resolve(port))
  })
})

const root = mkdtempSync(join(tmpdir(), 'pa-wave06-upgrade-'))
const evidence = { case: 'WAVE06-UPGRADE-ROLLBACK', status: 'FAIL', startedAt: new Date().toISOString(), steps: results }
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 300000, ...options })
  if (options.allowExit !== undefined && !options.allowExit.includes(result.status))
    throw new Error(`${command} ${args.slice(0, 3).join(' ')} exit ${result.status}\n${result.stdout}\n${result.stderr}`)
  return result
}
const pa = (args, options = {}) => {
  const result = run(process.execPath, [PA, ...args], options)
  let json = null
  try { json = JSON.parse(result.stdout) } catch { json = null }
  return { ...result, json }
}
const roots = (name) => ({
  config: join(root, name, 'config'), data: join(root, name, 'data'), cache: join(root, name, 'cache'),
  logs: join(root, name, 'logs'), workspaces: join(root, name, 'workspaces'),
})
const stateArgs = (target) => ['--config-root', target.config, '--data-root', target.data, '--cache-root', target.cache, '--logs-root', target.logs, '--workspace-root', target.workspaces]
const installArgs = (installDir, target) => ['--install', join(installDir, 'app'), ...stateArgs(target)]
const serviceArgs = (target) => ['--port', String(target.consolePort), '--api-port', String(target.apiPort), ...installArgs(target.installDir, target)]

function seedState(stateDir) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const store = new ProductStore({ path: join(stateDir, 'state.sqlite') })
  try {
    const now = new Date().toISOString()
    store.workflows.projects.append({ projectId: 'project-upgrade', expectedRevision: 0, settings: { pathDigest: 'a'.repeat(64), check: 'node_test', sourceRef: 'upgrade-fixture' }, createdAt: now })
    store.product.works.insert({ id: 'work-upgrade', projectId: 'project-upgrade', conversationId: 'conv-upgrade', title: 'upgrade work', createdAt: now })
    const artifact = store.artifacts.write(Buffer.from('pre-upgrade patch bytes\n'))
    store.artifacts.insert(artifact)
    return { artifactId: artifact.id, artifactDigest: artifact.digest }
  } finally {
    store.close()
  }
}

try {
  const installA = join(root, 'install-a')
  const installB = join(root, 'install-b')
  const configA = join(root, 'build-config-a')
  const configB = join(root, 'build-config-b')
  const buildA = run(process.execPath, [BUILD, '--install-root', REPO_ROOT, '--config-root', configA, '--output', installA, '--json'], { allowExit: [0] })
  const summaryA = JSON.parse(buildA.stdout)
  const buildB = run(process.execPath, [BUILD, '--install-root', REPO_ROOT, '--config-root', configB, '--output', installB, '--tag', 'wave06-upgrade-sim', '--json'], { allowExit: [0] })
  const summaryB = JSON.parse(buildB.stdout)
  if (summaryA.buildId === summaryB.buildId) throw new Error('two install builds did not produce distinct build identities')
  step('two-build-identities', 'PASS', { buildA: summaryA.buildId, buildB: summaryB.buildId })

  const baseTarget = roots('upgrade')
  const targetA = { ...baseTarget, config: configA }
  const targetB = { ...baseTarget, config: configB }
  const seeded = seedState(baseTarget.data)
  const before = readEvidenceSummary(join(baseTarget.data, 'state.sqlite'))
  for (const [installDir, target] of [[installA, targetA], [installB, targetB]]) {
    const firstRun = pa(['first-run', '--json', ...installArgs(installDir, target)], { allowExit: [0] })
    if (firstRun.json?.status !== 'OK') throw new Error('first-run failed for the upgrade roots')
  }

  // Start/stop helper through a child process so the running launcher does not block this script.
  const startStop = async (installDir, label, target) => {
    const consolePort = await freePort()
    let apiPort = await freePort()
    if (apiPort === consolePort) apiPort = await freePort()
    const out = join(root, `start-${label}.out.log`)
    const err = join(root, `start-${label}.err.log`)
    const outFd = openSync(out, 'w', 0o600)
    const errFd = openSync(err, 'w', 0o600)
    const child = spawn(process.execPath, [PA, 'start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort), ...installArgs(installDir, target)], { cwd: REPO_ROOT, stdio: ['ignore', outFd, errFd] })
    const deadline = Date.now() + 60000
    let health = null
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${apiPort}/v1/health`, { signal: AbortSignal.timeout(500) })
        if (response.ok) { health = await response.json(); break }
      } catch { /* not ready */ }
      if (child.exitCode !== null) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (health === null) {
      const tail = (() => { try { return `${readFileSync(out, 'utf8').slice(-2000)}\n${readFileSync(err, 'utf8').slice(-2000)}` } catch { return 'no logs' } })()
      throw new Error(`instance from ${label} did not become healthy; exit=${child.exitCode}\n${tail}`)
    }
    closeSync(outFd)
    closeSync(errFd)
    const stop = pa(['stop', '--json', ...installArgs(installDir, target)], { allowExit: [0] })
    if (stop.json?.status !== 'STOPPED') throw new Error(`instance from ${label} did not stop cleanly`)
    await new Promise((resolve) => child.once('exit', resolve))
    return { health, consolePort, apiPort }
  }

  const startA = await startStop(installA, 'a', targetA)
  step('start-build-a', 'PASS', { health: startA.health.status })
  const backup = pa(['backup', '--json', '--out', join(root, 'pre-upgrade.pab'), ...installArgs(installA, targetA)], { allowExit: [0] })
  if (backup.json?.status !== 'CREATED') throw new Error('pre-upgrade backup failed')
  if (backup.json.evidence?.digest !== before.digest) throw new Error('pre-upgrade backup evidence digest does not match the live state')
  step('backup-pre-upgrade', 'PASS', { digest: backup.json.evidence.digest, counts: backup.json.evidence.counts })

  await startStop(installB, 'b-upgrade', targetB)
  step('start-build-b-upgrade', 'PASS', {})

  // New data created after the upgrade must disappear on rollback.
  const store = new ProductStore({ path: join(baseTarget.data, 'state.sqlite') })
  try {
    store.workflows.projects.append({ projectId: 'project-upgrade', expectedRevision: 1, settings: { pathDigest: 'b'.repeat(64), check: 'node_test', sourceRef: 'post-upgrade-change' } })
  } finally {
    store.close()
  }
  const changed = readEvidenceSummary(join(baseTarget.data, 'state.sqlite'))
  if (changed.digest === before.digest) throw new Error('post-upgrade data did not change the evidence digest')

  const rollback = pa(['rollback', '--json', '--bundle', join(root, 'pre-upgrade.pab'), '--target', baseTarget.data, ...installArgs(installB, targetB)], { allowExit: [0] })
  if (rollback.json?.status !== 'ROLLED_BACK') throw new Error('rollback did not report ROLLED_BACK')
  const after = readEvidenceSummary(join(baseTarget.data, 'state.sqlite'))
  if (after.digest !== before.digest) throw new Error('rolled-back evidence does not match the pre-upgrade state')
  if (after.projects[0]?.revision !== 1) throw new Error('rollback kept the post-upgrade project revision')
  if (after.works[0]?.id !== 'work-upgrade') throw new Error('rollback lost the pre-upgrade work')
  if (after.artifacts[0]?.digest !== seeded.artifactDigest) throw new Error('rollback lost the pre-upgrade artifact')
  step('rollback-restores-pre-upgrade-state', 'PASS', { digest: after.digest, projectRevision: after.projects[0].revision, artifactDigest: after.artifacts[0].digest })

  await startStop(installB, 'b-after-rollback', targetB)
  step('start-build-b-after-rollback', 'PASS', {})
  evidence.status = 'PASS'
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = String(error?.stack ?? error)
} finally {
  evidence.finishedAt = new Date().toISOString()
  evidence.limitations = [
    'Two builds of the same source with an explicit build tag; this is an upgrade/rollback data-path proof, not a cross-version migration matrix or a new-protocol platform.',
    'darwin/arm64 + Node 24.21.x measured only; no user service, native executor or model call.',
    'Rollback restores the state snapshot; it does not downgrade the installed binaries.',
  ]
  rmSync(root, { recursive: true, force: true })
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
