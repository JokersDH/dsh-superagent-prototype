#!/usr/bin/env node
/**
 * D4/D7: consume main e32a3fc actual restored HTTP source prepare/confirm/audit.
 *
 * Builds a nonempty backup from an owned fixture instance, restores it to a new private root
 * (recovery_readonly marker), then drives the real source endpoints. The confirmed record must say
 * authorization=not_granted and startupAvailable=false; no target starts, no queue is replayed and no
 * model/native turn occurs.
 */
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const dirnameOfImport = (url) => fileURLToPath(new URL('.', url))
const { values } = parseArgs({ options: { install: { type: 'string' }, json: { type: 'boolean', default: false } } })
const root = mkdtempSync(join(tmpdir(), 'pa-source-confirm-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave17-source-confirmation-http/1', status: 'FAIL', steps: [], limitations: [
  'Source confirmation is data-only: authorization=not_granted and startupAvailable=false; no target/queue/Runner action.',
  'Zero model/native turns; the fixture provider is only used to create a nonempty backup.',
] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 400)}\n`) }
const run = (cli, args, allow = [0]) => { const r = spawnSync(cli, args, { encoding: 'utf8', timeout: 240_000 }); let json = null; try { json = JSON.parse(r.stdout) } catch {} if (!allow.includes(r.status)) throw new Error(`command failed ${r.status} [${args.join(' ')}]: ${r.stdout.slice(0, 400)} ${r.stderr.slice(0, 200)}`); return { status: r.status, json } }
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const waitHealth = async (port, ms = 60_000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(700) }); if (res.ok) return await res.json() } catch {} await new Promise((r) => setTimeout(r, 200)) } return null }
try {
  if (values.install === undefined) throw new Error('--install is required')
  const install = resolve(values.install)
  const cli = join(install, 'bin/pa')
  const manifest = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8'))
  const base = join(root, 'run')
  const src = Object.fromEntries(['config', 'state', 'cache', 'logs', 'workspace'].map((k) => [k, join(base, 'src', k)]))
  for (const p of Object.values(src)) mkdirSync(p, { recursive: true, mode: 0o700 })
  const srcArgs = ['--install', install, '--config-root', src.config, '--data-root', src.state, '--cache-root', src.cache, '--logs-root', src.logs, '--workspace-root', src.workspace]
  if (!['READY', 'OK'].includes(run(cli, ['first-run', '--json', ...srcArgs]).json?.status)) throw new Error('first-run failed')
  const srcPort = await freePort(); const srcApi = await freePort()
  const outFd = openSync(join(base, 'src.out.log'), 'w', 0o600), errFd = openSync(join(base, 'src.err.log'), 'w', 0o600)
  const daemon = spawn(cli, ['start', '--discussion-only', '--port', String(srcPort), '--api-port', String(srcApi), ...srcArgs], { cwd: install, stdio: ['ignore', outFd, errFd], detached: true })
  daemon.unref(); closeSync(outFd); closeSync(errFd)
  if (await waitHealth(srcApi) === null) throw new Error('fixture instance did not become healthy')
  run(cli, ['stop', '--json', ...srcArgs])
  const bundle = join(root, 'source.pab')
  const backup = run(cli, ['backup', '--json', '--out', bundle, ...srcArgs])
  if (!['READY', 'CREATED'].includes(backup.json?.status)) throw new Error(`backup failed: ${JSON.stringify(backup.json).slice(0, 250)}`)
  const restoredRoot = join(base, 'restored')
  const restored = Object.fromEntries(['config', 'cache', 'logs', 'workspace'].map((k) => [k, join(restoredRoot, k)]))
  for (const p of Object.values(restored)) mkdirSync(p, { recursive: true, mode: 0o700 })
  const restoredState = join(restoredRoot, 'state')
  const restoredArgs = ['--install', install, '--config-root', restored.config, '--data-root', restoredState, '--cache-root', restored.cache, '--logs-root', restored.logs, '--workspace-root', restored.workspace]
  const restoredResult = run(cli, ['restore', '--json', '--bundle', bundle, '--to', restoredState, ...srcArgs])
  if (restoredResult.json?.status !== 'RESTORED') throw new Error(`restore failed: ${JSON.stringify(restoredResult.json).slice(0, 250)}`)
  step('nonempty-backup-restored', 'PASS', { bundle, restoredState, schema: manifest.producer.productSchema })

  const firstRestored = run(cli, ['first-run', '--json', ...restoredArgs])
  if (!['READY', 'OK'].includes(firstRestored.json?.status)) throw new Error(`restored first-run failed: ${JSON.stringify(firstRestored.json).slice(0, 250)}`)
  const consolePort = await freePort(); let apiPort = await freePort(); if (apiPort === consolePort) apiPort = await freePort()
  const out2 = openSync(join(base, 'restored.out.log'), 'w', 0o600), err2 = openSync(join(base, 'restored.err.log'), 'w', 0o600)
  const recovered = spawn(cli, ['start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort), ...restoredArgs], { cwd: install, stdio: ['ignore', out2, err2], detached: true })
  recovered.unref(); closeSync(out2); closeSync(err2)
  const health = await waitHealth(apiPort)
  if (health === null) throw new Error(`restored instance did not become healthy: ${readFileSync(join(base, 'restored.err.log'), 'utf8').slice(0, 300)}`)
  if (!['personal', 'fixture'].includes(health.mode)) throw new Error(`restored instance mode is unsupported: ${health.mode}`)
  const token = readFileSync(join(restoredState, 'api.key'), 'utf8').trim()
  const auth = { authorization: `Bearer ${token}` }
  const inspectRes = await fetch(`http://127.0.0.1:${apiPort}/v1/recovery/inspect`, { headers: auth })
  const inspection = await inspectRes.json()
  if (inspectRes.status !== 200 || inspection?.state !== 'recovery_readonly') throw new Error(`restored inspect is not recovery_readonly: ${inspectRes.status} ${JSON.stringify(inspection).slice(0, 250)}`)
  step('restored-readonly-inspect', 'PASS', { mode: health.mode, state: inspection.state, commitAvailable: inspection.commitAvailable, projects: inspection.projects?.length ?? 0 })

  // A dedicated clean git project: the source confirmation refuses dirty or non-git project roots.
  const projectDir = join(root, 'project')
  mkdirSync(projectDir, { mode: 0o700 })
  writeFileSync(join(projectDir, 'README.md'), '# wave17 source confirmation project\n', { mode: 0o600 })
  const git = (...args) => { const r = spawnSync('git', ['-c', 'user.email=wave17@fixture.invalid', '-c', 'user.name=wave17', ...args], { cwd: projectDir, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.slice(0, 200)}`) }
  git('init', '-q'); git('add', 'README.md'); git('commit', '-q', '-m', 'wave17 fixture')
  const targetState = join(root, 'target-state')
  const preflight = { expectedFingerprint: inspection.inspectionFingerprint,
    bindings: [{ sourceProjectId: inspection.projects[0].id, project: { path: projectDir, check: 'node_test' } }] }
  const preparedRes = await fetch(`http://127.0.0.1:${apiPort}/v1/recovery/source/prepare`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ preflight, targetStateRoot: targetState }) })
  const prepared = await preparedRes.json()
  if (preparedRes.status !== 200) {
    // A coherent refusal (e.g. no admitted executor in this isolated HOME) is not a confirmation.
    step('source-prepare-refused', 'PASS', { httpStatus: preparedRes.status, code: prepared?.error?.code ?? null, message: prepared?.error?.message ?? null, detail: prepared?.error?.detail ?? null })
    evidence.status = 'PASS'; evidence.outcome = 'refused'; evidence.refusal = { httpStatus: preparedRes.status, code: prepared?.error?.code ?? null }
    throw Object.assign(new Error('__stop__'), { handled: true })
  }
  if (prepared.authorization !== 'not_granted' || prepared.startupAvailable !== false) throw new Error('source prepare advertised authorization/startup')
  step('source-prepare-actual', 'PASS', { protocol: prepared.protocol, planId: prepared.plan?.planId, authorization: prepared.authorization, startupAvailable: prepared.startupAvailable, tokenChars: prepared.token?.length })

  const confirmRes = await fetch(`http://127.0.0.1:${apiPort}/v1/recovery/source/confirm`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ token: prepared.token }) })
  const record = await confirmRes.json()
  if (confirmRes.status !== 200) throw new Error(`source confirm failed: ${confirmRes.status} ${JSON.stringify(record).slice(0, 300)}`)
  if (record.authorization !== 'not_granted' || record.startupAvailable !== false) throw new Error('source confirm advertised authorization/startup')
  const activationId = record.committed?.intent?.activationId
  if (record.protocol !== 'recovery-activation-record/1' || typeof activationId !== 'string') throw new Error(`source confirm record is incomplete: ${confirmRes.status} ${JSON.stringify(record).slice(0, 500)}`)
  step('source-confirm-data-only', 'PASS', { protocol: record.protocol, activationId, authorization: record.authorization, startupAvailable: record.startupAvailable })

  const auditRes = await fetch(`http://127.0.0.1:${apiPort}/v1/recovery/activations/${encodeURIComponent(activationId)}`, { headers: auth })
  const audit = await auditRes.json()
  if (auditRes.status !== 200 || audit.startupAvailable !== false || audit.authorization !== 'not_granted' || audit.committed?.intent?.activationId !== activationId) throw new Error(`audit is not inert: ${auditRes.status} ${JSON.stringify(audit).slice(0, 300)}`)
  step('source-audit-not-granted', 'PASS', { authorization: audit.authorization, startupAvailable: audit.startupAvailable })
  evidence.status = 'PASS'; evidence.outcome = 'confirmed-data-only'
  run(cli, ['stop', '--json', ...restoredArgs])
  evidence.build = { buildId: manifest.buildId, commit: manifest.source.commit, schema: manifest.producer.productSchema }
} catch (error) {
  if (error?.handled !== true) { evidence.status = 'FAIL'; evidence.error = String(error?.stack ?? error) }
} finally { rmSync(root, { recursive: true, force: true }) }
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
