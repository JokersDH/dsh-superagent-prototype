#!/usr/bin/env node
/**
 * D2: one install, two independent states. Every generic command binds its requested
 * install/config/data roots to the recorded instance; a cross-state request refuses without
 * signalling the other state, deleting its record or moving anything.
 *
 * usage: verify-multi-instance.mjs [--install <staged install>] [--json]
 */
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { install: { type: 'string' }, json: { type: 'boolean', default: false } } })
const repo = resolve(new URL('../..', import.meta.url).pathname)
const root = mkdtempSync(join(tmpdir(), 'pa-multi-instance-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave11-multi-instance/1', status: 'FAIL', startedAt: new Date().toISOString(), steps: [], limitations: [
  'Uses one frozen/staged install and isolated temporary states; no user instance, shared queue or marker is touched.',
  'Only processes spawned by this recipe and recorded in its own states are ever stopped.',
] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 400)}\n`) }
const run = (cli, args, timeout = 120_000) => {
  const result = spawnSync(cli, args, { encoding: 'utf8', timeout })
  let json = null
  try { json = JSON.parse(result.stdout) } catch { /* not json */ }
  return { status: result.status, signal: result.signal, json, stdout: result.stdout, stderr: result.stderr }
}
const freePort = () => new Promise((resolvePort) => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolvePort(port)) }) })
const waitHealth = async (port, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(800) }); if (response.ok) return await response.json() } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  return null
}
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }
const makeRoots = (name, install) => {
  const base = join(root, name)
  const roots = { install, config: join(base, 'config'), data: join(base, 'state'), cache: join(base, 'cache'), logs: join(base, 'logs'), workspace: join(base, 'workspace') }
  for (const path of [roots.config, roots.data, roots.cache, roots.logs, roots.workspace]) mkdirSync(path, { recursive: true, mode: 0o700 })
  return roots
}
const args = (roots, extra = []) => [...extra, '--config-root', roots.config, '--data-root', roots.data, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
const started = new Set()
const spawnStart = async (cli, roots, name) => {
  const consolePort = await freePort()
  let apiPort = await freePort()
  if (apiPort === consolePort) apiPort = await freePort()
  const outFd = openSync(join(root, `${name}.out.log`), 'w', 0o600)
  const errFd = openSync(join(root, `${name}.err.log`), 'w', 0o600)
  const child = spawn(cli, ['start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort), ...args(roots)], { cwd: roots.install, stdio: ['ignore', outFd, errFd], detached: true })
  child.unref(); closeSync(outFd); closeSync(errFd); started.add(child.pid)
  const health = await waitHealth(apiPort)
  if (health === null) throw new Error(`${name} did not become healthy`)
  const deadline = Date.now() + 30_000
  let record = readJson(join(roots.config, 'instance.json'))
  while (record === null && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150))
    record = readJson(join(roots.config, 'instance.json'))
  }
  if (record === null) throw new Error(`${name} did not record its instance`)
  return { child, record, health, consolePort, apiPort }
}
try {
  let install = values.install
  if (install === undefined) {
    install = join(root, 'install')
    mkdirSync(join(root, 'build-config'), { mode: 0o700 })
    const built = run(process.execPath, [join(repo, 'tools/distribution/build.mjs'), '--install-root', repo, '--config-root', join(root, 'build-config'), '--output', install, '--json'], 600_000)
    if (built.status !== 0) throw new Error(`build failed: ${built.stderr.slice(0, 300)}`)
  }
  const cli = join(install, 'bin', 'pa')
  const manifest = readJson(join(install, 'install.json'))
  step('install-identity', 'PASS', { buildId: manifest.buildId, commit: manifest.source.commit, schema: manifest.producer.productSchema, dirty: manifest.source.dirty })

  const rootsA = makeRoots('state-a', install)
  const rootsB = makeRoots('state-b', install)
  for (const roots of [rootsA, rootsB]) {
    const first = run(cli, ['first-run', '--json', ...args(roots)])
    if (!['READY', 'OK'].includes(first.json?.status)) throw new Error(`first-run failed: ${JSON.stringify(first.json).slice(0, 200)}`)
  }
  const a = await spawnStart(cli, rootsA, 'a')
  const b = await spawnStart(cli, rootsB, 'b')
  if (a.record.pid === b.record.pid) throw new Error('two states shared a launcher pid')
  step('two-states-running', 'PASS', { a: { pid: a.record.pid, apiPid: a.record.apiPid, state: a.record.state }, b: { pid: b.record.pid, apiPid: b.record.apiPid, state: b.record.state } })

  const bBefore = { record: readJson(join(rootsB.config, 'instance.json')), health: await fetch(`http://127.0.0.1:${b.apiPort}/v1/health`).then((r) => r.json()) }
  const crossStop = run(cli, ['stop', '--json', '--config-root', rootsA.config, '--data-root', rootsB.data, '--cache-root', rootsA.cache, '--logs-root', rootsA.logs, '--workspace-root', rootsA.workspace])
  if (crossStop.json?.code !== 'requested_root_mismatch') throw new Error(`cross-state stop was not refused: ${JSON.stringify(crossStop.json).slice(0, 300)}`)
  const aAliveAfterCross = alive(a.record.pid)
  const crossStatus = run(cli, ['status', '--json', '--config-root', rootsA.config, '--data-root', rootsB.data, '--cache-root', rootsA.cache, '--logs-root', rootsA.logs, '--workspace-root', rootsA.workspace])
  if (crossStatus.json?.code !== 'requested_root_mismatch') throw new Error(`cross-state status was not refused: ${JSON.stringify(crossStatus.json).slice(0, 300)}`)
  const bAfter = { record: readJson(join(rootsB.config, 'instance.json')), health: await fetch(`http://127.0.0.1:${b.apiPort}/v1/health`).then((r) => r.json()) }
  if (!aAliveAfterCross) throw new Error('cross-state stop killed the recorded state A launcher')
  if (JSON.stringify(bBefore.record) !== JSON.stringify(bAfter.record) || bAfter.health?.status !== 'ok')
    throw new Error('cross-state request changed state B record or health')
  step('cross-state-stop-status-refused', 'PASS', {
    code: crossStop.json.code, requestedState: rootsB.data, recordedState: a.record.state,
    aAlive: aAliveAfterCross, bRecordUnchanged: true, bHealthUnchanged: bAfter.health.status,
  })

  const stopA = run(cli, ['stop', '--json', ...args(rootsA)])
  if (stopA.json?.status !== 'STOPPED') throw new Error('matching stop A failed')
  if (alive(b.record.pid) !== true) throw new Error('stopping state A stopped state B')
  step('matching-stop-only-own-state', 'PASS', { stopped: stopA.json.status, bStillAlive: alive(b.record.pid) })

  // launcher dead / API alive, requested for the other state
  const a2 = await spawnStart(cli, rootsA, 'a2')
  process.kill(a2.record.pid, 'SIGKILL')
  await new Promise((r) => setTimeout(r, 400))
  const orphanCross = run(cli, ['stop', '--json', '--config-root', rootsA.config, '--data-root', rootsB.data, '--cache-root', rootsA.cache, '--logs-root', rootsA.logs, '--workspace-root', rootsA.workspace])
  if (orphanCross.json?.code !== 'requested_root_mismatch') throw new Error(`orphan cross-state stop was not refused: ${JSON.stringify(orphanCross.json).slice(0, 300)}`)
  if (!alive(a2.record.apiPid)) throw new Error('cross-state orphan stop killed the API child')
  const apiAliveAfterCross = alive(a2.record.apiPid)
  const orphanStop = run(cli, ['stop', '--json', ...args(rootsA)])
  if (orphanStop.json?.status !== 'STOPPED_ORPHAN') throw new Error(`matching orphan stop was not proven: ${JSON.stringify(orphanStop.json).slice(0, 300)}`)
  step('orphan-api-cross-state', 'PASS', { crossCode: orphanCross.json.code, apiAliveAfterCross, matching: orphanStop.json.status })

  // stale record + PID reuse/start mismatch + missing record
  const a3 = await spawnStart(cli, rootsA, 'a3')
  process.kill(a3.record.pid, 'SIGKILL'); try { process.kill(a3.record.apiPid, 'SIGKILL') } catch { /* gone */ }
  await new Promise((r) => setTimeout(r, 400))
  const stale = run(cli, ['stop', '--json', ...args(rootsA)])
  if (!['STALE_RECORD_CLEANED', 'STOPPED'].includes(stale.json?.status)) throw new Error(`stale record was not cleaned: ${JSON.stringify(stale.json).slice(0, 300)}`)
  const missing = run(cli, ['stop', '--json', ...args(rootsA)])
  if (missing.json?.status !== 'STOPPED') throw new Error('missing record stop did not report STOPPED')
  step('stale-and-missing-record', 'PASS', { stale: stale.json.status, missing: missing.json.status })

  const stranger = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  try {
    const a4 = await spawnStart(cli, rootsA, 'a4')
    run(cli, ['stop', '--json', ...args(rootsA)])
    const recordPath = join(rootsA.config, 'instance.json')
    const baseRecord = a4.record
    mkdirSync(rootsA.config, { recursive: true, mode: 0o700 })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(recordPath, JSON.stringify({ ...baseRecord, pid: stranger.pid, apiPid: stranger.pid, consolePid: stranger.pid, processStart: 'different-start' }), { mode: 0o600 })
    const reused = run(cli, ['stop', '--json', ...args(rootsA)])
    if (reused.json?.code !== 'instance_identity_mismatch' && reused.json?.code !== 'unknown_live_resource')
      throw new Error(`reused pid was not refused: ${JSON.stringify(reused.json).slice(0, 300)}`)
    if (!alive(stranger.pid)) throw new Error('a reused/foreign pid was signalled')
    step('pid-reuse-refused', 'PASS', { code: reused.json.code, strangerAlive: true })
    run(cli, ['stop', '--json', ...args(rootsA)])
  } finally { try { stranger.kill('SIGKILL') } catch { /* gone */ } }

  // empty/space/CJK paths, same install
  const cjkRoot = join(root, '空 格 dir')
  mkdirSync(cjkRoot, { recursive: true, mode: 0o700 })
  const rootsC = makeRoots(join('空 格 dir', 'state-c'), install)
  const cjkFirst = run(cli, ['first-run', '--json', ...args(rootsC)])
  if (!['READY', 'OK'].includes(cjkFirst.json?.status)) throw new Error(`CJK first-run failed: ${JSON.stringify(cjkFirst.json).slice(0, 200)}`)
  const c = await spawnStart(cli, rootsC, 'c')
  const cjkStatus = run(cli, ['status', '--json', ...args(rootsC)])
  if (cjkStatus.json?.status !== 'RUNNING') throw new Error(`CJK status did not report RUNNING: ${JSON.stringify(cjkStatus.json).slice(0, 400)}`)
  const cjkStop = run(cli, ['stop', '--json', ...args(rootsC)])
  if (cjkStop.json?.status !== 'STOPPED') throw new Error('CJK stop failed')
  step('space-cjk-paths', 'PASS', { state: rootsC.data, health: c.health.status, status: cjkStatus.json.status, stopped: cjkStop.json.status })

  const stopB = run(cli, ['stop', '--json', ...args(rootsB)])
  if (stopB.json?.status !== 'STOPPED') throw new Error('final stop B failed')
  evidence.status = 'PASS'
  evidence.artifact = { install, buildId: manifest.buildId, commit: manifest.source.commit, schema: manifest.producer.productSchema }
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = String(error?.stack ?? error)
} finally {
  for (const pid of started) { try { process.kill(pid, 'SIGTERM') } catch { /* gone */ } }
  evidence.finishedAt = new Date().toISOString()
  rmSync(root, { recursive: true, force: true })
}
if (values.json === true) process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
else process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
