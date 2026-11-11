#!/usr/bin/env node
/**
 * D4 recipe: ordinary personal installation slice from the current source.
 *
 * Zero-model: it starts the real product in personal mode but dispatches no work, so no model turn
 * is sent. It covers cold start/doctor, personal identity, relocation, backup and readonly restore.
 * Managed upgrade/rollback and cross-schema refusal live in smoke-binary-upgrade.mjs.
 *
 * usage: verify-personal-install.mjs [--install <staged install>] [--json]
 */
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { install: { type: 'string' }, json: { type: 'boolean', default: false } } })
const repo = resolve(new URL('../..', import.meta.url).pathname)
const root = mkdtempSync(join(tmpdir(), 'pa-personal-install-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave10-personal-install/1', status: 'FAIL', startedAt: new Date().toISOString(), steps: [], limitations: [
  'Zero model turns: personal mode is started but no work is dispatched.',
  'Cross-schema refusal and same-schema rollback are measured by the managed matrix, not duplicated here.',
] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 300)}\n`) }
const run = (cli, args, options = {}) => {
  const result = spawnSync(cli, args, { encoding: 'utf8', timeout: options.timeout ?? 300_000, env: { ...process.env, ...(options.env ?? {}) } })
  let json = null
  try { json = JSON.parse(result.stdout) } catch { /* not json */ }
  return { status: result.status, json, stdout: result.stdout, stderr: result.stderr }
}
const freePort = () => new Promise((resolvePort) => {
  const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolvePort(port)) })
})
const waitHealth = async (port, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(800) }); if (response.ok) return await response.json() } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  return null
}
const waitFor = async (fn, timeoutMs = 30_000) => { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 150)) } return null }
const roots = { config: join(root, 'config'), data: join(root, 'state'), cache: join(root, 'cache'), logs: join(root, 'logs'), workspace: join(root, 'workspace') }
const rootArgs = (prefix) => ['--config-root', roots.config, '--data-root', roots.data, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace].map((value, index) => index % 2 === 1 ? value : value)
const stateArgs = ['--config-root', roots.config, '--data-root', roots.data, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
const startedPids = new Set()
try {
  let install = values.install
  if (install === undefined) {
    install = join(root, 'install')
    mkdirSync(join(root, 'build-config'), { mode: 0o700 })
    const built = run(process.execPath, [join(repo, 'tools/distribution/build.mjs'), '--install-root', repo, '--config-root', join(root, 'build-config'), '--output', install, '--json'])
    if (built.status !== 0 || !existsSync(join(install, 'install.json'))) throw new Error(`build failed: ${built.stderr.slice(0, 400)}`)
  }
  const cli = join(install, 'bin', 'pa')
  const manifest = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8'))
  step('source-identity', 'PASS', { buildId: manifest.buildId, commit: manifest.source.commit, schema: manifest.producer.productSchema, dirty: manifest.source?.dirty ?? null })

  const firstRun = run(cli, ['first-run', '--json', ...stateArgs])
  if (!['READY', 'OK'].includes(firstRun.json?.status)) throw new Error(`first-run did not become ready: ${JSON.stringify(firstRun.json).slice(0, 300)}`)
  step('cold-first-run', 'PASS', { status: firstRun.json.status })

  const doctor = run(cli, ['doctor', '--json', ...stateArgs])
  const check = (id) => doctor.json?.checks?.find((entry) => entry.id === id)
  for (const id of ['release_manifest', 'runtime_abi', 'console_mode', 'runtime_dependencies']) if (check(id)?.status !== 'PASS') throw new Error(`doctor ${id} is ${check(id)?.status}`)
  step('doctor-gates', 'PASS', { doctor: doctor.json.status, review_executor: check('review_executor')?.status ?? null })

  // Personal mode with no work: real product start, identity must say personal, no model turn.
  const consolePort = await freePort()
  let apiPort = await freePort()
  if (apiPort === consolePort) apiPort = await freePort()
  const outFd = openSync(join(root, 'personal.out.log'), 'w', 0o600)
  const errFd = openSync(join(root, 'personal.err.log'), 'w', 0o600)
  const child = spawn(cli, ['start', '--port', String(consolePort), '--api-port', String(apiPort), ...stateArgs], { cwd: install, stdio: ['ignore', outFd, errFd], detached: true })
  child.unref(); closeSync(outFd); closeSync(errFd); startedPids.add(child.pid)
  const health = await waitHealth(apiPort)
  if (health === null) throw new Error('personal instance did not become healthy')
  if (health.mode !== 'personal') throw new Error(`personal start reported mode ${health.mode}`)
  const status = await waitFor(() => {
    const current = run(cli, ['status', '--json', ...stateArgs])
    return current.json?.instance?.mode === 'personal' ? current.json : null
  })
  if (status === null) throw new Error('personal instance record missing')
  if (status.instance.access !== 'local-development') throw new Error(`unexpected access ${status.instance.access}`)
  step('personal-start-zero-turn', 'PASS', { mode: health.mode, access: status.instance.access, buildId: status.instance.buildId, startupMode: status.instance.startupMode })

  const backupPath = join(root, 'personal.pab')
  const backup = run(cli, ['backup', '--json', '--out', backupPath, ...stateArgs])
  if (backup.json?.status !== 'CREATED') throw new Error(`backup failed: ${JSON.stringify(backup.json).slice(0, 200)}`)
  step('backup', 'PASS', { sha256: backup.json.archiveSha256, evidenceDigest: backup.json.evidence?.digest ?? null })

  // Stop before restore; restore goes into a new directory and never overwrites the active state.
  const stopped = run(cli, ['stop', '--json', ...stateArgs])
  if (stopped.json?.status !== 'STOPPED') throw new Error('personal instance did not stop')
  startedPids.delete(child.pid)
  const restoredDir = join(root, 'restored-state')
  mkdirSync(restoredDir, { mode: 0o700 })
  const restored = run(cli, ['restore', '--json', '--bundle', backupPath, '--to', restoredDir, ...stateArgs])
  if (restored.json?.ok !== true && restored.json?.status !== 'RESTORED') throw new Error(`restore failed: ${JSON.stringify(restored.json).slice(0, 300)}`)
  const restoredEvidence = restored.json.evidence?.digest ?? restored.json.report?.evidence?.digest ?? null
  const backupEvidence = backup.json.evidence?.digest ?? null
  if (restoredEvidence !== backupEvidence) throw new Error(`restored evidence ${restoredEvidence} != backup evidence ${backupEvidence}`)
  step('restore-readonly-fresh-root', 'PASS', { backupEvidence, restoredEvidence, target: restoredDir })

  // Relocation: the same frozen install answers doctor and a cold start from another path.
  const relocated = join(root, 'relocated-install')
  cpSync(install, relocated, { recursive: true, verbatimSymlinks: true })
  const relocatedCli = join(relocated, 'bin', 'pa')
  const relocatedConfig = join(root, 'relocated-config')
  mkdirSync(relocatedConfig, { mode: 0o700 })
  const relocatedArgs = ['--config-root', relocatedConfig, '--data-root', join(root, 'relocated-state'), '--cache-root', join(root, 'relocated-cache'), '--logs-root', join(root, 'relocated-logs'), '--workspace-root', join(root, 'relocated-workspace')]
  const relocatedFirst = run(relocatedCli, ['first-run', '--json', ...relocatedArgs])
  if (!['READY', 'OK'].includes(relocatedFirst.json?.status)) throw new Error(`relocated first-run failed: ${JSON.stringify(relocatedFirst.json).slice(0, 300)} ${relocatedFirst.stderr.slice(0, 300)}`)
  const relocatedDoctor = run(relocatedCli, ['doctor', '--json', ...relocatedArgs])
  if (relocatedDoctor.json?.checks?.some((entry) => entry.status === 'FAIL')) throw new Error('relocated doctor reported FAIL')
  const relocationConsole = await freePort()
  let relocationApi = await freePort()
  if (relocationApi === relocationConsole) relocationApi = await freePort()
  const relOut = openSync(join(root, 'relocated.out.log'), 'w', 0o600)
  const relErr = openSync(join(root, 'relocated.err.log'), 'w', 0o600)
  const relocatedChild = spawn(relocatedCli, ['start', '--fixture', '--port', String(relocationConsole), '--api-port', String(relocationApi), ...relocatedArgs], { cwd: relocated, stdio: ['ignore', relOut, relErr], detached: true })
  relocatedChild.unref(); closeSync(relOut); closeSync(relErr); startedPids.add(relocatedChild.pid)
  const relocatedHealth = await waitHealth(relocationApi)
  if (relocatedHealth === null) throw new Error('relocated instance did not become healthy')
  const relocatedStop = run(relocatedCli, ['stop', '--json', ...relocatedArgs])
  if (relocatedStop.json?.status !== 'STOPPED') throw new Error('relocated instance did not stop')
  startedPids.delete(relocatedChild.pid)
  step('relocated-install', 'PASS', { doctor: relocatedDoctor.json.status, health: relocatedHealth.status, mode: relocatedHealth.mode })

  evidence.status = 'PASS'
  evidence.artifact = { install, buildId: manifest.buildId, commit: manifest.source.commit, schema: manifest.producer.productSchema, dirty: manifest.source.dirty }
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = String(error?.stack ?? error)
} finally {
  // Only clean processes this recipe spawned; never touch a user instance.
  for (const pid of startedPids) { try { process.kill(pid, 'SIGTERM') } catch { /* gone */ } }
  try { run(join(values.install ?? join(root, 'install'), 'bin', 'pa'), ['stop', '--json', ...stateArgs], { timeout: 20_000 }) } catch { /* best effort */ }
  evidence.finishedAt = new Date().toISOString()
  rmSync(root, { recursive: true, force: true })
}
if (values.json === true) process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
else { for (const entry of evidence.steps) process.stderr.write(`${entry.status} ${entry.id}\n`); process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`) }
process.exitCode = evidence.status === 'PASS' ? 0 : 1
