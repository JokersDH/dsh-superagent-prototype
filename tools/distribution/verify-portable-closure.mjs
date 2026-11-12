#!/usr/bin/env node
/**
 * D5: relocatable runtime closure. Copy the staged install to a path with spaces/CJK, run it with
 * an empty HOME/cwd outside the author checkout, and prove doctor/start/support use only declared
 * stage bytes (no source checkout, no user node_modules, no global upgrade).
 *
 * usage: verify-portable-closure.mjs [--install <staged install>] [--json]
 */
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, closeSync, cpSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { install: { type: 'string' }, json: { type: 'boolean', default: false } } })
const repo = resolve(new URL('../..', import.meta.url).pathname)
const root = mkdtempSync(join(tmpdir(), 'pa-portable-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave11-portable-closure/1', status: 'FAIL', startedAt: new Date().toISOString(), steps: [], limitations: [
  'darwin/arm64 with the current Node/SQLite ABI only; other platforms/ABIs are NOT_TESTED.',
  'The closure is the declared staged install (including its bundled node_modules); the author checkout is not read.',
] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 400)}\n`) }
const run = (cli, args, options = {}) => {
  const result = spawnSync(cli, args, { encoding: 'utf8', timeout: options.timeout ?? 180_000, cwd: options.cwd ?? '/', env: { ...process.env, ...(options.env ?? {}) } })
  let json = null
  try { json = JSON.parse(result.stdout) } catch { /* not json */ }
  return { status: result.status, json, stdout: result.stdout, stderr: result.stderr, error: result.error?.code ?? null }
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
const base = join(root, '隔离 空格 dir')
const rootArgs = (roots) => ['--install', roots.install, '--config-root', roots.config, '--data-root', roots.data, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
const started = new Set()
try {
  let source = values.install
  if (source === undefined) {
    source = join(root, 'built-install'); mkdirSync(join(root, 'build-config'), { mode: 0o700 })
    const built = run(process.execPath, [join(repo, 'tools/distribution/build.mjs'), '--install-root', repo, '--config-root', join(root, 'build-config'), '--output', source, '--json'], { cwd: repo, timeout: 900_000 })
    if (built.status !== 0) throw new Error(`build failed: ${built.stderr.slice(0, 300)}`)
  }
  mkdirSync(base, { recursive: true, mode: 0o700 })
  const install = join(base, 'relocated-install')
  cpSync(source, install, { recursive: true, verbatimSymlinks: true })
  const manifest = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8'))
  const cli = join(install, 'bin', 'pa')
  step('relocated-copy', 'PASS', { install, buildId: manifest.buildId, schema: manifest.producer.productSchema, dirty: manifest.source.dirty, bytes: manifest.files?.bytes ?? null, files: manifest.files?.count ?? null })

  const home = join(base, 'empty-home'); mkdirSync(home, { mode: 0o700 })
  const roots = { install, config: join(base, 'config'), data: join(base, 'state'), cache: join(base, 'cache'), logs: join(base, 'logs'), workspace: join(base, 'workspace') }
  for (const path of [roots.config, roots.data, roots.cache, roots.logs, roots.workspace]) mkdirSync(path, { recursive: true, mode: 0o700 })
  const isolatedEnv = { HOME: home, PATH: `${join(process.execPath, '..')}${delimiter}/usr/bin${delimiter}/bin${delimiter}/usr/sbin${delimiter}/sbin`, NODE_OPTIONS: '' }
  const first = run(cli, ['first-run', '--json', ...rootArgs(roots)], { env: isolatedEnv })
  if (!['READY', 'OK'].includes(first.json?.status)) throw new Error(`relocated first-run failed: ${JSON.stringify(first.json).slice(0, 300)} ${first.stderr.slice(0, 200)}`)
  const doctor = run(cli, ['doctor', '--json', ...rootArgs(roots)], { env: isolatedEnv })
  const failures = (doctor.json?.checks ?? []).filter((check) => check.status === 'FAIL')
  if (failures.length > 0) throw new Error(`relocated doctor reported FAIL: ${JSON.stringify(failures).slice(0, 300)}`)
  step('isolated-doctor', 'PASS', { doctor: doctor.json?.status ?? null, checks: (doctor.json?.checks ?? []).length, home })

  const consolePort = await freePort(); let apiPort = await freePort(); if (apiPort === consolePort) apiPort = await freePort()
  const outFd = openSync(join(base, 'out.log'), 'w', 0o600); const errFd = openSync(join(base, 'err.log'), 'w', 0o600)
  const child = spawn(cli, ['start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort), ...rootArgs(roots)], { cwd: '/', env: { ...process.env, ...isolatedEnv }, stdio: ['ignore', outFd, errFd], detached: true })
  child.unref(); closeSync(outFd); closeSync(errFd); started.add(child.pid)
  const health = await waitHealth(apiPort)
  if (health === null) throw new Error('relocated instance did not become healthy')
  const support = run(cli, ['support', '--json', '--out', join(base, 'support.json'), ...rootArgs(roots)], { env: isolatedEnv })
  if (support.json?.status !== 'CREATED') throw new Error(`support bundle failed: ${JSON.stringify(support.json).slice(0, 300)}`)
  const supportText = readFileSync(join(base, 'support.json'), 'utf8')
  for (const forbidden of [home, roots.config, roots.data, 'launcherArgv']) if (supportText.includes(forbidden)) throw new Error(`support bundle leaked ${forbidden}`)
  const stop = run(cli, ['stop', '--json', ...rootArgs(roots)], { env: isolatedEnv })
  if (stop.json?.status !== 'STOPPED') throw new Error(`relocated instance did not stop: ${JSON.stringify(stop.json).slice(0, 400)}`)
  started.delete(child.pid)
  step('isolated-start-stop-support', 'PASS', { health: health.status, mode: health.mode, supportDigest: support.json.digest.slice(0, 12), stopped: stop.json.status })

  // Explicit failures instead of crashes: a non-private config root and a PATH without node.
  const looseRoots = { ...roots, config: join(base, 'loose-config') }
  mkdirSync(looseRoots.config, { recursive: true }); chmodSync(looseRoots.config, 0o755)
  const looseDoctor = run(cli, ['doctor', '--json', ...rootArgs({ ...roots, config: looseRoots.config })], { env: isolatedEnv })
  const looseCheck = (looseDoctor.json?.checks ?? []).find((check) => check.id === 'roots')
  if (looseCheck?.status !== 'FAIL') throw new Error('a non-private config root was not reported as a FAIL check')
  const looseStart = run(cli, ['start', '--json', '--fixture', ...rootArgs({ ...roots, config: looseRoots.config })], { env: isolatedEnv })
  if (looseStart.json?.ok === true) throw new Error('a non-private config root was started')
  step('unsafe-permissions-explicit', 'PASS', { doctorRoots: looseCheck.status, startCode: looseStart.json?.code ?? null })

  const missingRuntime = spawnSync(cli, ['doctor', '--json', ...rootArgs(roots)], { encoding: 'utf8', timeout: 30_000, cwd: '/', env: { ...process.env, PATH: '/nonexistent', HOME: home } })
  if (missingRuntime.status === 0) throw new Error('doctor succeeded without a Node runtime on PATH')
  const message = `${missingRuntime.stdout}${missingRuntime.stderr}${missingRuntime.error?.message ?? ''}`
  if (message.trim().length === 0) throw new Error('missing runtime produced no explicit diagnostic')
  step('missing-runtime-explicit', 'PASS', { exit: missingRuntime.status, error: missingRuntime.error?.code ?? null, diagnostic: message.trim().split('\n')[0].slice(0, 120) })

  step('other-platform-abi', 'NOT_TESTED', { reason: 'Only darwin/arm64 + current Node/SQLite ABI measured; no cross-platform claim.' })
  evidence.status = 'PASS'
  evidence.artifact = { install, buildId: manifest.buildId, commit: manifest.source.commit, schema: manifest.producer.productSchema, dirty: manifest.source.dirty }
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = String(error?.stack ?? error)
} finally {
  for (const pid of started) { try { process.kill(pid, 'SIGTERM') } catch { /* gone */ } }
  evidence.finishedAt = new Date().toISOString()
  rmSync(root, { recursive: true, force: true })
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
