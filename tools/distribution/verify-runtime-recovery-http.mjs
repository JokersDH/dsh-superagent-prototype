#!/usr/bin/env node
/**
 * D6/D8: consume main697efdc actual runtime recovery inspect/prepare over a personal instance.
 *
 * The instance is a fresh personal discussion-only state (no restore marker, no fixture). Inspect
 * must answer a real recovery-inspection with commitAvailable=false; prepare must refuse a normal
 * non-restored instance with an explicit code instead of granting anything. Zero model turns.
 */
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { install: { type: 'string' }, json: { type: 'boolean', default: false } } })
const root = mkdtempSync(join(tmpdir(), 'pa-recovery-http-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave15-runtime-recovery-http/1', status: 'FAIL', startedAt: new Date().toISOString(), steps: [], limitations: [
  'A normal personal instance is not a restored read-only state, so prepare is expected to refuse; this does not test activation.',
  'The repository checkout is used only as the prepare source path; no model/native work is dispatched.',
] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 400)}\n`) }
const run = (cli, args) => { const result = spawnSync(cli, args, { encoding: 'utf8', timeout: 180_000 }); let json = null; try { json = JSON.parse(result.stdout) } catch {} return { status: result.status, json } }
const freePort = () => new Promise((r) => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => r(port)) }) })
const waitHealth = async (port, timeoutMs = 60_000) => { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { try { const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(800) }); if (res.ok) return await res.json() } catch {} await new Promise((r) => setTimeout(r, 200)) } return null }
let child = null
try {
  if (values.install === undefined) throw new Error('--install is required')
  const install = resolve(values.install)
  const cli = join(install, 'bin/pa')
  const manifest = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8'))
  const base = join(root, 'run')
  const roots = Object.fromEntries(['config', 'state', 'cache', 'logs', 'workspace'].map((key) => [key, join(base, key)]))
  for (const path of Object.values(roots)) mkdirSync(path, { recursive: true, mode: 0o700 })
  const argsOf = ['--install', install, '--config-root', roots.config, '--data-root', roots.state, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
  const first = run(cli, ['first-run', '--json', ...argsOf])
  if (!['READY', 'OK'].includes(first.json?.status)) throw new Error(`first-run failed: ${JSON.stringify(first.json).slice(0, 300)}`)
  const consolePort = await freePort(); let apiPort = await freePort(); if (apiPort === consolePort) apiPort = await freePort()
  const outFd = openSync(join(root, 'start.out.log'), 'w', 0o600); const errFd = openSync(join(root, 'start.err.log'), 'w', 0o600)
  child = spawn(cli, ['start', '--discussion-only', '--port', String(consolePort), '--api-port', String(apiPort), ...argsOf], { cwd: install, stdio: ['ignore', outFd, errFd], detached: true })
  child.unref(); closeSync(outFd); closeSync(errFd)
  const health = await waitHealth(apiPort)
  if (health === null) throw new Error(`personal instance did not become healthy: ${readFileSync(join(root, 'start.err.log'), 'utf8').slice(0, 400)}`)
  const token = readFileSync(join(roots.state, 'api.key'), 'utf8').trim()
  const auth = { authorization: `Bearer ${token}` }
  const inspectResponse = await fetch(`http://127.0.0.1:${apiPort}/v1/recovery/inspect`, { headers: auth })
  const inspect = await inspectResponse.json()
  if (inspectResponse.status !== 200 || inspect?.protocol !== 'recovery-inspection/1') throw new Error(`inspect did not answer: ${inspectResponse.status} ${JSON.stringify(inspect).slice(0, 300)}`)
  if (inspect.commitAvailable !== false) throw new Error('inspect advertised commit availability')
  if (inspect.productSchema !== manifest.producer.productSchema) throw new Error(`inspect schema ${inspect.productSchema} != install ${manifest.producer.productSchema}`)
  const logical = inspect.logicalSource
  if (logical === undefined || !['complete', 'bounded', 'unsupported'].includes(logical.coverage) || (logical.coverage === 'complete') !== (typeof logical.fingerprint === 'string'))
    throw new Error(`inspect logicalSource is incoherent: ${JSON.stringify(logical)}`)
  step('actual-inspect-http', 'PASS', { state: inspect.state, productSchema: inspect.productSchema, commitAvailable: inspect.commitAvailable, logicalCoverage: logical.coverage, projects: inspect.projects.length })

  const prepareResponse = await fetch(`http://127.0.0.1:${apiPort}/v1/recovery/prepare`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedFingerprint: inspect.inspectionFingerprint, bindings: [{ sourceProjectId: inspect.projects[0].id,
      project: { path: dirname(fileURLToPath(import.meta.url)), check: 'node_test' } }] }) })
  const prepare = await prepareResponse.json()
  const code = prepare?.error?.code ?? prepare?.blockers?.map((entry) => entry.code) ?? null
  if (prepareResponse.status === 200) throw new Error('prepare returned a plan for a normal non-restored instance')
  step('actual-prepare-refused', 'PASS', { httpStatus: prepareResponse.status, code })

  const stop = run(cli, ['stop', '--json', ...argsOf])
  if (stop.json?.status !== 'STOPPED') throw new Error(`stop failed: ${JSON.stringify(stop.json).slice(0, 200)}`)
  child = null
  step('stop', 'PASS', { status: stop.json.status })
  evidence.status = 'PASS'
  evidence.build = { buildId: manifest.buildId, commit: manifest.source.commit, schema: manifest.producer.productSchema }
} catch (error) {
  evidence.status = 'FAIL'; evidence.error = String(error?.stack ?? error)
} finally {
  if (child !== null) { try { process.kill(-child.pid, 'SIGTERM') } catch {} }
  evidence.finishedAt = new Date().toISOString()
  rmSync(root, { recursive: true, force: true })
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
