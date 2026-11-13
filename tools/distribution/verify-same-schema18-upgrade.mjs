#!/usr/bin/env node
/**
 * D8: a same-schema (18 -> 18) upgrade between two genuinely different frozen binaries.
 *
 * Both installs are private copies; the pointer/process/mode/schema stay consistent and no data
 * rollback is claimed. This is distinct from the historical schema13 pair and from 16->18.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { chmodSync, cpSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { tmpdir } from 'node:os'

const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' }, json: { type: 'boolean', default: false } } })
const root = mkdtempSync(join(tmpdir(), 'pa-same18-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave16-same-schema18-upgrade/1', status: 'FAIL', steps: [], limitations: ['Fixture mode is used for the managed switch; personal/no-executor behavior is covered separately.'] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 400)}\n`) }
const run = (cli, args, allow = [0]) => { const r = spawnSync(cli, args, { encoding: 'utf8', timeout: 240_000 }); let json = null; try { json = JSON.parse(r.stdout) } catch {} if (!allow.includes(r.status)) throw new Error(`command failed ${r.status} [${args.join(' ')}]: ${r.stdout.slice(0, 500)} ${r.stderr.slice(0, 300)}`); return { status: r.status, json } }
try {
  if (values.from === undefined || values.to === undefined) throw new Error('--from and --to are required')
  const fromSource = resolve(values.from), toSource = resolve(values.to)
  const fromManifest = JSON.parse(readFileSync(join(fromSource, 'install.json'), 'utf8'))
  const toManifest = JSON.parse(readFileSync(join(toSource, 'install.json'), 'utf8'))
  if (fromManifest.producer.productSchema !== 18 || toManifest.producer.productSchema !== 18) throw new Error('both installs must be schema18')
  if (fromManifest.buildId === toManifest.buildId) throw new Error('from/to must be different binaries')
  const from = join(root, 'from-install'), to = join(root, 'to-install')
  cpSync(fromSource, from, { recursive: true }); cpSync(toSource, to, { recursive: true })
  const base = join(root, 'run')
  const roots = Object.fromEntries(['config', 'state', 'cache', 'logs', 'workspace'].map((k) => [k, join(base, k)]))
  for (const p of Object.values(roots)) mkdirSync(p, { recursive: true, mode: 0o700 })
  const argsOf = (install) => ['--install', install, '--config-root', roots.config, '--data-root', roots.state, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
  const first = run(join(from, 'bin/pa'), ['first-run', '--json', ...argsOf(from)])
  if (!['READY', 'OK'].includes(first.json?.status)) throw new Error('first-run failed')
  const freePort = () => new Promise((r) => { const srv = createServer(); srv.listen(0, '127.0.0.1', () => { const port = srv.address().port; srv.close(() => r(port)) }) })
  const consolePort = await freePort(); let apiPort = await freePort(); if (apiPort === consolePort) apiPort = await freePort()
  const outFd = openSync(join(root, 'start.out.log'), 'w', 0o600); const errFd = openSync(join(root, 'start.err.log'), 'w', 0o600)
  const daemon = spawn(join(from, 'bin/pa'), ['start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort), ...argsOf(from)], { cwd: from, stdio: ['ignore', outFd, errFd], detached: true })
  daemon.unref(); closeSync(outFd); closeSync(errFd)
  const healthDeadline = Date.now() + 60_000; let healthy = null
  while (Date.now() < healthDeadline) { try { const res = await fetch(`http://127.0.0.1:${apiPort}/v1/health`, { signal: AbortSignal.timeout(700) }); if (res.ok) { healthy = await res.json(); break } } catch {} await new Promise((r) => setTimeout(r, 200)) }
  if (healthy === null) throw new Error(`fixture start did not become healthy: ${readFileSync(join(root, 'start.err.log'), 'utf8').slice(0, 300)}`)
  const fromStatus = run(join(from, 'bin/pa'), ['status', '--json', ...argsOf(from)], [0, 2]).json?.instance
  if (fromStatus?.buildId !== fromManifest.buildId || fromStatus?.mode !== 'fixture') throw new Error(`from instance identity mismatch: ${JSON.stringify(fromStatus).slice(0, 500)}`)
  const dataPath = join(roots.state, 'state.sqlite')
  const dataBefore = readFileSync(dataPath)
  step('start-from-schema18', 'PASS', { fromBuild: fromManifest.buildId, mode: fromStatus.mode, schema: fromManifest.producer.productSchema })

  const upgraded = run(join(to, 'bin/pa'), ['upgrade', '--json', '--to', to, '--backup', join(root, 'same18.pab'), ...argsOf(from)], [0, 2])
  if (upgraded.json?.status !== 'CONFIRMED') throw new Error(`same-schema upgrade did not confirm: ${JSON.stringify(upgraded.json).slice(0, 400)}`)
  const status = run(join(to, 'bin/pa'), ['status', '--json', ...argsOf(from)], [0, 2]).json?.instance
  if (status?.buildId !== toManifest.buildId) throw new Error('pointer/process did not move to the new binary')
  if (status?.mode !== 'fixture') throw new Error('mode changed during same-schema upgrade')
  const dataAfter = readFileSync(dataPath)
  if (dataBefore.length === 0 || dataAfter.length === 0) throw new Error('state database disappeared')
  step('same-schema-upgrade-confirmed', 'PASS', { fromBuild: fromManifest.buildId, toBuild: toManifest.buildId, mode: status.mode, pointerBuild: status.buildId, dataRolledBack: upgraded.json?.dataRolledBack ?? null, stateBytes: dataAfter.length })

  const stop = run(join(to, 'bin/pa'), ['stop', '--json', ...argsOf(from)])
  if (stop.json?.status !== 'STOPPED') throw new Error('stop failed')
  step('stop', 'PASS', { status: stop.json.status })
  evidence.status = 'PASS'
  evidence.tuple = { from: { buildId: fromManifest.buildId, source: fromManifest.source.commit, sha256: fromManifest.digests?.tarSha256 ?? null },
    to: { buildId: toManifest.buildId, source: toManifest.source.commit, schema: toManifest.producer.productSchema } }
} catch (error) { evidence.status = 'FAIL'; evidence.error = String(error?.stack ?? error) }
finally { rmSync(root, { recursive: true, force: true }) }
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
