#!/usr/bin/env node
/**
 * D8: ordinary personal cold start when no admitted Codex/executor interface is available.
 *
 * Main M1 owns the no-executor/discussion-only behavior. D proves the installer does not silently
 * select the controlled fixture: the instance mode stays personal, the public configuration reports
 * execution unavailable or dispatch disabled, and a dispatch attempt is refused with an explicit
 * code. Zero model/native turns are started.
 *
 * usage: verify-personal-no-executor.mjs --install <frozen install> [--json]
 */
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { install: { type: 'string' }, json: { type: 'boolean', default: false } } })
const root = mkdtempSync(join(tmpdir(), 'pa-personal-noexec-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave14-personal-no-executor/1', status: 'FAIL', startedAt: new Date().toISOString(), steps: [], limitations: [
  'The empty HOME/PATH removes Codex discovery; this is the no-executor input, not a native/profile reset.',
  'Only a loopback fixture-free personal instance on isolated roots is started; no model request is made.',
] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 400)}\n`) }
const run = (cli, args, env) => {
  const result = spawnSync(cli, args, { encoding: 'utf8', timeout: 180_000, env })
  let json = null; try { json = JSON.parse(result.stdout) } catch { /* not json */ }
  return { status: result.status, json, stdout: result.stdout, stderr: result.stderr }
}
const freePort = () => new Promise((r) => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => r(port)) }) })
const waitHealth = async (port, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { try { const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(800) }); if (res.ok) return await res.json() } catch { /* not ready */ } await new Promise((r) => setTimeout(r, 200)) }
  return null
}
const started = new Set()
try {
  if (values.install === undefined) throw new Error('--install is required')
  const install = resolve(values.install)
  const cli = join(install, 'bin/pa')
  const manifest = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8'))
  const emptyHome = join(root, 'empty-home'); mkdirSync(emptyHome, { mode: 0o700 })
  const base = join(root, 'run')
  const roots = Object.fromEntries(['config', 'state', 'cache', 'logs', 'workspace'].map((key) => [key, join(base, key)]))
  for (const path of Object.values(roots)) mkdirSync(path, { recursive: true, mode: 0o700 })
  const argsOf = ['--install', install, '--config-root', roots.config, '--data-root', roots.state, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
  const env = { ...process.env, HOME: emptyHome, PATH: `${dirnameOf(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, XDG_CONFIG_HOME: join(emptyHome, '.config'), XDG_DATA_HOME: join(emptyHome, '.local/share'), CODEX_HOME: join(emptyHome, '.codex') }
  const first = run(cli, ['first-run', '--json', ...argsOf], env)
  if (!['READY', 'OK'].includes(first.json?.status)) throw new Error(`first-run failed: ${JSON.stringify(first.json).slice(0, 300)}`)
  const consolePort = await freePort(); let apiPort = await freePort(); if (apiPort === consolePort) apiPort = await freePort()
  const outFd = openSync(join(root, 'start.out.log'), 'w', 0o600); const errFd = openSync(join(root, 'start.err.log'), 'w', 0o600)
  const child = spawn(cli, ['start', '--discussion-only', '--port', String(consolePort), '--api-port', String(apiPort), ...argsOf], { cwd: install, env, stdio: ['ignore', outFd, errFd], detached: true })
  child.unref(); closeSync(outFd); closeSync(errFd); started.add(child.pid)
  const health = await waitHealth(apiPort)
  if (health === null) throw new Error(`personal no-executor start did not become healthy: ${readFileSync(join(root, 'start.err.log'), 'utf8').slice(0, 400)}`)
  if (health.mode !== 'personal') throw new Error(`installer did not start personal mode: ${health.mode}`)
  const record = JSON.parse(readFileSync(join(roots.config, 'instance.json'), 'utf8'))
  if (record.mode !== 'personal') throw new Error(`instance record is not personal: ${record.mode}`)
  step('personal-not-fixture', 'PASS', { healthMode: health.mode, recordMode: record.mode, buildId: record.buildId })

  const token = readFileSync(join(roots.state, 'api.key'), 'utf8').trim()
  const configuration = await (await fetch(`http://127.0.0.1:${apiPort}/v1/configuration`, { headers: { authorization: `Bearer ${token}` } })).json()
  const unavailable = configuration?.executionAvailability?.state !== 'available'
  const dispatchDisabled = Array.isArray(configuration?.projects) && configuration.projects.some((project) => project.dispatchAllowed === false)
  if (!unavailable && !dispatchDisabled) throw new Error(`no-executor configuration still advertises available execution: ${JSON.stringify(configuration?.executionAvailability)}`)
  step('execution-degraded-explicit', 'PASS', { executionAvailability: configuration.executionAvailability ?? null, anyDispatchDisabled: dispatchDisabled })

  const dispatch = await fetch(`http://127.0.0.1:${apiPort}/v1/assistant/context/prepare`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ commandId: 'wave14-no-executor', text: 'bounded refusal probe', context: { projectId: configuration.projects?.[0]?.id ?? 'project-personal-dialogue', conversationId: 'wave14-conversation', selections: ['conversation'], budget: { maxFiles: 8, maxBytes: 16384, maxTokens: 4096 } } }),
  })
  const body = await dispatch.json()
  if (dispatch.status === 200) throw new Error('a dispatch was accepted without an admitted executor')
  step('dispatch-refused', 'PASS', { httpStatus: dispatch.status, code: body?.error?.code ?? null })

  const stop = run(cli, ['stop', '--json', ...argsOf], env)
  if (stop.json?.status !== 'STOPPED') throw new Error(`stop failed: ${JSON.stringify(stop.json).slice(0, 300)}`)
  started.delete(child.pid)
  step('cold-stop', 'PASS', { status: stop.json.status })
  evidence.status = 'PASS'
  evidence.build = { buildId: manifest.buildId, commit: manifest.source.commit, schema: manifest.producer.productSchema, dirty: manifest.source.dirty }
} catch (error) {
  evidence.status = 'FAIL'; evidence.error = String(error?.stack ?? error)
} finally {
  for (const pid of started) { try { process.kill(pid, 'SIGTERM') } catch { /* gone */ } }
  evidence.finishedAt = new Date().toISOString()
  rmSync(root, { recursive: true, force: true })
}
function dirnameOf(path) { return join(path, '..') }
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
