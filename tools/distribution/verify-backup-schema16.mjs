#!/usr/bin/env node
/**
 * D4: backup/restore closure over the current schema16 and its A-owned data families.
 *
 * Uses only A's public Store/backup/migration entrypoints (no SQL written by D): verifyDatabase,
 * backupDatabase, readWorkflowEvidence, applyMigrations with a caller-supplied FUTURE registry
 * fixture. Context bindings/reply-result families are inspected as A reports them; D does not
 * synthesize business rows.
 *
 * usage: verify-backup-schema16.mjs [--install <staged install>] [--json]
 */
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const { values } = parseArgs({ options: { install: { type: 'string' }, json: { type: 'boolean', default: false } } })
const repo = resolve(new URL('../..', import.meta.url).pathname)
const requireStorage = createRequire(join(repo, 'packages/storage/package.json'))
const Database = requireStorage('better-sqlite3')
const root = mkdtempSync(join(tmpdir(), 'pa-backup16-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave11-backup-schema16/1', status: 'FAIL', startedAt: new Date().toISOString(), steps: [], limitations: [
  'Uses isolated temporary states and the frozen/staged install; never the live user state.',
  'Future-schema fixture is produced through A applyMigrations with a caller-supplied registry (no SQL written by D).',
] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 400)}\n`) }
const run = (cli, args, timeout = 180_000) => {
  const result = spawnSync(cli, args, { encoding: 'utf8', timeout })
  let json = null
  try { json = JSON.parse(result.stdout) } catch { /* not json */ }
  return { status: result.status, json, stdout: result.stdout, stderr: result.stderr }
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
const rootsAt = (name, install) => {
  const base = join(root, name)
  const roots = { install, config: join(base, 'config'), data: join(base, 'state'), cache: join(base, 'cache'), logs: join(base, 'logs'), workspace: join(base, 'workspace') }
  for (const path of [roots.config, roots.data, roots.cache, roots.logs, roots.workspace]) mkdirSync(path, { recursive: true, mode: 0o700 })
  return roots
}
const argsOf = (roots) => ['--install', roots.install, '--config-root', roots.config, '--data-root', roots.data, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
const started = new Set()
const startFixture = async (cli, roots, name) => {
  const consolePort = await freePort(); let apiPort = await freePort(); if (apiPort === consolePort) apiPort = await freePort()
  const outFd = openSync(join(root, `${name}.out.log`), 'w', 0o600); const errFd = openSync(join(root, `${name}.err.log`), 'w', 0o600)
  const child = spawn(cli, ['start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort), ...argsOf(roots)], { cwd: roots.install, stdio: ['ignore', outFd, errFd], detached: true })
  child.unref(); closeSync(outFd); closeSync(errFd); started.add(child.pid)
  const health = await waitHealth(apiPort)
  if (health === null) throw new Error(`${name} did not become healthy`)
  return { child, health, apiPort }
}
try {
  let install = values.install
  if (install === undefined) {
    install = join(root, 'install'); mkdirSync(join(root, 'build-config'), { mode: 0o700 })
    const built = run(process.execPath, [join(repo, 'tools/distribution/build.mjs'), '--install-root', repo, '--config-root', join(root, 'build-config'), '--output', install, '--json'], 900_000)
    if (built.status !== 0) throw new Error(`build failed: ${built.stderr.slice(0, 300)}`)
  }
  const cli = join(install, 'bin', 'pa')
  const manifest = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8'))
  const storage = await import(pathToFileURL(join(install, 'app/packages/storage/dist/index.js')).href)
  step('install-identity', 'PASS', { buildId: manifest.buildId, commit: manifest.source.commit, dirty: manifest.source.dirty, schema: manifest.producer.productSchema, aSchema: Number(storage.PRODUCT_SCHEMA_VERSION) })
  if (Number(storage.PRODUCT_SCHEMA_VERSION) !== Number(manifest.producer.productSchema)) throw new Error('install schema and A product schema disagree')
  const currentSchema = Number(storage.PRODUCT_SCHEMA_VERSION)

  // 1. A fresh schema16 state, plus its A-owned backup closure.
  const roots = rootsAt('state16', install)
  const first = run(cli, ['first-run', '--json', ...argsOf(roots)])
  if (!['READY', 'OK'].includes(first.json?.status)) throw new Error('first-run failed')
  const instance = await startFixture(cli, roots, 'state16')
  await fetch(`http://127.0.0.1:${instance.apiPort}/v1/health`).then((r) => r.text())
  const stopped = run(cli, ['stop', '--json', ...argsOf(roots)])
  if (stopped.json?.status !== 'STOPPED') throw new Error('stop failed')
  const sourceDb = join(roots.data, 'state.sqlite')
  const sourceVerify = storage.verifyDatabase(sourceDb)
  if (sourceVerify.productSchema !== currentSchema || sourceVerify.integrity !== 'ok') throw new Error('source database is not a verified schema16 database')
  const sourceEvidence = storage.readWorkflowEvidence(sourceDb)
  const sourceFamilies = Object.fromEntries(sourceEvidence.families.map((family) => [family.name, { count: family.count, digest: family.digest }]))
  if (!('assistant_context_bindings' in sourceFamilies)) throw new Error('A workflow evidence does not expose the context-binding family')
  step('schema16-and-a-families', 'PASS', {
    productSchema: currentSchema,
    families: Object.keys(sourceFamilies),
    contextBindingCount: sourceFamilies.assistant_context_bindings.count,
    evidenceDigest: sourceEvidence.digest,
  })

  // 2. Backup and restore into a brand-new directory; the restored DB must verify and preserve the
  //    A-owned evidence summary (including context bindings/reply-result families A reports).
  const bundle = join(root, 'schema16.pab')
  const backup = run(cli, ['backup', '--json', '--out', bundle, ...argsOf(roots)])
  if (backup.json?.status !== 'CREATED') throw new Error(`backup failed: ${JSON.stringify(backup.json).slice(0, 200)}`)
  const restoredRoots = rootsAt('restored16', install)
  const restored = run(cli, ['restore', '--json', '--bundle', bundle, '--to', restoredRoots.data, ...argsOf(roots)])
  if (restored.json?.ok !== true && restored.json?.status !== 'RESTORED') throw new Error(`restore failed: ${JSON.stringify(restored.json).slice(0, 300)}`)
  const restoredDb = join(restoredRoots.data, 'state.sqlite')
  const restoredVerify = storage.verifyDatabase(restoredDb)
  const restoredEvidence = storage.readWorkflowEvidence(restoredDb)
  if (restoredVerify.productSchema !== currentSchema || restoredVerify.integrity !== 'ok') throw new Error('restored database did not verify as the current schema')
  if (restoredEvidence.digest !== sourceEvidence.digest) throw new Error('restored A evidence digest differs from the backed-up digest')
  step('backup-restore-schema16', 'PASS', {
    archiveSha256: backup.json.archiveSha256, restoredSchema: restoredVerify.productSchema,
    evidenceDigest: restoredEvidence.digest, familiesEqual: true,
    readonlyMarker: readFileSync(join(restoredRoots.data, 'restore-report.json'), 'utf8').length > 0,
  })

  // 3. A corrupted bundle must be refused before creating a usable state.
  const corrupt = join(root, 'corrupt.pab')
  const bytes = readFileSync(bundle)
  bytes[Math.floor(bytes.length / 2)] ^= 0xff
  writeFileSync(corrupt, bytes, { mode: 0o600 })
  const corruptTarget = join(root, 'corrupt-restore', 'state')
  mkdirSync(corruptTarget, { recursive: true, mode: 0o700 })
  const refusedCorrupt = run(cli, ['restore', '--json', '--bundle', corrupt, '--to', corruptTarget, ...argsOf(roots)])
  if (refusedCorrupt.json?.ok === true || ['RESTORED', 'CREATED'].includes(refusedCorrupt.json?.status))
    throw new Error(`a corrupted bundle was accepted: ${JSON.stringify(refusedCorrupt.json).slice(0, 300)}`)
  step('corrupt-bundle-refused', 'PASS', { code: refusedCorrupt.json?.code ?? refusedCorrupt.json?.status, targetUsable: existsSync(join(corruptTarget, 'state.sqlite')) })

  // 4. A future-schema database (A public applyMigrations with a fixture registry) is refused by the
  //    current install's start/doctor path instead of being migrated or silently accepted.
  const futureDbPath = join(root, 'future', 'state.sqlite')
  mkdirSync(join(root, 'future'), { recursive: true, mode: 0o700 })
  copyFileSync(sourceDb, futureDbPath)
  const db = new Database(futureDbPath)
  try {
    storage.applyMigrations(db, { registry: [...storage.MIGRATIONS, { version: currentSchema + 1, name: 'probe_future_schema', statements: [] }] })
  } finally { db.close() }
  const futureVerify = storage.verifyDatabase(futureDbPath)
  if (futureVerify.productSchema !== currentSchema + 1) throw new Error('future-schema fixture was not written')
  const futureRoots = rootsAt('future-state', install)
  copyFileSync(futureDbPath, join(futureRoots.data, 'state.sqlite'))
  run(cli, ['first-run', '--json', ...argsOf(futureRoots)])
  const futureStart = run(cli, ['start', '--json', '--fixture', '--port', String(await freePort()), '--api-port', String(await freePort()), ...argsOf(futureRoots)])
  if (futureStart.json?.ok === true) throw new Error('a future-schema state was started')
  if (!['state_schema_newer_than_binary', 'schema_newer_than_binary'].includes(futureStart.json?.code))
    throw new Error(`future schema was not refused with the exact code: ${JSON.stringify(futureStart.json).slice(0, 300)} stdout=${futureStart.stdout.slice(0, 300)} stderr=${futureStart.stderr.slice(0, 300)}`)
  const futureDoctor = run(cli, ['doctor', '--json', ...argsOf(futureRoots)])
  const futureCheck = (futureDoctor.json?.checks ?? []).find((check) => check.id === 'state_schema' || check.id === 'schema')
  step('future-schema-refused', 'PASS', { code: futureStart.json.code, doctor: futureDoctor.json?.status ?? null, schemaCheck: futureCheck?.status ?? null })

  // 5. A pre-s16 world (the preserved schema13 artifact) restores through A's migrations into 16.
  const baseline = '/Users/hh/Desktop/joker/pa-artifacts/wave06-alpha2/install'
  if (!existsSync(join(baseline, 'bin', 'pa'))) step('legacy-schema13-restore', 'SKIPPED', { reason: 'preserved wave-06 install is absent' })
  else {
    // The preserved install keeps its own release manifest under var/config; copy it so the frozen
    // artifact bytes are not mutated, and use that config root with a fresh data root.
    const legacyCopy = join(root, 'legacy13-install')
    cpSync(baseline, legacyCopy, { recursive: true })
    chmodSync(join(legacyCopy, 'var'), 0o700)
    chmodSync(join(legacyCopy, 'var/config'), 0o700)
    const legacyRoots = { install: legacyCopy, config: join(legacyCopy, 'var/config'), data: join(root, 'legacy13', 'state'), cache: join(root, 'legacy13', 'cache'), logs: join(root, 'legacy13', 'logs'), workspace: join(root, 'legacy13', 'workspace') }
    for (const path of [legacyRoots.data, legacyRoots.cache, legacyRoots.logs, legacyRoots.workspace]) mkdirSync(path, { recursive: true, mode: 0o700 })
    const legacyCli = join(legacyCopy, 'bin', 'pa')
    const legacyFirst = run(legacyCli, ['first-run', ...argsOf(legacyRoots)])
    if (legacyFirst.status !== 0) throw new Error(`legacy first-run failed (exit ${legacyFirst.status}): ${legacyFirst.stderr.slice(0, 300)}`)
    const legacyInstance = await startFixture(legacyCli, legacyRoots, 'legacy13')
    await fetch(`http://127.0.0.1:${legacyInstance.apiPort}/v1/health`).then((r) => r.text())
    run(legacyCli, ['stop', '--json', ...argsOf(legacyRoots)])
    const legacySchema = storage.verifyDatabase(join(legacyRoots.data, 'state.sqlite')).productSchema
    const legacyBundle = join(root, 'legacy13.pab')
    const legacyBackup = run(legacyCli, ['backup', '--json', '--out', legacyBundle, ...argsOf(legacyRoots)])
    if (legacyBackup.json?.status !== 'CREATED') throw new Error('legacy backup failed')
    const migratedRoots = rootsAt('migrated16', install)
    const migrated = run(cli, ['restore', '--json', '--bundle', legacyBundle, '--to', migratedRoots.data, ...argsOf(legacyRoots)])
    if (migrated.json?.ok !== true && migrated.json?.status !== 'RESTORED') throw new Error(`legacy restore failed: ${JSON.stringify(migrated.json).slice(0, 300)}`)
    const beforeStart = storage.verifyDatabase(join(migratedRoots.data, 'state.sqlite'))
    // The restored copy keeps its historical bytes. A is the only migration writer, so open the
    // restored database through A's public ProductStore (the same entry main uses); D writes no SQL.
    const restoredStore = new storage.ProductStore({ path: join(migratedRoots.data, 'state.sqlite') })
    restoredStore.close()
    const migratedVerify = storage.verifyDatabase(join(migratedRoots.data, 'state.sqlite'))
    if (migratedVerify.productSchema !== currentSchema) throw new Error(`legacy restore did not migrate to ${currentSchema}: ${migratedVerify.productSchema}`)
    step('legacy-schema13-restore', 'PASS', { legacySchema, beforeMigrationSchema: beforeStart.productSchema, migratedSchema: migratedVerify.productSchema,
      integrity: migratedVerify.integrity, migratedBy: 'A ProductStore public open' })
  }

  evidence.status = 'PASS'
  evidence.artifact = { install, buildId: manifest.buildId, commit: manifest.source.commit, schema: currentSchema, dirty: manifest.source.dirty }
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
