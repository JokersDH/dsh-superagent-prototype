#!/usr/bin/env node
/**
 * D4/D8: real-process ownership barrier and a real schema16 -> schema18 managed upgrade.
 *
 * 1. An unregistered stranger whose argv names the same state must block the switch (unknown live),
 *    remain alive, and leave the running instance/pointer unchanged; accounting is a diagnostic, not
 *    a kill list.
 * 2. After the stranger is gone, the same command migrates to the new binary, keeps user data, and
 *    the old binary must then refuse the newer schema instead of deleting/rolling data back.
 *
 * usage: verify-cross-schema-upgrade.mjs --from <schema16 install> --to <schema18 install> [--json]
 */
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' }, json: { type: 'boolean', default: false } } })
const repo = resolve(new URL('../..', import.meta.url).pathname)
const root = mkdtempSync(join(tmpdir(), 'pa-cross-schema-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave12-cross-schema/1', status: 'FAIL', startedAt: new Date().toISOString(), steps: [], limitations: [
  'The stranger is spawned by this recipe and is the only non-owned process; no shared install/cache/logs scan is used to kill it.',
  'Same-schema dual-binary rollback remains the preserved wave-07/wave-08 schema13 pair (wave-11 dual recipe); this recipe is the cross-schema direction.',
] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 400)}\n`) }
const run = (cli, args, timeout = 300_000) => {
  const result = spawnSync(cli, args, { encoding: 'utf8', timeout })
  let json = null; try { json = JSON.parse(result.stdout) } catch { /* not json */ }
  return { status: result.status, signal: result.signal, json, stdout: result.stdout, stderr: result.stderr }
}
const freePort = () => new Promise((r) => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => r(port)) }) })
const waitHealth = async (port, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { try { const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(800) }); if (res.ok) return await res.json() } catch { /* not ready */ } await new Promise((r) => setTimeout(r, 200)) }
  return null
}
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const started = new Set()
try {
  if (values.from === undefined || values.to === undefined) throw new Error('--from and --to are required')
  const fromSource = resolve(values.from), toSource = resolve(values.to)
  const base = join(root, 'run'); mkdirSync(base, { recursive: true, mode: 0o700 })
  const from = join(base, 'from'), to = join(base, 'to')
  cpSync(fromSource, from, { recursive: true }); cpSync(toSource, to, { recursive: true })
  chmodSync(join(from, 'var/config'), 0o700); chmodSync(join(to, 'var/config'), 0o700)
  const roots = { config: join(base, 'config'), data: join(base, 'state'), cache: join(base, 'cache'), logs: join(base, 'logs'), workspace: join(base, 'workspace') }
  for (const path of Object.values(roots)) mkdirSync(path, { recursive: true, mode: 0o700 })
  const rootArgs = (install) => ['--install', install, '--config-root', roots.config, '--data-root', roots.data, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
  const fromCli = join(from, 'bin/pa'), toCli = join(to, 'bin/pa')
  const manifestFrom = JSON.parse(readFileSync(join(from, 'install.json'), 'utf8'))
  const manifestTo = JSON.parse(readFileSync(join(to, 'install.json'), 'utf8'))
  if (manifestFrom.producer.productSchema !== 16 || manifestTo.producer.productSchema !== 18) throw new Error(`unexpected schemas ${manifestFrom.producer.productSchema} -> ${manifestTo.producer.productSchema}`)
  const first = run(fromCli, ['first-run', '--json', ...rootArgs(from)])
  if (!['READY', 'OK'].includes(first.json?.status)) throw new Error(`first-run failed: ${JSON.stringify(first.json).slice(0, 300)}`)
  const consolePort = await freePort(); let apiPort = await freePort(); if (apiPort === consolePort) apiPort = await freePort()
  const outFd = openSync(join(base, 'from.out.log'), 'w', 0o600); const errFd = openSync(join(base, 'from.err.log'), 'w', 0o600)
  const child = spawn(fromCli, ['start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort), ...rootArgs(from)], { cwd: from, stdio: ['ignore', outFd, errFd], detached: true })
  child.unref(); closeSync(outFd); closeSync(errFd); started.add(child.pid)
  const health = await waitHealth(apiPort)
  if (health === null) throw new Error('schema16 instance did not become healthy')
  const beforeStatus = run(fromCli, ['status', '--json', ...rootArgs(from)])
  if (beforeStatus.json?.instance?.buildId !== manifestFrom.buildId) throw new Error('schema16 instance identity mismatch')
  const pointerBefore = JSON.parse(readFileSync(join(roots.config, 'release.json'), 'utf8')).buildId

  // Unregistered stranger names the same state root in its argv; it is NOT registered in any record
  // or journal, so accounting must report it as unknown and must not signal it.
  const stranger = spawn(process.execPath, ['-e', `require('node:net').createServer().listen(${await freePort()},'127.0.0.1');setInterval(()=>{},1000) // ${roots.data}`], { stdio: 'ignore', detached: true })
  stranger.unref(); started.add(stranger.pid)
  await new Promise((r) => setTimeout(r, 400))
  const blocked = run(toCli, ['upgrade', '--json', '--to', to, '--backup', join(base, 'blocked.pab'), ...rootArgs(from)])
  const blockedCode = blocked.json?.code ?? blocked.json?.status
  if (!['unknown_live_resource', 'target_stop_unproven', 'upgrade_stop_failed'].includes(blockedCode)) throw new Error(`unregistered live writer did not block the switch: ${blockedCode} ${JSON.stringify(blocked.json).slice(0, 300)}`)
  if (!alive(stranger.pid)) throw new Error('the unregistered stranger was killed by the accounting')
  const afterBlocked = run(fromCli, ['status', '--json', ...rootArgs(from)])
  if (afterBlocked.json?.instance?.buildId !== manifestFrom.buildId) throw new Error(`the blocked switch changed the running build: ${JSON.stringify(afterBlocked.json).slice(0, 500)}`)
  const pointerAfterBlocked = JSON.parse(readFileSync(join(roots.config, 'release.json'), 'utf8')).buildId
  if (pointerAfterBlocked !== pointerBefore) throw new Error('the blocked switch moved the install pointer')
  step('unregistered-writer-blocks', 'PASS', { code: blockedCode, strangerAlive: alive(stranger.pid), runningBuild: afterBlocked.json.instance.buildId, pointerUnchanged: true })

  // The stranger is this recipe's own process: stop that exact pid and retry the real upgrade.
  try { process.kill(stranger.pid, 'SIGKILL') } catch { /* gone */ }
  started.delete(stranger.pid)
  await new Promise((r) => setTimeout(r, 300))
  const upgraded = run(toCli, ['upgrade', '--json', '--to', to, '--backup', join(base, 'upgrade.pab'), ...rootArgs(from)])
  if (upgraded.json?.status !== 'CONFIRMED') throw new Error(`upgrade was not confirmed: ${JSON.stringify(upgraded.json).slice(0, 400)}`)
  const running = run(toCli, ['status', '--json', ...rootArgs(to)])
  if (running.json?.instance?.buildId !== manifestTo.buildId) throw new Error('the upgraded binary is not serving')
  const storage = await import(pathToFileURL(join(to, 'app/packages/storage/dist/index.js')).href)
  const migratedSchema = storage.verifyDatabase(join(roots.data, 'state.sqlite')).productSchema
  if (migratedSchema !== 18) throw new Error(`state did not migrate to schema18: ${migratedSchema}`)
  step('schema16-to-18-upgrade', 'PASS', { from: manifestFrom.buildId, to: running.json.instance.buildId, schema: migratedSchema, backup: upgraded.json.backup?.path ?? null })

  // The old binary must refuse the newer state instead of deleting data or silently rolling back.
  const stopped = run(toCli, ['stop', '--json', ...rootArgs(to)])
  if (stopped.json?.status !== 'STOPPED') throw new Error('upgraded instance did not stop')
  started.delete(child.pid)
  // Point the private config back at the old release manifest (a config selection, not a code edit),
  // so the old binary reaches its schema preflight instead of failing artifact validation of the
  // newer pointer.
  copyFileSync(join(from, 'var/config/release.json'), join(roots.config, 'release.json'))
  chmodSync(join(roots.config, 'release.json'), 0o600)
  const oldStart = run(fromCli, ['start', '--json', '--fixture', '--port', String(await freePort()), '--api-port', String(await freePort()), ...rootArgs(from)])
  if (oldStart.json?.code !== 'state_schema_newer_than_binary') throw new Error(`old binary did not refuse newer schema: ${JSON.stringify(oldStart.json).slice(0, 300)}`)
  const schemaAfterRefusal = storage.verifyDatabase(join(roots.data, 'state.sqlite')).productSchema
  if (schemaAfterRefusal !== 18) throw new Error('the refused old binary changed the schema/data')
  const evidenceAfter = storage.readWorkflowEvidence(join(roots.data, 'state.sqlite'))
  step('old-binary-refuses-new-schema', 'PASS', { code: oldStart.json.code, schema: schemaAfterRefusal, evidenceDigest: evidenceAfter.digest })

  evidence.status = 'PASS'
  evidence.artifacts = { from: { buildId: manifestFrom.buildId, schema: 16, commit: manifestFrom.source.commit }, to: { buildId: manifestTo.buildId, schema: 18, commit: manifestTo.source.commit } }
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
