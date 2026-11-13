#!/usr/bin/env node
/**
 * D4/D6: current main personal HTTP surface on an owned discussion-only instance.
 *
 * Reads the real assistant provider status, current reply-candidate route, and the private
 * suggestions preference (default off). Writes only the private `.assistant-settings.json`; the
 * legacy model JSON is byte-identical before/after. No model/native turn is sent.
 */
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { install: { type: 'string' }, json: { type: 'boolean', default: false } } })
const root = mkdtempSync(join(tmpdir(), 'pa-current-personal-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave16-current-personal-http/1', status: 'FAIL', steps: [], limitations: [
  'No model request is sent; candidate/preferences wiring is read/written locally only.',
  'A nonempty suggestion body requires an actual returned request and is NOT_TESTED here.',
] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 300)}\n`) }
const run = (cli, args) => { const r = spawnSync(cli, args, { encoding: 'utf8', timeout: 180_000 }); let json = null; try { json = JSON.parse(r.stdout) } catch {} return { status: r.status, json } }
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => r(port)) }) })
const waitHealth = async (port, ms = 60_000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(700) }); if (res.ok) return await res.json() } catch {} await new Promise((r) => setTimeout(r, 200)) } return null }
let daemon = null
try {
  if (values.install === undefined) throw new Error('--install is required')
  const install = resolve(values.install)
  const cli = join(install, 'bin/pa')
  const manifest = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8'))
  const base = join(root, 'run')
  const roots = Object.fromEntries(['config', 'state', 'cache', 'logs', 'workspace'].map((k) => [k, join(base, k)]))
  for (const p of Object.values(roots)) mkdirSync(p, { recursive: true, mode: 0o700 })
  const argsOf = ['--install', install, '--config-root', roots.config, '--data-root', roots.state, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
  // A private legacy model configuration (default suggestions off). The recipe never contacts its URL.
  const modelPath = join(roots.config, 'model.json')
  writeFileSync(modelPath, JSON.stringify({ baseURL: 'https://fixture.invalid/v1', apiKey: 'wave16-fixture-key', model: 'fixture-model', allowedModels: ['fixture-model'], allowInsecureHttp: false }), { mode: 0o600 })
  const env = { ...process.env, PA_MODEL_CONFIG: modelPath }
  const first = run(cli, ['first-run', '--json', ...argsOf])
  if (!['READY', 'OK'].includes(first.json?.status)) throw new Error(`first-run failed: ${JSON.stringify(first.json).slice(0, 250)}`)
  const consolePort = await freePort(); let apiPort = await freePort(); if (apiPort === consolePort) apiPort = await freePort()
  const outFd = openSync(join(root, 'start.out.log'), 'w', 0o600); const errFd = openSync(join(root, 'start.err.log'), 'w', 0o600)
  daemon = spawn(cli, ['start', '--discussion-only', '--port', String(consolePort), '--api-port', String(apiPort), ...argsOf], { cwd: install, env, stdio: ['ignore', outFd, errFd], detached: true })
  daemon.unref(); closeSync(outFd); closeSync(errFd)
  const health = await waitHealth(apiPort)
  if (health === null) throw new Error(`instance not healthy: ${readFileSync(join(root, 'start.err.log'), 'utf8').slice(0, 300)}`)
  const token = readFileSync(join(roots.state, 'api.key'), 'utf8').trim()
  const auth = { authorization: `Bearer ${token}` }
  const get = async (path) => { const res = await fetch(`http://127.0.0.1:${apiPort}${path}`, { headers: auth }); return { status: res.status, body: await res.json() } }
  const provider = await get('/v1/assistant')
  if (provider.status !== 200) throw new Error(`provider status ${provider.status}`)
  if (provider.body.suggestionsEnabled === true) throw new Error('legacy model configuration unexpectedly enabled suggestions by default')
  step('provider-default-off', 'PASS', { configured: provider.body.configured, suggestionsEnabled: provider.body.suggestionsEnabled ?? false })

  const candidates = await get('/v1/messages/wave16-no-such-message/candidates')
  if (candidates.status === 501 || candidates.body?.error?.code === 'unsupported_capability')
    throw new Error('reply candidate route is not connected in current main')
  step('candidate-route-actual', 'PASS', { httpStatus: candidates.status, code: candidates.body?.error?.code ?? null })

  const settingsPath = `${modelPath}.assistant-settings.json`
  const legacyBefore = readFileSync(modelPath)
  const on = await fetch(`http://127.0.0.1:${apiPort}/v1/assistant/suggestions`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) })
  const onBody = await on.json()
  if (on.status !== 200 || onBody.suggestionsEnabled !== true) throw new Error(`enabling suggestions failed: ${on.status} ${JSON.stringify(onBody).slice(0, 250)}`)
  if (!existsSync(settingsPath)) throw new Error('private assistant-settings.json was not written')
  const mode = statSync(settingsPath).mode & 0o777; if (mode !== 0o600) throw new Error(`assistant settings mode ${mode.toString(8)} is not 0600`)
  const legacyAfter = readFileSync(modelPath)
  if (legacyBefore !== null && legacyAfter !== null && !legacyBefore.equals(legacyAfter)) throw new Error('legacy model JSON was modified by a preference write')
  const off = await fetch(`http://127.0.0.1:${apiPort}/v1/assistant/suggestions`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) })
  const offBody = await off.json()
  if (off.status !== 200 || offBody.suggestionsEnabled !== false) throw new Error('disabling suggestions failed')
  step('private-preference-roundtrip', 'PASS', { defaultOff: true, enabled: true, disabled: false, settingsMode: '0600', legacyModelUnchanged: legacyBefore === null || legacyAfter === null || legacyBefore.equals(legacyAfter) })

  const stop = run(cli, ['stop', '--json', ...argsOf])
  if (stop.json?.status !== 'STOPPED') throw new Error(`stop failed: ${JSON.stringify(stop.json).slice(0, 200)}`)
  daemon = null
  step('stop', 'PASS', { status: stop.json.status })
  evidence.status = 'PASS'
  evidence.build = { buildId: manifest.buildId, commit: manifest.source.commit, schema: manifest.producer.productSchema }
} catch (error) { evidence.status = 'FAIL'; evidence.error = String(error?.stack ?? error) }
finally {
  if (daemon !== null) { try { process.kill(-daemon.pid, 'SIGTERM') } catch {} }
  rmSync(root, { recursive: true, force: true })
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
