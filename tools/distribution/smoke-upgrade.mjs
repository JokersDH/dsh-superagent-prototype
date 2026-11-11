#!/usr/bin/env node
/**
 * Wave-06 D5: binary vs data behavior for upgrade and rollback.
 *
 * Three separate claims, kept separate on purpose:
 *
 * A. Same source, two build identities (tag only). Proves the data round-trip and that a rebuilt
 *    binary starts on the same state; it is NOT cross-version migration evidence.
 * B. Real cross-version data upgrade: a state written by the frozen schema-12 build is backed up and
 *    restored by the schema-13 build; first start applies the append-only migration, existing records
 *    survive, routing tables exist and are empty (no fabricated rows), and the old bundle is labelled
 *    legacy evidence.
 * C. Real cross-version downgrade refusal: a schema-13 state/bundle must be refused by the schema-12
 *    build instead of being silently opened, truncated or down-migrated.
 *
 * Local temp roots/ports only; no user service, native executor or model call.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { readEvidenceSummary } from '../../packages/portability/dist/index.js'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PA = join(REPO_ROOT, 'apps/launcher/bin/pa.mjs')
const BUILD = join(REPO_ROOT, 'tools/distribution/build.mjs')
const OLD_INSTALL = process.env.PA_OLD_SCHEMA12_INSTALL ?? '/Users/hh/Desktop/joker/pa-artifacts/wave06-final/install'
const evidence = { case: 'WAVE06-UPGRADE-ROLLBACK', status: 'FAIL', startedAt: new Date().toISOString(), sections: {} }
const section = (id, status, detail) => { evidence.sections[id] = { status, ...(detail === undefined ? {} : { detail }) } }

const freePort = () => new Promise((resolvePort, reject) => {
  const socket = createServer()
  socket.once('error', reject)
  socket.listen(0, '127.0.0.1', () => {
    const { port } = socket.address()
    socket.close(() => resolvePort(port))
  })
})

const root = mkdtempSync(join(tmpdir(), 'pa-wave06-upgrade-'))
const run = (binary, args, options = {}) => {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 300_000, ...options })
  if (options.allowExit !== undefined && !options.allowExit.includes(result.status))
    throw new Error(`${binary} ${args.slice(0, 4).join(' ')} exit ${result.status}\n${result.stdout}\n${result.stderr}`)
  let json = null
  try { json = JSON.parse(result.stdout) } catch { json = null }
  return { ...result, json }
}
const paOf = (installDir) => (args, options = {}) => {
  const wrapper = join(installDir, 'bin', 'pa')
  return run(wrapper, args, options)
}
const roots = (name, configRoot) => ({
  config: configRoot ?? join(root, name, 'config'),
  data: join(root, name, 'data'), cache: join(root, name, 'cache'),
  logs: join(root, name, 'logs'), workspaces: join(root, name, 'workspaces'),
})
const stateArgs = (target) => ['--config-root', target.config, '--data-root', target.data, '--cache-root', target.cache, '--logs-root', target.logs, '--workspace-root', target.workspaces]
const installArgs = (installDir, target) => ['--install', join(installDir, 'app'), ...stateArgs(target)]
const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

/**
 * Builds an old-schema state: real records through the current store, then remove the v13 tables and
 * trim the applied-migration list. v13 is additive only, so this is what a schema-12 build left
 * behind. The frozen old build then opens it, which is the check that the fixture is genuinely old.
 */
function downgradeToSchema12(stateDir) {
  const store = new ProductStore({ path: join(stateDir, 'state.sqlite') })
  try {
    store.db.exec('DROP TABLE route_advice; DROP TABLE review_evidence; DROP TABLE execution_outcome;')
    store.db.prepare("UPDATE schema_meta SET value = '12' WHERE key = 'product_schema'").run()
    const appliedRow = store.db.prepare("SELECT value FROM schema_meta WHERE key = 'migrations'").get()
    const applied = JSON.parse(String(appliedRow.value))
    store.db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'migrations'").run(JSON.stringify(applied.filter((entry) => entry.version <= 12)))
  } finally {
    store.close()
  }
}

function seedState(stateDir) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const store = new ProductStore({ path: join(stateDir, 'state.sqlite') })
  try {
    const now = new Date().toISOString()
    store.workflows.projects.append({ projectId: 'project-upgrade', expectedRevision: 0, settings: { pathDigest: 'a'.repeat(64), check: 'node_test', sourceRef: 'upgrade-fixture' }, createdAt: now })
    store.product.works.insert({ id: 'work-upgrade', projectId: 'project-upgrade', conversationId: 'conv-upgrade', title: 'upgrade work', createdAt: now })
    const artifact = store.artifacts.write(Buffer.from('pre-upgrade patch bytes\n'))
    store.artifacts.insert(artifact)
    return { artifactId: artifact.id, artifactDigest: artifact.digest }
  } finally {
    store.close()
  }
}

async function startAndStop(installDir, target, label, argsBuilder) {
  const extra = (argsBuilder ?? ((t) => installArgs(installDir, t)))(target)
  const consolePort = await freePort()
  let apiPort = await freePort()
  if (apiPort === consolePort) apiPort = await freePort()
  const out = join(root, `start-${label}.out.log`)
  const err = join(root, `start-${label}.err.log`)
  const outFd = openSync(out, 'w', 0o600)
  const errFd = openSync(err, 'w', 0o600)
  const child = spawn(join(installDir, 'bin', 'pa'), ['start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort), ...extra], { cwd: REPO_ROOT, stdio: ['ignore', outFd, errFd] })
  const deadline = Date.now() + 60_000
  let health = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/v1/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok) { health = await response.json(); break }
    } catch { /* not ready */ }
    if (child.exitCode !== null) break
    await new Promise((r) => setTimeout(r, 100))
  }
  closeSync(outFd)
  closeSync(errFd)
  if (health === null) {
    const tail = (() => { try { return `${readFileSync(out, 'utf8').slice(-1500)}\n${readFileSync(err, 'utf8').slice(-1500)}` } catch { return 'no logs' } })()
    throw new Error(`instance from ${label} did not become healthy; exit=${child.exitCode}\n${tail}`)
  }
  const stop = run(join(installDir, 'bin', 'pa'), ['stop', '--json', ...extra], { allowExit: [0] })
  if (stop.json?.status !== 'STOPPED') throw new Error(`instance from ${label} did not stop cleanly`)
  await new Promise((r) => child.once('exit', r))
  return health
}

try {
  const installNew = join(root, 'install-new')
  const configNew = join(root, 'build-config-new')
  const buildNew = run(process.execPath, [BUILD, '--install-root', REPO_ROOT, '--config-root', configNew, '--output', installNew, '--json'], { allowExit: [0] })
  const summaryNew = JSON.parse(buildNew.stdout)
  const newPa = paOf(installNew)
  // The frozen older artifact is never modified: copy it so its own release manifest and any
  // instance record stay inside a disposable tree.
  const oldInstall = OLD_INSTALL === '' || !existsSync(OLD_INSTALL) ? null : join(root, 'old-install')
  if (oldInstall !== null) {
    cpSync(OLD_INSTALL, oldInstall, { recursive: true })
    // The launcher's own first-run creates private roots; a plain copy keeps the archive's modes.
    for (const relative of ['var/config', 'var/data', 'var/cache', 'var/logs', 'var/workspaces']) {
      const path = join(oldInstall, relative)
      if (existsSync(path)) chmodSync(path, 0o700)
    }
  }
  const oldPa = oldInstall === null ? null : paOf(oldInstall)
  // The copied build keeps its own config root (release manifest), so only state roots are overridden.
  const oldStateArgs = (target) => ['--data-root', target.data, '--cache-root', target.cache, '--logs-root', target.logs, '--workspace-root', target.workspaces]
  const oldInstallArgs = (target) => ['--install', join(oldInstall, 'app'), ...oldStateArgs(target)]
  const oldBuildId = oldInstall === null ? null : (() => {
    try { return JSON.parse(readFileSync(join(oldInstall, 'install.json'), 'utf8')).buildId } catch { return null }
  })()
  // ---- A. Same source, two build identities: data round-trip only ----
  const installTwin = join(root, 'install-twin')
  const configTwin = join(root, 'build-config-twin')
  const buildTwin = run(process.execPath, [BUILD, '--install-root', REPO_ROOT, '--config-root', configTwin, '--output', installTwin, '--tag', 'wave07-twin-sim', '--json'], { allowExit: [0] })
  const summaryTwin = JSON.parse(buildTwin.stdout)
  if (summaryNew.buildId === summaryTwin.buildId) throw new Error('two builds did not produce distinct identities')
  const twinTarget = roots('twin', configNew)
  const seeded = seedState(twinTarget.data)
  const before = readEvidenceSummary(join(twinTarget.data, 'state.sqlite'))
  newPa(['first-run', '--json', ...installArgs(installNew, twinTarget)], { allowExit: [0] })
  // Each build identity keeps its own release manifest in its own config root.
  paOf(installTwin)(['first-run', '--json', ...installArgs(installTwin, { ...twinTarget, config: configTwin })], { allowExit: [0] })
  await startAndStop(installNew, twinTarget, 'twin-a')
  const twinBackup = newPa(['backup', '--json', '--out', join(root, 'twin.pab'), ...installArgs(installNew, twinTarget)], { allowExit: [0] })
  if (twinBackup.json.evidence?.digest !== before.digest) throw new Error('twin backup evidence digest does not match the live state')
  await startAndStop(installTwin, { ...twinTarget, config: configTwin }, 'twin-b')
  const store = new ProductStore({ path: join(twinTarget.data, 'state.sqlite') })
  try {
    store.workflows.projects.append({ projectId: 'project-upgrade', expectedRevision: 1, settings: { pathDigest: 'b'.repeat(64), check: 'node_test', sourceRef: 'post-rebuild-change' } })
  } finally { store.close() }
  const changed = readEvidenceSummary(join(twinTarget.data, 'state.sqlite'))
  if (changed.digest === before.digest) throw new Error('post-rebuild data did not change the evidence digest')
  const twinRollback = paOf(installTwin)(['rollback', '--json', '--bundle', join(root, 'twin.pab'), '--target', twinTarget.data, ...installArgs(installTwin, { ...twinTarget, config: configTwin })], { allowExit: [0] })
  if (twinRollback.json?.status !== 'ROLLED_BACK') throw new Error('rollback did not report ROLLED_BACK')
  const after = readEvidenceSummary(join(twinTarget.data, 'state.sqlite'))
  if (after.digest !== before.digest) throw new Error('rolled-back evidence does not match the pre-rebuild state')
  if (after.projects[0]?.revision !== 1) throw new Error('rollback kept the post-rebuild project revision')
  if (after.works[0]?.id !== 'work-upgrade' || after.artifacts[0]?.digest !== seeded.artifactDigest) throw new Error('rollback lost pre-rebuild work/artifact')
  await startAndStop(installTwin, { ...twinTarget, config: configTwin }, 'twin-b-after-rollback')
  section('A-same-source-rebuild-data-roundtrip', 'PASS', {
    claim: 'data round-trip across two builds of the same source; NOT a schema migration',
    buildA: summaryNew.buildId,
    buildB: summaryTwin.buildId,
    evidenceDigest: after.digest,
    projectRevision: after.projects[0].revision,
    artifactDigest: after.artifacts[0].digest,
  })

  // ---- B. Real cross-version data upgrade: schema 12 state -> schema 13 build ----
  if (oldPa === null || oldBuildId === null) {
    section('B-cross-version-data-upgrade', 'BLOCKED', { reason: 'frozen schema-12 install artifact was not found', path: OLD_INSTALL })
  } else {
    const oldTarget = roots('old-state')
    oldPa(['first-run', '--json', ...oldInstallArgs(oldTarget)], { allowExit: [0] })
    const oldSeeded = seedState(oldTarget.data)
    downgradeToSchema12(oldTarget.data)
    // Let the frozen schema-12 build itself confirm it opens this state; if it migrated, the fixture
    // would not be a genuine old-schema database.
    await startAndStop(oldInstall, oldTarget, 'old-schema12', oldInstallArgs)
    const oldSummary = readEvidenceSummary(join(oldTarget.data, 'state.sqlite'))
    if (oldSummary.productSchema !== 12) throw new Error(`old build wrote schema ${String(oldSummary.productSchema)}, expected 12`)
    if (oldSummary.formatVersion !== 1 || oldSummary.routingEvidence.status !== 'unavailable')
      throw new Error('schema-12 state must describe itself as legacy evidence without routing payload')
    const oldBackup = oldPa(['backup', '--json', '--out', join(root, 'schema12.pab'), ...oldInstallArgs(oldTarget)], { allowExit: [0] })
    if (oldBackup.json?.status !== 'CREATED') throw new Error('schema-12 backup failed')
    if (oldBackup.json.evidence?.formatVersion !== 1) throw new Error('schema-12 backup evidence must be format 1')

    const upgradeRoots = roots('upgraded', configNew)
    newPa(['first-run', '--json', ...installArgs(installNew, upgradeRoots)], { allowExit: [0] })
    // Restore always targets a fresh private state directory; the runtime roots stay shared.
    const upgradeTarget = { ...upgradeRoots, data: join(root, 'upgraded-state') }
    const upgradeRestore = newPa(['restore', '--json', '--bundle', join(root, 'schema12.pab'), '--to', upgradeTarget.data, ...installArgs(installNew, upgradeRoots)], { allowExit: [0] })
    if (upgradeRestore.json?.report?.evidence?.status !== 'verified') throw new Error('schema-12 bundle restore did not verify the recorded evidence classes')
    if (upgradeRestore.json.report.evidence.legacyFormat !== true) throw new Error('schema-12 bundle restore must be labelled legacy evidence')
    if (upgradeRestore.json.report.database.productSchema !== 12) throw new Error('restore must preserve the bundle bytes/schema until first start')
    const health = await startAndStop(installNew, upgradeTarget, 'upgraded-first-start')
    void health
    const migratedSummary = readEvidenceSummary(join(upgradeTarget.data, 'state.sqlite'))
    if (migratedSummary.productSchema !== 13) throw new Error(`first start did not migrate to schema 13 (saw ${String(migratedSummary.productSchema)})`)
    if (migratedSummary.projects[0]?.id !== 'project-upgrade') throw new Error('migration lost the pre-upgrade project')
    if (migratedSummary.works[0]?.id !== 'work-upgrade') throw new Error('migration lost the pre-upgrade work')
    if (migratedSummary.artifacts[0]?.digest !== oldSeeded.artifactDigest) throw new Error('migration lost the pre-upgrade artifact')
    if (migratedSummary.routingEvidence.status !== 'included') throw new Error('schema 13 state must expose routing evidence capability after migration')
    if (migratedSummary.routingEvidence.status === 'included' &&
      migratedSummary.routingEvidence.advice.length + migratedSummary.routingEvidence.reviews.length + migratedSummary.routingEvidence.outcomes.length !== 0)
      throw new Error('migration fabricated routing evidence rows')
    section('B-cross-version-data-upgrade', 'PASS', {
      claim: 'schema-12 bundle restored by the schema-13 build; append-only migration on first start keeps every user record and adds empty routing tables',
      fromSchema: 12,
      toSchema: migratedSummary.productSchema,
      oldBuildId,
      newBuildId: summaryNew.buildId,
      legacyEvidence: upgradeRestore.json.report.evidence.legacyFormat,
      projectPreserved: migratedSummary.projects[0]?.id,
      workPreserved: migratedSummary.works[0]?.id,
      artifactPreserved: migratedSummary.artifacts[0]?.digest === oldSeeded.artifactDigest,
      routingRowsFabricated: 0,
    })

    // ---- C. Real cross-version downgrade refusal ----
    const downgradeBackup = newPa(['backup', '--json', '--out', join(root, 'schema13.pab'), ...installArgs(installNew, upgradeTarget)], { allowExit: [0] })
    if (downgradeBackup.json?.evidence?.productSchema !== 13) throw new Error('schema-13 backup was not recorded as schema 13')
    const downgradeTarget = join(root, 'downgrade-target')
    const oldRestoreRoots = roots('old-restore')
    oldPa(['first-run', '--json', ...oldInstallArgs(oldRestoreRoots)], { allowExit: [0] })
    const downgradeRestore = oldPa(['restore', '--json', '--bundle', join(root, 'schema13.pab'), '--to', downgradeTarget, ...oldInstallArgs(oldRestoreRoots)], { allowExit: [2] })
    // An older build must refuse the newer bundle. It can notice either the newer schema or the newer
    // evidence payload first; both are a refusal, neither may create or rewrite the target.
    const refusalCode = downgradeRestore.json?.code
    if (!['schema_unsupported', 'manifest_invalid'].includes(refusalCode))
      throw new Error(`old build must refuse a newer schema bundle, got ${JSON.stringify(downgradeRestore.json).slice(0, 300)}`)
    if (refusalCode === 'manifest_invalid' && !/format version is unsupported/i.test(downgradeRestore.json?.message ?? ''))
      throw new Error('old build refused the newer bundle for an unrelated reason')
    if (existsSync(downgradeTarget)) throw new Error('refused downgrade restore created the target directory')
    const downgradeStart = oldPa(['start', '--fixture', '--json', '--port', String(await freePort()), '--api-port', String(await freePort()), ...oldInstallArgs(upgradeTarget)], { allowExit: [1, 2], timeout: 120_000 })
    if (downgradeStart.status === 0) throw new Error('the schema-12 build started on a schema-13 state')
    const startCode = downgradeStart.json?.code ?? 'daemon_start_failed'
    if (!['schema_unsupported', 'runtime_incompatible', 'daemon_start_failed'].includes(startCode))
      throw new Error(`unexpected old-build start code ${startCode}`)
    const bytesBeforeRefusal = sha256File(join(upgradeTarget.data, 'state.sqlite'))
    const stillSchema13 = readEvidenceSummary(join(upgradeTarget.data, 'state.sqlite'))
    if (stillSchema13.productSchema !== 13) throw new Error('the refused old build down-migrated or rewrote the state')
    if (sha256File(join(upgradeTarget.data, 'state.sqlite')) !== bytesBeforeRefusal) throw new Error('the refused old build modified the state bytes')
    section('C-cross-version-downgrade-refusal', 'PASS', {
      claim: 'a schema-13 state/bundle is refused by the schema-12 build; no down-migration, no data deletion, no silent open',
      oldBuildId,
      newBuildId: summaryNew.buildId,
      restoreCode: refusalCode,
      restoreMessage: downgradeRestore.json.message,
      startCode,
      stateBytesUnchanged: true,
      schemaAfterRefusal: stillSchema13.productSchema,
    })
  }

  evidence.status = Object.values(evidence.sections).every((entry) => entry.status === 'PASS') ? 'PASS' : 'PARTIAL'
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = String(error?.stack ?? error)
} finally {
  evidence.finishedAt = new Date().toISOString()
  evidence.limitations = [
    'Section A is a rebuild/tag comparison of one source: it proves the data round-trip, not a version migration.',
    'Sections B/C use one frozen older install artifact (schema 12) and one current build (schema 13) on darwin/arm64 only; other platforms, ABIs and intermediate schema versions are NOT_TESTED.',
    'Rollback restores state bytes; it does not downgrade installed binaries and is not a downgrade path.',
    'No user service, native executor or model call; all roots and ports are isolated.',
  ]
  rmSync(root, { recursive: true, force: true })
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
