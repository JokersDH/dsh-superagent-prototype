#!/usr/bin/env node
/**
 * D8: real dual-binary managed upgrade and binary rollback between two different schema13 source
 * builds (preserved wave-07/wave-08 bytes). This is a same-schema binary switch; data is never
 * rolled back. The incompatible direction (old binary on schema16) is measured by the wave-11
 * matrix section D, not relabeled here.
 *
 * usage: verify-dual-binary.mjs [--json]
 */
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const { values } = parseArgs({ options: { json: { type: 'boolean', default: false } } })
const repo = resolve(new URL('../..', import.meta.url).pathname)
const root = mkdtempSync(join(tmpdir(), 'pa-dual-binary-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave11-dual-binary/1', status: 'FAIL', startedAt: new Date().toISOString(), steps: [], limitations: [
  'Both preserved artifacts are schema13; this proves a same-schema binary switch/rollback, not a schema migration or data rollback.',
  'Incompatible old-binary-on-newer-schema refusal is measured by the wave-11 matrix against the schema16 target.',
  'Only isolated temporary roots/ports; no user instance is touched.',
] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 400)}\n`) }
const run = (cli, args, timeout = 180_000) => {
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
const started = new Set()
const base = join(root, 'dual')
const paths = { config: join(base, 'config'), data: join(base, 'state'), cache: join(base, 'cache'), logs: join(base, 'logs'), workspace: join(base, 'workspace') }
const rootArgs = (install) => ['--install', install, '--config-root', paths.config, '--data-root', paths.data, '--cache-root', paths.cache, '--logs-root', paths.logs, '--workspace-root', paths.workspace]
const startDetached = async (cli, install, label) => {
  const consolePort = await freePort(); let apiPort = await freePort(); if (apiPort === consolePort) apiPort = await freePort()
  const outFd = openSync(join(base, `${label}.out.log`), 'w', 0o600); const errFd = openSync(join(base, `${label}.err.log`), 'w', 0o600)
  const child = spawn(cli, ['start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort), ...rootArgs(install)], { cwd: install, stdio: ['ignore', outFd, errFd], detached: true })
  child.unref(); closeSync(outFd); closeSync(errFd); started.add(child.pid)
  const health = await waitHealth(apiPort)
  if (health === null) throw new Error(`${label} did not become healthy`)
  const status = run(cli, ['status', '--json', ...rootArgs(install)])
  return { health, status: status.json, child }
}
const stop = (cli, install) => run(cli, ['stop', '--json', ...rootArgs(install)], 60_000)
try {
  const w07Source = '/Users/hh/Desktop/joker/pa-artifacts/wave07-target2/install'
  const w08Source = '/Users/hh/Desktop/joker/pa-artifacts/wave08-target/install'
  if (!existsSync(join(w07Source, 'install.json')) || !existsSync(join(w08Source, 'install.json'))) throw new Error('preserved dual-binary artifacts are missing')
  const w07 = join(base, 'w07'); const w08 = join(base, 'w08')
  mkdirSync(base, { recursive: true, mode: 0o700 })
  cpSync(w07Source, w07, { recursive: true }); cpSync(w08Source, w08, { recursive: true })
  for (const install of [w07, w08]) chmodSync(join(install, 'var/config'), 0o700)
  for (const path of Object.values(paths)) mkdirSync(path, { recursive: true, mode: 0o700 })
  const manifest07 = JSON.parse(readFileSync(join(w07, 'install.json'), 'utf8'))
  const manifest08 = JSON.parse(readFileSync(join(w08, 'install.json'), 'utf8'))
  if (manifest07.producer.productSchema !== manifest08.producer.productSchema) throw new Error('the two preserved builds are not same-schema')
  const storage = await import(pathToFileURL(join(repo, 'packages/storage/dist/index.js')).href)
  step('dual-artifacts', 'PASS', { from: { buildId: manifest07.buildId, schema: manifest07.producer.productSchema, source: manifest07.source.commit.slice(0, 8) }, to: { buildId: manifest08.buildId, schema: manifest08.producer.productSchema, source: manifest08.source.commit.slice(0, 8) } })

  const first = run(join(w07, 'bin/pa'), ['first-run', '--json', ...rootArgs(w07)])
  if (!['READY', 'OK'].includes(first.json?.status)) throw new Error(`first-run failed: ${JSON.stringify(first.json).slice(0, 300)}`)
  const initial = await startDetached(join(w07, 'bin/pa'), w07, 'w07')
  const databasePath = join(paths.data, 'state.sqlite')
  const digestOfState = () => createHash('sha256').update(readFileSync(databasePath)).digest('hex')
  const evidenceOfState = () => storage.readWorkflowEvidence(databasePath).digest
  const before = { digest: digestOfState(), evidence: evidenceOfState(), schema: storage.verifyDatabase(databasePath).productSchema }
  step('initial-binary-running', 'PASS', { buildId: initial.status?.instance?.buildId, schema: before.schema, evidence: before.evidence })

  const upgrade = run(join(w07, 'bin/pa'), ['upgrade', '--json', '--to', w08, '--backup', join(base, 'upgrade.pab'), ...rootArgs(w07)], 300_000)
  if (upgrade.json?.status !== 'CONFIRMED') throw new Error(`upgrade not confirmed: ${JSON.stringify(upgrade.json).slice(0, 400)}`)
  const upgraded = run(join(w08, 'bin/pa'), ['status', '--json', ...rootArgs(w08)])
  if (upgraded.json?.instance?.buildId !== manifest08.buildId) throw new Error(`running build is not the upgraded binary: ${upgraded.json?.instance?.buildId}`)
  if (upgraded.json?.instance?.pid !== initial.status?.instance?.pid && upgraded.json?.instance?.pid === undefined) throw new Error('upgraded instance pid is unknown')
  const afterUpgrade = { digest: digestOfState(), evidence: evidenceOfState(), schema: storage.verifyDatabase(databasePath).productSchema }
  if (afterUpgrade.schema !== before.schema) throw new Error('a same-schema binary switch changed the schema')
  if (afterUpgrade.evidence !== before.evidence) throw new Error('a same-schema binary switch changed A evidence')
  step('same-schema-upgrade', 'PASS', { buildId: upgraded.json.instance.buildId, schema: afterUpgrade.schema, evidenceUnchanged: true, digestUnchanged: afterUpgrade.digest === before.digest })

  const rollback = run(join(w08, 'bin/pa'), ['rollback-install', '--json', ...rootArgs(w08)], 120_000)
  if (rollback.json?.status !== 'BINARY_ROLLED_BACK') throw new Error(`rollback was refused: ${JSON.stringify(rollback.json).slice(0, 400)}`)
  if (rollback.json.from !== manifest08.buildId || rollback.json.to !== manifest07.buildId) throw new Error('rollback pointer did not record the exact pair')
  const journal = JSON.parse(readFileSync(join(paths.config, 'install-switch.json'), 'utf8'))
  if (journal.status !== 'binary_rolled_back') throw new Error(`journal is not terminal after rollback: ${journal.status}`)
  const rolled = await startDetached(join(w07, 'bin/pa'), w07, 'w07-again')
  if (rolled.status?.instance?.buildId !== manifest07.buildId) throw new Error('the rolled-back binary did not start')
  const afterRollback = { digest: digestOfState(), evidence: evidenceOfState(), schema: storage.verifyDatabase(databasePath).productSchema }
  if (afterRollback.evidence !== before.evidence) throw new Error('binary rollback silently changed data/evidence')
  step('binary-rollback', 'PASS', { from: rollback.json.from, to: rollback.json.to, journal: journal.status, runningBuild: rolled.status.instance.buildId, evidenceUnchanged: true, dataRolledBack: rollback.json.dataRolledBack })

  // A second rollback-install is an explicit switch back through the recorded previous pointer, not
  // a refusal; either an exact toggling pair or rollback_unavailable is truthful. Nothing is deleted.
  const duplicate = run(join(w07, 'bin/pa'), ['rollback-install', '--json', ...rootArgs(w07)], 60_000)
  const toggled = duplicate.json?.status === 'BINARY_ROLLED_BACK' && (
    (duplicate.json.from === manifest07.buildId && duplicate.json.to === manifest08.buildId) ||
    (duplicate.json.from === duplicate.json.to && duplicate.json.from === manifest07.buildId) ||
    (duplicate.json.from === duplicate.json.to && duplicate.json.from === manifest08.buildId)
  )
  const unavailable = duplicate.json?.code === 'rollback_unavailable'
  if (!toggled && !unavailable) throw new Error(`repeated rollback was neither an exact toggle nor rollback_unavailable: ${JSON.stringify(duplicate.json).slice(0, 300)}`)
  const journalAfterRepeat = JSON.parse(readFileSync(join(paths.config, 'install-switch.json'), 'utf8')).status
  step('repeat-rollback-truthful', 'PASS', { status: duplicate.json.status ?? duplicate.json.code, from: duplicate.json.from ?? null, to: duplicate.json.to ?? null, journal: journalAfterRepeat })

  const finalStop = stop(join(w07, 'bin/pa'), w07)
  if (finalStop.json?.status !== 'STOPPED') throw new Error('final stop failed')
  started.clear()
  step('cleanup', 'PASS', { status: finalStop.json.status })
  evidence.status = 'PASS'
  evidence.artifacts = { from: { buildId: manifest07.buildId, commit: manifest07.source.commit, schema: manifest07.producer.productSchema }, to: { buildId: manifest08.buildId, commit: manifest08.source.commit, schema: manifest08.producer.productSchema } }
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = String(error?.stack ?? error)
} finally {
  for (const pid of started) { try { process.kill(pid, 'SIGTERM') } catch { /* gone */ } }
  try { run(join(base, 'w07/bin/pa'), ['stop', '--json', ...rootArgs(join(base, 'w07'))], 20_000) } catch { /* best effort */ }
  evidence.finishedAt = new Date().toISOString()
  rmSync(root, { recursive: true, force: true })
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
