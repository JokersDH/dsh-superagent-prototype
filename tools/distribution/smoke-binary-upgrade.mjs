#!/usr/bin/env node
/**
 * Wave-07 D3: real binary switch between two distribution installs, data protection and failure
 * recovery. This is the recipe E can re-run with its own frozen pair.
 *
 * Two installs must be genuinely different builds (different buildId/source). The script:
 *   A. runs the baseline install, writes pre-upgrade business data, backs it up;
 *   B. switches to the target install through `<baseline>/bin/pa upgrade` (verify target bytes, stop
 *      exactly the recorded instance, pre-upgrade backup, pointer swap, start target, verify identity);
 *   C. writes post-upgrade records and proves they survive a binary-only rollback (no data rollback);
 *   D. proves a schema-incompatible older binary refuses the newer state instead of deleting it;
 *   E. exercises failure windows: tampered target, running switch, unverified live instance, unhealthy
 *      target, crash after pointer swap + recovery, duplicate request.
 *
 * Everything runs in isolated temp roots/ports. No user service, no model call, no author checkout
 * dependency for the installed binaries (the seeding helper only uses package dists).
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { readEvidenceSummary } from '../../packages/portability/dist/index.js'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const { values } = parseArgs({
  options: {
    baseline: { type: 'string', default: process.env.PA_BASELINE_INSTALL ?? '/Users/hh/Desktop/joker/pa-artifacts/wave06-alpha2/install' },
    target: { type: 'string' },
    'old-schema-install': { type: 'string', default: process.env.PA_SCHEMA12_INSTALL ?? '/Users/hh/Desktop/joker/pa-artifacts/wave06-final/install' },
    json: { type: 'boolean', default: false },
  },
})
const evidence = { case: 'WAVE07-BINARY-UPGRADE', status: 'FAIL', startedAt: new Date().toISOString(), sections: {} }
// Only processes this run started under its own temp root may be cleaned up in `finally`.
const startedPids = new Set()
const section = (id, status, detail) => {
  evidence.sections[id] = { status, ...(detail === undefined ? {} : { detail }) }
  if (!values.json) process.stderr.write(`${status} ${id}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 220)}`}\n`)
}

const root = mkdtempSync(join(tmpdir(), 'pa-wave07-upgrade-'))
const freePort = () => new Promise((resolvePort, reject) => {
  const socket = createServer()
  socket.once('error', reject)
  socket.listen(0, '127.0.0.1', () => {
    const port = socket.address().port
    socket.close(() => resolvePort(port))
  })
})
const run = (binary, args, options = {}) => {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: options.timeout ?? 300_000, cwd: options.cwd ?? REPO, env: options.env ?? process.env })
  let json = null
  try { json = JSON.parse(result.stdout) } catch { json = null }
  if (options.allowExit !== undefined && !options.allowExit.includes(result.status))
    throw new Error(`${binary.split('/').slice(-2).join('/')} ${args.slice(0, 3).join(' ')} exit ${result.status}\n${result.stdout}\n${result.stderr}`)
  return { ...result, json }
}
const copyInstall = (source, name) => {
  const destination = join(root, name)
  cpSync(source, destination, { recursive: true })
  for (const relative of ['var/config', 'var/data', 'var/cache', 'var/logs', 'var/workspaces']) {
    const path = join(destination, relative)
    if (existsSync(path)) chmodSync(path, 0o700)
  }
  return destination
}
const alivePid = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
// A pristine baseline install is extracted once from its frozen tar for the failure-window sections:
// the shared baseline directory accumulates section A-C pointer history, and the frozen baseline
// predates config-root adoption, so each window needs untouched shipped bytes + its own first-run.
const extractPristine = (tarPath, name) => {
  const destination = join(root, name)
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  const listing = spawnSync('tar', ['-tzf', tarPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (listing.status !== 0) throw new Error(`tar list failed: ${listing.stderr}`)
  for (const entry of listing.stdout.split('\n').filter(Boolean))
    if (entry.startsWith('/') || entry.split('/').includes('..')) throw new Error(`unsafe tar entry ${entry}`)
  const result = spawnSync('tar', ['-xzf', tarPath, '-C', destination], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`tar extract failed: ${result.stderr}`)
  const entries = readdirSync(destination)
  const install = join(destination, entries.length === 1 ? entries[0] : '')
  if (!existsSync(join(install, 'install.json'))) throw new Error('pristine baseline tar has no install manifest')
  return install
}
const rootsFor = (install, name) => ({
  install: join(install, 'app'),
  config: join(install, 'var/config'),
  data: join(root, `${name}-state`),
  cache: join(root, `${name}-cache`),
  logs: join(root, `${name}-logs`),
  workspace: join(root, `${name}-workspace`),
})
const rootArgs = (r) => ['--install', r.install, '--config-root', r.config, '--data-root', r.data, '--cache-root', r.cache, '--logs-root', r.logs, '--workspace-root', r.workspace]
// The install pointer moves during the switch; every command is told which install it now addresses.
let currentApp = null
const switchTo = (install, app) => { currentApp = app ?? join(install, 'app'); return currentApp }
const cli = (install) => join(install, 'bin', 'pa')
const rootOverrides = (r) => ['--config-root', r.config, '--data-root', r.data, '--cache-root', r.cache, '--logs-root', r.logs, '--workspace-root', r.workspace]
// Stop through the install that the record itself names; a different requested install must refuse.
const stopOwned = (r) => {
  let installRoot = dirname(r.install)
  try {
    const record = JSON.parse(readFileSync(join(r.config, 'instance.json'), 'utf8'))
    if (typeof record.install === 'string') installRoot = dirname(record.install)
  } catch { /* no record: the requested install is fine */ }
  try { return run(cli(installRoot), ['stop', '--json', ...rootOverrides(r)], { allowExit: [0, 2], timeout: 60_000 }) }
  catch (error) {
    let record = null
    try { record = JSON.parse(readFileSync(join(r.config, 'instance.json'), 'utf8')) } catch { /* none */ }
    throw new Error(`${error.message} | installRoot=${installRoot} exists=${existsSync(cli(installRoot))} record=${JSON.stringify(record)?.slice(0, 300)}`)
  }
}

async function startInstance(install, r, label, extra = {}) {
  const consolePort = extra.consolePort ?? (await freePort())
  let apiPort = extra.apiPort ?? (await freePort())
  if (apiPort === consolePort) apiPort = await freePort()
  const out = join(root, `start-${label}.out.log`)
  const err = join(root, `start-${label}.err.log`)
  const outFd = openSync(out, 'w', 0o600)
  const errFd = openSync(err, 'w', 0o600)
  const child = spawn(cli(install), ['start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort), ...rootArgs(r)], {
    cwd: install, stdio: ['ignore', outFd, errFd], detached: true,
  })
  // The instance must outlive this script; unref keeps the Node event loop free to exit.
  child.unref()
  closeSync(outFd)
  closeSync(errFd)
  const deadline = Date.now() + 60_000
  let health = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/v1/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok) { health = await response.json(); break }
    } catch { /* not ready */ }
    if (child.exitCode !== null) break
    await new Promise((r2) => setTimeout(r2, 120))
  }
  if (health === null) {
    const tail = (() => { try { return `${readFileSync(out, 'utf8').slice(-800)}\n${readFileSync(err, 'utf8').slice(-800)}` } catch { return 'no logs' } })()
    throw new Error(`${label} did not become healthy (exit ${child.exitCode})\n${tail}`)
  }
  // Wait for the instance record to bind to this exact API URL; health can answer a moment earlier.
  let record = null
  const recordDeadline = Date.now() + 10_000
  while (Date.now() < recordDeadline) {
    const candidate = instanceOf(r)
    if (candidate !== null && candidate.apiURL === `http://127.0.0.1:${apiPort}`) { record = candidate; break }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  if (record === null) throw new Error(`${label} did not record its instance (api ${apiPort})`)
  startedPids.add(record.pid)
  startedPids.add(record.apiPid)
  const stop = () => stopOwned(r)
  return { child, apiPort, consolePort, health, record, stop, apiURL: `http://127.0.0.1:${apiPort}` }
}

const instanceOf = (r) => {
  const path = join(r.config, 'instance.json')
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}
const statePath = (r) => join(r.data, 'state.sqlite')
const evidenceOf = (r) => readEvidenceSummary(statePath(r))

// The state must be written by the build that owns the schema: a schema-15 store cannot seed a
// schema-13 baseline (and the recipe must not silently migrate it with the author checkout).
async function storeFor(install) {
  const module = await import(pathToFileURL(join(install, 'app', 'packages', 'storage', 'dist', 'index.js')).href)
  return module.ProductStore
}

async function seed(r, install, projectId, workId, marker) {
  const Store = await storeFor(install)
  const store = new Store({ path: statePath(r) })
  try {
    const now = new Date().toISOString()
    // Each seed call uses a fresh project id, so a duplicate append never happens here.
    store.workflows.projects.append({ projectId, expectedRevision: 0, settings: { pathDigest: marker.repeat(64).slice(0, 64), check: 'node_test', sourceRef: marker }, createdAt: now })
    store.product.works.insert({ id: workId, projectId, conversationId: `conv-${workId}`, title: `work ${workId}`, createdAt: now })
    const artifact = store.artifacts.write(Buffer.from(`payload ${marker}\n`))
    store.artifacts.insert(artifact)
    return { artifactDigest: artifact.digest, artifactId: artifact.id }
  } finally {
    store.close()
  }
}

try {
  if (!existsSync(cli(values.baseline))) throw new Error(`baseline install is missing: ${values.baseline}`)
  const baseline = copyInstall(values.baseline, 'baseline-install')
  const baselineManifest = JSON.parse(readFileSync(join(baseline, 'install.json'), 'utf8'))

  // Build/copy the target install. A frozen --target is used as-is; otherwise build from this tree.
  let targetSource = values.target
  if (targetSource === undefined) {
    targetSource = join(root, 'built-target')
    const built = run(process.execPath, [join(REPO, 'tools/distribution/build.mjs'), '--install-root', REPO, '--config-root', join(root, 'target-config'), '--output', targetSource, '--json'], { allowExit: [0] })
    if (built.json.status !== 'OK') throw new Error('target build failed')
  }
  const target = copyInstall(targetSource, 'target-install')
  const targetManifest = JSON.parse(readFileSync(join(target, 'install.json'), 'utf8'))
  if (targetManifest.buildId === baselineManifest.buildId)
    throw new Error('baseline and target are the same build; a tag-only rebuild cannot prove a binary switch')
  if (targetManifest.source.commit === baselineManifest.source.commit)
    throw new Error('baseline and target share a source commit; the switch must cross two real sources')
  // A private config root bound to the target install, used for target-only diagnostics such as the
  // future-schema refusal (the switch itself keeps sharing the baseline config root).
  const baselineTar = values['baseline-tar'] ?? (() => {
    const dir = dirname(values.baseline)
    const found = readdirSync(dir).filter((name) => name.endsWith('.tar.gz'))
    if (found.length !== 1) throw new Error(`pass --baseline-tar explicitly; found ${found.length} tar(s) in ${dir}`)
    return join(dir, found[0])
  })()
  const pristineBaseline = extractPristine(baselineTar, 'pristine-baseline')
  const targetConfigRoot = join(root, 'target-config')
  run(cli(target), ['first-run', '--json', '--config-root', targetConfigRoot,
    '--data-root', join(root, 'target-probe-data'), '--cache-root', join(root, 'target-probe-cache'),
    '--logs-root', join(root, 'target-probe-logs'), '--workspace-root', join(root, 'target-probe-workspace')], { allowExit: [0] })

  const baselineSchema = baselineManifest.producer.productSchema
  const targetSchema = targetManifest.producer.productSchema
  section('installs', 'PASS', {
    baseline: { buildId: baselineManifest.buildId, commit: baselineManifest.source.commit, schema: baselineSchema, tarFamily: 'wave06-alpha2' },
    target: { buildId: targetManifest.buildId, commit: targetManifest.source.commit, schema: targetSchema },
    sourceDistinct: true,
    schemaChange: baselineSchema !== targetSchema ? `${baselineSchema}->${targetSchema}` : null,
  })

  const r = rootsFor(baseline, 'shared')
  switchTo(baseline)
  run(cli(baseline), ['first-run', '--json', ...rootArgs(r)], { allowExit: [0] })
  const seeded = await seed(r, baseline, 'project-upgrade', 'work-pre-upgrade', 'a')
  const beforeDigest = evidenceOf(r).digest
  let instance = await startInstance(baseline, r, 'baseline')
  if (instance.record.buildId !== baselineManifest.buildId) throw new Error('baseline instance did not record its own buildId')
  const preBackup = join(root, 'pre-upgrade.pab')
  run(cli(baseline), ['backup', '--json', '--out', preBackup, ...rootArgs(r)], { allowExit: [0] })
  section('A-baseline-state', 'PASS', {
    buildId: baselineManifest.buildId,
    evidenceDigest: beforeDigest,
    artifactDigest: seeded.artifactDigest,
    backup: sha256File(preBackup),
  })

  // ---- B. switch to the target binary ----
  const upgradeBackup = join(root, 'switch-backup.pab')
  const switched = run(cli(target), ['upgrade', '--json', '--to', target, '--backup', upgradeBackup, ...rootArgs(r)], { allowExit: [0] })
  if (switched.json?.status !== 'CONFIRMED') throw new Error(`upgrade did not confirm: ${JSON.stringify(switched.json).slice(0, 400)}`)
  if (switched.json.plan.to.buildId !== targetManifest.buildId) throw new Error('switch plan recorded the wrong target build')
  const afterSwitch = instanceOf(r)
  if (afterSwitch?.buildId !== targetManifest.buildId) throw new Error('the running instance is not the target build')
  if (switched.json.started.pid !== afterSwitch.pid) throw new Error('switch result does not match the recorded instance pid')
  // Consumer assertion, not argv inspection: the running product must still be the same mode/access.
  if (afterSwitch.mode !== 'fixture' || afterSwitch.access !== 'local-development')
    throw new Error(`the switch changed the instance identity: ${afterSwitch.mode}/${afterSwitch.access}`)
  const targetModeHealth = await fetch(`${afterSwitch.apiURL}/v1/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null)
  const targetModeBody = targetModeHealth?.ok === true ? await targetModeHealth.json() : null
  if (targetModeBody?.mode !== 'fixture') throw new Error(`target health reports mode ${targetModeBody?.mode ?? 'unknown'}, expected fixture`)
  const afterSwitchEvidence = evidenceOf(r)
  if (!afterSwitchEvidence.projects.some((project) => project.id === 'project-upgrade')) throw new Error('switching lost the pre-upgrade project')
  if (!afterSwitchEvidence.works.some((work) => work.id === 'work-pre-upgrade')) throw new Error('switching lost the pre-upgrade work')
  if (afterSwitchEvidence.artifacts[0]?.digest !== seeded.artifactDigest) throw new Error('switching lost the pre-upgrade artifact')
  // A schema-changing target may legitimately migrate metadata on first start, so the raw evidence
  // digest can differ; business rows must survive. When nothing migrates, the digest must be identical.
  const schemaAfterSwitch = afterSwitchEvidence.productSchema
  const schemaChanged = schemaAfterSwitch !== baselineSchema
  if (!schemaChanged && afterSwitchEvidence.digest !== beforeDigest) throw new Error('the switch changed business evidence without a schema change')
  if (schemaChanged && (afterSwitchEvidence.projects.length < 1 || afterSwitchEvidence.works.length < 1)) throw new Error('schema migration lost business rows')
  const targetHealth = await fetch(`http://127.0.0.1:${afterSwitch.apiURL.split(':').pop()}/v1/health`).catch(() => null)
  if (targetHealth?.ok !== true) throw new Error('target API is not healthy after the switch')
  const journal = JSON.parse(readFileSync(join(r.config, 'install-switch.json'), 'utf8'))
  if (journal.status !== 'confirmed') throw new Error('switch journal is not confirmed')
  if (journal.dataRolledBack === true) throw new Error('switch journal claims a data rollback')
  switchTo(target)
  const bindingBuild = JSON.parse(readFileSync(join(r.config, 'release.json'), 'utf8')).buildId
  if (bindingBuild !== targetManifest.buildId) throw new Error('config root is not bound to the target build')
  section('B-binary-switch', 'PASS', {
    from: baselineManifest.buildId, to: targetManifest.buildId,
    stopped: switched.json.stopped?.status ?? null,
    backup: { path: switched.json.backup.path, sha256: switched.json.backup.sha256 },
    instance: { pid: afterSwitch.pid, buildId: afterSwitch.buildId },
    evidenceDigestBefore: beforeDigest, evidenceDigestAfter: afterSwitchEvidence.digest,
    schema: { before: baselineSchema, after: schemaAfterSwitch },
    mode: { record: afterSwitch.mode, health: targetModeBody?.mode ?? null },
    access: afterSwitch.access,
    dataRolledBack: journal.dataRolledBack === true,
  })

  // ---- C. post-upgrade data, binary-only rollback, and a schema-changing pair ----
  const stopTarget = stopOwned(r)
  if (stopTarget.json?.status !== 'STOPPED') throw new Error('target instance did not stop for the post-upgrade write')
  const postUpgrade = await seed(r, target, 'project-post-upgrade', 'work-post-upgrade', 'b')
  const afterWrite = evidenceOf(r)
  const rolled = run(cli(target), ['rollback-install', '--json', ...rootArgs(r)], { allowExit: [0] })
  if (rolled.json?.status !== 'BINARY_ROLLED_BACK') throw new Error('rollback-install did not report BINARY_ROLLED_BACK')
  if (rolled.json.dataRolledBack !== false) throw new Error('binary rollback must not roll data back')
  const pointerAfterRollback = JSON.parse(readFileSync(join(r.config, 'release.json'), 'utf8')).buildId
  if (pointerAfterRollback !== baselineManifest.buildId) throw new Error('binary rollback did not restore the baseline install pointer')
  switchTo(baseline)
  const schema14or15 = afterWrite.productSchema
  let oldBinaryRefusal = null
  if (schema14or15 > baselineSchema) {
    // The older binary must refuse the newer state exactly, without starting a writer or rewriting it.
    const refusal = run(cli(baseline), ['start', '--json', '--port', String(await freePort()), '--api-port', String(await freePort()), ...rootArgs(r)], { allowExit: [2, 1] })
    const readerMessage = /MigrationIntegrityError: Applied migration (\d+) is not registered in this build/
    // The launcher tail is bounded, so inspect the daemon log itself for the exact storage refusal.
    const daemonLogs = readdirSync(r.logs).filter((name) => name.endsWith('.log')).map((name) => join(r.logs, name))
    let readerMatched = null
    for (const path of daemonLogs) {
      const match = readerMessage.exec(readFileSync(path, 'utf8'))
      if (match !== null) { readerMatched = Number(match[1]); break }
    }
    const storageRefusal = readerMatched !== null
    oldBinaryRefusal = {
      code: refusal.json?.code ?? null, stateSchema: refusal.json?.detail?.stateSchema ?? null,
      binarySchema: refusal.json?.detail?.binarySchema ?? null,
      layer: refusal.json?.code === 'state_schema_newer_than_binary' ? 'launcher_preflight' : storageRefusal ? 'daemon_storage_reader' : 'other',
      firstUnregisteredMigration: readerMatched,
    }
    if (!['state_schema_newer_than_binary', 'daemon_start_failed'].includes(oldBinaryRefusal.code) || (oldBinaryRefusal.code === 'daemon_start_failed' && !storageRefusal))
      throw new Error(`older binary did not refuse the newer state exactly: ${JSON.stringify(refusal.json).slice(0, 300)}`)
    if (instanceOf(r) !== null) throw new Error('the refused older binary left an instance record')
    if (evidenceOf(r).productSchema !== schema14or15) throw new Error('the refused older binary changed the state schema')
  } else {
    const startedOld = await startInstance(baseline, r, 'baseline-after-rollback')
    if (instanceOf(r)?.buildId !== baselineManifest.buildId) throw new Error('baseline did not start after the binary rollback')
    void startedOld
  }
  // A compatible install for the current state is the target again; switching back is the only way to
  // read the post-upgrade rows after a schema change (never a silent data rollback).
  if (schema14or15 > baselineSchema) {
    const back = run(cli(target), ['upgrade', '--json', '--to', target, '--backup', join(root, 'c-reswitch.pab'), ...rootArgs(r)], { allowExit: [0], timeout: 600_000 })
    if (back.json?.status !== 'CONFIRMED') throw new Error(`re-switch to the compatible target did not confirm: ${JSON.stringify(back.json).slice(0, 300)}`)
    switchTo(target)
  }
  const compatible = evidenceOf(r)
  if (!compatible.projects.some((project) => project.id === 'project-post-upgrade')) throw new Error('binary rollback lost post-upgrade projects')
  if (!compatible.works.some((work) => work.id === 'work-post-upgrade')) throw new Error('binary rollback lost post-upgrade work')
  if (!compatible.artifacts.some((artifact) => artifact.digest === postUpgrade.artifactDigest)) throw new Error('binary rollback lost the post-upgrade artifact')
  section('C-post-upgrade-data-protection', 'PASS', {
    postUpgradeEvidence: afterWrite.digest,
    binaryRollback: { pointer: pointerAfterRollback, dataRolledBack: false, olderBinaryRefusal: oldBinaryRefusal },
    schemaBefore: baselineSchema, schemaAfter: schema14or15,
    postUpgradeDataIntact: true,
    note: schema14or15 > baselineSchema
      ? 'The schema-changing target migrated 13->' + schema14or15 + '; the old binary refused the newer state exactly and the same-version target read every post-upgrade row. Binary rollback never rolls data back.'
      : 'Both builds use one schema; the older binary reads the newer records. This is a binary-only rollback, never a data rollback.',
  })

  // ---- D. exact schema incompatibility (not a missing-artifact side effect) ----
  // The older binary is given its own valid config/release so the only mismatch is the state schema;
  // its real storage reader must refuse with the exact MigrationIntegrityError, and it must not leave
  // an instance record, listener or changed bytes behind.
  const schema12 = copyInstall(values['old-schema-install'], 'schema12-install')
  const schema12Roots = { install: join(schema12, 'app'), config: join(schema12, 'var/config'),
    data: join(root, 'schema12-data'), cache: join(root, 'schema12-cache'), logs: join(root, 'schema12-logs'), workspace: join(root, 'schema12-workspace') }
  run(cli(schema12), ['first-run', '--json', ...rootArgs(schema12Roots)], { allowExit: [0] })
  const schema12Manifest = JSON.parse(readFileSync(join(schema12, 'install.json'), 'utf8'))
  const stateBeforeRefusal = sha256File(statePath(r))
  const refusal = run(cli(schema12), ['start', '--fixture', '--json', '--port', String(await freePort()), '--api-port', String(await freePort()), '--data-root', r.data, '--cache-root', schema12Roots.cache, '--logs-root', schema12Roots.logs, '--workspace-root', schema12Roots.workspace], { allowExit: [1, 2], timeout: 180_000 })
  if (refusal.status === 0) throw new Error('the schema-12 binary started on a schema-13 state')
  const refusalText = `${refusal.stdout ?? ''}\n${refusal.stderr ?? ''}`
  const exactReaderRefusal = /MigrationIntegrityError: Applied migration \d+ is not registered in this build/.test(refusalText)
  if (!exactReaderRefusal)
    throw new Error(`the old schema reader did not refuse with the exact migration error: ${refusalText.slice(-600)}`)
  if (/release_artifact_missing/.test(refusalText))
    throw new Error('the old binary still failed for a release-artifact reason; that is not schema evidence')
  if (instanceOf(r)?.buildId === schema12Manifest.buildId) throw new Error('the refused old binary wrote an instance record')
  if (sha256File(statePath(r)) !== stateBeforeRefusal) throw new Error('the refused old binary rewrote the state')
  if (evidenceOf(r).productSchema !== targetSchema) throw new Error('the refused old binary changed the state schema')

  // The older build must also refuse a schema-13 backup bundle with the portability code, not by
  // crashing on missing artifacts.
  const schema13Bundle = join(root, 'schema13.pab')
  run(cli(target), ['backup', '--json', '--out', schema13Bundle, ...rootArgs({ ...r, install: join(target, 'app') })], { allowExit: [0] })
  const oldRestoreTarget = join(root, 'old-restore-target')
  const restoreRefusal = run(cli(schema12), ['restore', '--json', '--bundle', schema13Bundle, '--to', oldRestoreTarget, ...rootArgs(schema12Roots)], { allowExit: [2] })
  // The older build can notice the newer evidence payload before it reads the schema; either way it
  // is a refusal without a created target. Record exactly which layer refused instead of relabelling.
  const restoreRefusalCode = restoreRefusal.json?.code
  if (!['schema_unsupported', 'manifest_invalid'].includes(restoreRefusalCode))
    throw new Error(`old build restore did not refuse the newer bundle: ${JSON.stringify(restoreRefusal.json).slice(0, 300)}`)
  if (restoreRefusalCode === 'manifest_invalid' && !/format version is unsupported/i.test(restoreRefusal.json?.message ?? ''))
    throw new Error('old build refused the bundle for an unrelated reason')
  if (existsSync(oldRestoreTarget)) throw new Error('the refused restore created the target state')

  // The new binary must refuse a state from a future schema with an explicit code before spawning.
  const futureState = join(root, 'future-state')
  mkdirSync(futureState, { recursive: true, mode: 0o700 })
  cpSync(statePath(r), join(futureState, 'state.sqlite'))
  const FutureStore = await storeFor(target)
  const futureStore = new FutureStore({ path: join(futureState, 'state.sqlite') })
  try {
    futureStore.db.prepare("UPDATE schema_meta SET value = '99' WHERE key = 'product_schema'").run()
  } finally { futureStore.close() }
  const futureProbe = (() => { try { return readEvidenceSummary(join(futureState, 'state.sqlite')).productSchema } catch (error) { return `error:${error.code ?? error.message}` } })()
  if (futureProbe !== 99) throw new Error(`future-state fixture did not keep schema 99: ${String(futureProbe)}`)
  const futureStart = run(cli(target), ['start', '--fixture', '--json', '--port', String(await freePort()), '--api-port', String(await freePort()),
    '--install', join(target, 'app'), '--config-root', targetConfigRoot, '--data-root', futureState,
    '--cache-root', schema12Roots.cache, '--logs-root', schema12Roots.logs, '--workspace-root', schema12Roots.workspace], { allowExit: [2], timeout: 120_000 })
  if (futureStart.json?.code !== 'state_schema_newer_than_binary' || futureStart.json.detail?.stateSchema !== 99)
    throw new Error(`new binary did not refuse a future schema with the exact code: ${JSON.stringify(futureStart.json).slice(0, 300)}`)
  if (instanceOf(r)?.buildId !== undefined && instanceOf(r)?.state === futureState) throw new Error('the refused future-state start wrote an instance record')
  section('D-exact-schema-refusal', 'PASS', {
    oldBinary: schema12Manifest.buildId,
    oldReaderError: 'MigrationIntegrityError: Applied migration <n> is not registered in this build (daemon log)',
    oldRestoreCode: restoreRefusalCode,
    oldRestoreLayer: restoreRefusalCode === 'schema_unsupported' ? 'schema' : 'bundle_evidence_format',
    newBinaryFutureSchemaCode: futureStart.json.code,
    futureSchema: futureStart.json.detail.stateSchema,
    stateUnchanged: true,
    writerStarted: false,
  })

  // ---- E. failure windows on a fresh baseline state (schema13 -> target) ----
  const installWin = copyInstall(pristineBaseline, 'e-windows-install')
  const rWin = rootsFor(installWin, 'e-windows')
  run(cli(installWin), ['first-run', '--json', ...rootArgs(rWin)], { allowExit: [0] })
  await startInstance(installWin, rWin, 'e-windows')
  switchTo(installWin)

  // ---- E. failure windows ----
  // E1: tampered target install is refused before the running instance is stopped.
  const tampered = copyInstall(target, 'tampered-install')
  const tamperedFile = join(tampered, 'app/apps/console/dist/index.html')
  if (existsSync(tamperedFile)) {
    const bytes = readFileSync(tamperedFile)
    bytes[Math.floor(bytes.length / 2)] ^= 0xff
    writeFileSync(tamperedFile, bytes)
  } else {
    writeFileSync(tamperedFile, 'tampered')
  }
  const refusedTamper = run(cli(target), ['upgrade', '--json', '--to', tampered, '--backup', join(root, 'tamper-backup.pab'), ...rootArgs(rWin)], { allowExit: [2] })
  if (refusedTamper.json?.code !== 'target_tampered') throw new Error(`tampered target was not refused: ${JSON.stringify(refusedTamper.json).slice(0, 300)}`)
  if (instanceOf(rWin)?.buildId !== baselineManifest.buildId) throw new Error('a refused upgrade changed the running instance')
  const stillUp = await fetch(`${instanceOf(rWin).apiURL}/v1/health`, { signal: AbortSignal.timeout(1000) }).catch(() => null)
  if (stillUp?.ok !== true) throw new Error('a refused upgrade stopped the running instance')
  section('E1-tampered-target-refused', 'PASS', { code: refusedTamper.json.code, instanceStillRunning: true })

  // E2: a running instance cannot be switched without an explicit stop.
  const refusedRunning = run(cli(target), ['upgrade', '--json', '--to', target, '--no-stop', '--backup', join(root, 'no-stop.pab'), ...rootArgs(rWin)], { allowExit: [2] })
  if (refusedRunning.json?.code !== 'upgrade_requires_stopped_instance') throw new Error(`running switch was not refused: ${JSON.stringify(refusedRunning.json).slice(0, 300)}`)
  section('E2-running-switch-refused', 'PASS', { code: refusedRunning.json.code })

  // E3: an unverified live pid in the instance record is never killed and blocks the switch.
  const sleeper = spawn('sleep', ['30'], { stdio: 'ignore' })
  const recordPath = join(rWin.config, 'instance.json')
  const realRecord = JSON.parse(readFileSync(recordPath, 'utf8'))
  writeFileSync(recordPath, JSON.stringify({ ...realRecord, pid: sleeper.pid, apiPid: sleeper.pid, processStart: 'Mon Jan  1 00:00:00 2000' }))
  const refusedUnverified = run(cli(target), ['upgrade', '--json', '--to', target, '--backup', join(root, 'unverified.pab'), ...rootArgs(rWin)], { allowExit: [2] })
  // A record pointing at an unrelated live pid is blocked either by the preflight accounting
  // (unknown_live_resource) or by the record verification (instance_record_unverified); both mean the
  // switch did not stop or adopt the foreign process.
  if (!['instance_record_unverified', 'unknown_live_resource'].includes(refusedUnverified.json?.code))
    throw new Error(`unverified record was not blocked: ${JSON.stringify(refusedUnverified.json).slice(0, 300)}`)
  const sleeperAlive = (() => { try { process.kill(sleeper.pid, 0); return true } catch { return false } })()
  if (!sleeperAlive) throw new Error('an unverified live process was killed')
  writeFileSync(recordPath, JSON.stringify(realRecord))
  sleeper.kill('SIGKILL')
  section('E3-unverified-instance-blocked', 'PASS', { code: refusedUnverified.json.code, foreignProcessAlive: true })

  // E4: unhealthy target start reverts the install pointer and leaves data untouched.
  const healthFault = run(cli(target), ['upgrade', '--json', '--to', target, '--backup', join(root, 'health-fault.pab'), ...rootArgs(rWin)], { allowExit: [2], timeout: 180_000, env: { ...process.env, PA_UPGRADE_FAULT: 'target_unhealthy' } })
  if (healthFault.json?.code !== 'upgrade_target_unhealthy') throw new Error(`unhealthy target was not reported: ${JSON.stringify(healthFault.json).slice(0, 300)}`)
  const revertedPointer = JSON.parse(readFileSync(join(rWin.config, 'release.json'), 'utf8')).buildId
  if (revertedPointer !== baselineManifest.buildId) throw new Error('failed start did not revert the install pointer')
  // The fresh window has no business rows; a target boot may migrate metadata before the injected
  // health failure, so compare business content, not the raw evidence digest.
  const afterFault = evidenceOf(rWin)
  if (afterFault.projects.length !== 0 || afterFault.works.length !== 0 || afterFault.artifacts.length !== 0)
    throw new Error('failed start changed business rows in the fresh window')
  section('E4-unhealthy-target-reverted', 'PASS', {
    pointerAfterRevert: revertedPointer, dataUntouched: true,
    schema: { before: baselineSchema, after: afterFault.productSchema },
  })

  // E5: crash right after the pointer swap is recoverable.
  const crash = run(cli(target), ['upgrade', '--json', '--to', target, '--backup', join(root, 'crash-fault.pab'), ...rootArgs(rWin)], { allowExit: [2], env: { ...process.env, PA_UPGRADE_FAULT: 'crash_after_switch' } })
  if (crash.json?.code !== 'upgrade_interrupted') throw new Error(`crash injection was not reported: ${JSON.stringify(crash.json).slice(0, 300)}`)
  const pendingStatus = run(cli(target), ['upgrade-status', '--json', ...rootArgs(rWin)], { allowExit: [0] })
  if (pendingStatus.json?.status !== 'switched_unconfirmed') throw new Error('interrupted switch was not visible in upgrade-status')
  const recoveredSwitch = run(cli(target), ['upgrade', '--json', '--recover', ...rootArgs(rWin)], { allowExit: [0] })
  if (recoveredSwitch.json?.status !== 'RECOVERED') throw new Error(`switch recovery failed: ${JSON.stringify(recoveredSwitch.json).slice(0, 300)}`)
  if (instanceOf(rWin)?.buildId !== targetManifest.buildId) throw new Error('recovered switch did not start the target build')
  switchTo(target)
  section('E5-interrupted-switch-recovered', 'PASS', { status: recoveredSwitch.json.status, buildId: instanceOf(rWin).buildId })

  // E6: repeating the same switch is idempotent rather than a second switch.
  const duplicate = run(cli(target), ['upgrade', '--json', '--to', target, '--backup', join(root, 'duplicate.pab'), ...rootArgs(rWin)], { allowExit: [2] })
  if (duplicate.json?.code !== 'upgrade_already_applied') throw new Error(`duplicate upgrade was not rejected: ${JSON.stringify(duplicate.json).slice(0, 300)}`)
  section('E6-duplicate-refused', 'PASS', { code: duplicate.json.code })

  // ---- E7. a failed target whose stop cannot be proven keeps the indeterminate state ----
  {
    const install7 = copyInstall(pristineBaseline, 'e7-install')
    const r7 = rootsFor(install7, 'e7')
    // The pristine baseline ships its own release.json; its own first-run only creates the private
    // launcher config, so the window starts from the shipped inventory without hand-written bytes.
    run(cli(install7), ['first-run', '--json', ...rootArgs(r7)], { allowExit: [0] })
    await startInstance(install7, r7, 'e7')
    const unproven = run(cli(target), ['upgrade', '--json', '--to', install7, '--backup', join(root, 'e7.pab'), ...rootArgs(r7)],
      { allowExit: [2, 1], env: { ...process.env, PA_UPGRADE_FAULT: 'target_stop_unproven' } })
    const journal7 = JSON.parse(readFileSync(join(r7.config, 'install-switch.json'), 'utf8'))
    if (journal7.status !== 'target_stop_unproven') throw new Error(`unproven stop was not recorded: ${journal7.status}`)
    if (journal7.dataRolledBack === true) throw new Error('an unproven stop changed the data flag')
    const status7 = run(cli(target), ['upgrade-status', '--json', ...rootArgs(r7)], { allowExit: [0, 1] })
    if (status7.json?.status !== 'target_stop_unproven')
      throw new Error(`upgrade-status did not expose the indeterminate switch: ${JSON.stringify(status7.json).slice(0, 200)}`)
    // The staged wrapper injects its own --install; call the target launcher entry directly so the
    // doctor run addresses the baseline install that this window is currently bound to.
    const doctor7 = run(process.execPath, [join(target, 'app', 'apps', 'launcher', 'bin', 'pa.mjs'), 'doctor', '--json', ...rootArgs(r7)], { allowExit: [0, 1, 2] })
    const journalCheck = doctor7.json?.checks?.find((entry) => entry.id === 'upgrade_journal')
    if (journalCheck?.status !== 'WARN' || !/pa upgrade --recover/.test(journalCheck.detail?.hint ?? ''))
      throw new Error(`doctor did not surface the interrupted switch with one next action: ${JSON.stringify(journalCheck).slice(0, 200)}`)
    const recover7 = run(cli(target), ['upgrade', '--recover', '--json', ...rootArgs(r7)], { allowExit: [0, 1, 2] })
    if (!['REVERTED', 'RECOVERED'].includes(recover7.json?.status))
      throw new Error(`recovery did not settle the unproven stop: ${JSON.stringify(recover7.json).slice(0, 1400)}`)
    if (recover7.json?.dataRolledBack === true) throw new Error('settling the unproven stop rolled data back')
    section('E7-stop-unproven-kept', 'PASS', {
      refused: unproven.json?.code ?? null, journal: journal7.status,
      statusVisible: status7.json.status, doctor: journalCheck.status, settled: recover7.json.status,
    })
    stopOwned(r7)
  }

  // ---- E8. crash after stop, before the pointer swap: recovery restarts the previous release ----
  {
    const install8 = copyInstall(pristineBaseline, 'e8-install')
    const r8 = rootsFor(install8, 'e8')
    // The pristine baseline ships its own release.json; its own first-run only creates the private
    // launcher config, so the window starts from the shipped inventory without hand-written bytes.
    run(cli(install8), ['first-run', '--json', ...rootArgs(r8)], { allowExit: [0] })
    await startInstance(install8, r8, 'e8')
    run(cli(target), ['upgrade', '--json', '--to', install8, '--backup', join(root, 'e8.pab'), ...rootArgs(r8)],
      { allowExit: [2, 1], env: { ...process.env, PA_UPGRADE_FAULT: 'crash_after_stop' } })
    const journal8 = JSON.parse(readFileSync(join(r8.config, 'install-switch.json'), 'utf8'))
    if (!['stopping', 'switching'].includes(journal8.status)) throw new Error(`crash-after-stop was not recorded: ${journal8.status}`)
    if (JSON.parse(readFileSync(join(r8.config, 'release.json'), 'utf8')).buildId !== JSON.parse(readFileSync(join(install8, 'install.json'), 'utf8')).buildId)
      throw new Error('the pointer moved to the target even though the crash happened before adoption')
    const recover8 = run(cli(target), ['upgrade', '--recover', '--json', ...rootArgs(r8)], { allowExit: [0, 1, 2] })
    if (recover8.json?.status !== 'RECOVERED_PREVIOUS')
      throw new Error(`recovery did not restart the previous release: ${JSON.stringify(recover8.json).slice(0, 300)}`)
    const record8 = instanceOf(r8)
    if (record8?.buildId !== JSON.parse(readFileSync(join(install8, 'install.json'), 'utf8')).buildId)
      throw new Error('recovery after stop advanced to the target instead of restarting the previous release')
    section('E8-crash-after-stop-restarts-previous', 'PASS', {
      journal: journal8.status, recovered: recover8.json.status, buildId: record8.buildId, mode: record8.mode, access: record8.access,
    })
    stopOwned(r8)
  }

  // ---- E9. health answered but the instance record was never persisted ----
  {
    const install9 = copyInstall(pristineBaseline, 'e9-install')
    const r9 = rootsFor(install9, 'e9')
    // The pristine baseline ships its own release.json; its own first-run only creates the private
    // launcher config, so the window starts from the shipped inventory without hand-written bytes.
    run(cli(install9), ['first-run', '--json', ...rootArgs(r9)], { allowExit: [0] })
    await startInstance(install9, r9, 'e9')
    const fail9 = run(cli(target), ['upgrade', '--json', '--to', install9, '--backup', join(root, 'e9.pab'), ...rootArgs(r9)],
      { allowExit: [2, 1], env: { ...process.env, PA_UPGRADE_FAULT: 'target_record_missing' } })
    const journal9 = JSON.parse(readFileSync(join(r9.config, 'install-switch.json'), 'utf8'))
    if (journal9.status !== 'reverted_after_failed_start' || journal9.reason !== 'instance_record_missing')
      throw new Error(`record-missing window did not revert cleanly: ${journal9.status}/${journal9.reason}`)
    if (instanceOf(r9) !== null) throw new Error('record-missing window left an instance record')
    section('E9-record-missing-reverted', 'PASS', { journal: journal9.status, reason: journal9.reason, record: null, code: fail9.json?.code ?? null })
    stopOwned(r9)
  }

  // ---- E10. orphan API after the launcher died: the registered child is still stopped ----
  {
    const install10 = copyInstall(pristineBaseline, 'e10-install')
    const r10 = rootsFor(install10, 'e10')
    run(cli(install10), ['first-run', '--json', ...rootArgs(r10)], { allowExit: [0] })
    const instance10 = await startInstance(install10, r10, 'e10')
    process.kill(instance10.record.pid, 'SIGKILL')
    await new Promise((resolveWait) => setTimeout(resolveWait, 400))
    const orphanRecord = JSON.parse(readFileSync(join(r10.config, 'instance.json'), 'utf8'))
    if (!alivePid(orphanRecord.apiPid)) throw new Error('the API child did not survive the launcher kill; window not reproduced')
    const switch10 = run(cli(target), ['upgrade', '--json', '--to', target, '--backup', join(root, 'e10.pab'), ...rootArgs(r10)], { allowExit: [0], timeout: 600_000 })
    if (switch10.json?.status !== 'CONFIRMED') throw new Error(`orphan-API upgrade did not confirm: ${JSON.stringify(switch10.json).slice(0, 300)}`)
    if (alivePid(orphanRecord.apiPid)) throw new Error('the recorded orphan API child is still alive after the switch')
    const record10 = instanceOf(r10)
    if (record10?.buildId !== JSON.parse(readFileSync(join(target, 'install.json'), 'utf8')).buildId) throw new Error('orphan-API switch did not bind the target build')
    section('E10-orphan-api-stopped', 'PASS', {
      orphanApiPid: orphanRecord.apiPid, orphanStopped: true, stopped: switch10.json.stopped?.status ?? null, buildId: record10.buildId, mode: record10.mode,
    })
    stopOwned(r10)
  }

  // ---- E11. a live registered-looking process whose command does not verify stays UNKNOWN ----
  {
    const install11 = copyInstall(pristineBaseline, 'e11-install')
    const r11 = rootsFor(install11, 'e11')
    run(cli(install11), ['first-run', '--json', ...rootArgs(r11)], { allowExit: [0] })
    const instance11 = await startInstance(install11, r11, 'e11')
    process.kill(instance11.record.pid, 'SIGKILL')
    await new Promise((resolveWait) => setTimeout(resolveWait, 400))
    const record11 = JSON.parse(readFileSync(join(r11.config, 'instance.json'), 'utf8'))
    const stranger = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', detached: true })
    stranger.unref()
    startedPids.add(stranger.pid)
    // Replace the recorded API identity with the stranger: the pid is alive but its command/start do
    // not match the record, so the barrier must report unknown_live_resource instead of killing it.
    const tampered = { ...record11, apiPid: stranger.pid, apiProcessStart: undefined, apiArgv: undefined }
    writeFileSync(join(r11.config, 'instance.json'), JSON.stringify(tampered), { mode: 0o600 })
    const before11 = JSON.parse(readFileSync(join(r11.config, 'release.json'), 'utf8')).buildId
    const attempted = run(cli(target), ['upgrade', '--json', '--to', target, '--backup', join(root, 'e11.pab'), ...rootArgs(r11)], { allowExit: [1, 2] })
    if (attempted.json?.code !== 'unknown_live_resource')
      throw new Error(`unknown live target was not blocked with the exact code: ${JSON.stringify(attempted.json).slice(0, 300)}`)
    if (!alivePid(stranger.pid)) throw new Error('the unknown live process was killed instead of being left to the operator')
    if (JSON.parse(readFileSync(join(r11.config, 'release.json'), 'utf8')).buildId !== before11) throw new Error('the pointer moved while an unknown live target existed')
    section('E11-unknown-live-blocked', 'PASS', { code: attempted.json.code, strangerAlive: true, pointer: before11 })
    try { process.kill(stranger.pid, 'SIGKILL') } catch { /* gone */ }
    // The launcher was SIGKILLed earlier, so its real API child remains a live writer whose pid the
    // tampered record no longer names. It is still this test's own process: stop that exact pid, then
    // the recorded port has no unknown listener and the stale record can be collected truthfully.
    try { process.kill(instance11.record.apiPid, 'SIGKILL') } catch { /* gone */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 300))
    stopOwned(r11)
  }

  // ---- E12. re-entry with an unsettled journal is refused until --recover ----
  {
    const install12 = copyInstall(pristineBaseline, 'e12-install')
    const r12 = rootsFor(install12, 'e12')
    run(cli(install12), ['first-run', '--json', ...rootArgs(r12)], { allowExit: [0] })
    await startInstance(install12, r12, 'e12')
    run(cli(target), ['upgrade', '--json', '--to', target, '--backup', join(root, 'e12.pab'), ...rootArgs(r12)], { allowExit: [2, 1], env: { ...process.env, PA_UPGRADE_FAULT: 'crash_after_switch' } })
    const journal12 = JSON.parse(readFileSync(join(r12.config, 'install-switch.json'), 'utf8'))
    if (journal12.status !== 'switched_unconfirmed') throw new Error(`crash window not recorded: ${journal12.status}`)
    const reentry = run(cli(target), ['upgrade', '--json', '--to', target, '--backup', join(root, 'e12b.pab'), ...rootArgs(r12)], { allowExit: [2, 1] })
    if (reentry.json?.code !== 'upgrade_recover_required')
      throw new Error(`re-entry was not refused with the exact code: ${JSON.stringify(reentry.json).slice(0, 300)}`)
    const recovered = run(cli(target), ['upgrade', '--recover', '--json', ...rootArgs(r12)], { allowExit: [0, 1, 2] })
    if (!['RECOVERED', 'REVERTED', 'RECOVERED_PREVIOUS'].includes(recovered.json?.status)) throw new Error('recovery did not settle the crashed switch')
    section('E12-reentry-refused-until-recover', 'PASS', { reentry: reentry.json.code, journal: journal12.status, recovered: recovered.json.status })
    stopOwned(r12)
  }

  // ---- E13/E14. real SIGKILL windows: the upgrade process dies; the journal is the only witness ----
  {
    for (const [id, fault, expectedJournal, name] of [
      ['E13-kill-after-stop-recover', 'crash_after_stop_kill', 'stopped_before_switch', 'e13'],
      ['E14-kill-after-switch-recover', 'crash_after_switch_kill', 'switched_unconfirmed', 'e14'],
    ]) {
      const installK = copyInstall(pristineBaseline, `${name}-install`)
      const rK = rootsFor(installK, name)
      run(cli(installK), ['first-run', '--json', ...rootArgs(rK)], { allowExit: [0] })
      await startInstance(installK, rK, name)
      const killed = run(cli(target), ['upgrade', '--json', '--to', target, '--backup', join(root, `${name}.pab`), ...rootArgs(rK)], { allowExit: [null, 2, 1], env: { ...process.env, PA_UPGRADE_FAULT: fault } })
      if (killed.signal !== 'SIGKILL') throw new Error(`${id}: the upgrade process was not killed by SIGKILL (signal=${killed.signal}, status=${killed.status})`)
      const journalK = JSON.parse(readFileSync(join(rK.config, 'install-switch.json'), 'utf8'))
      const acceptable = expectedJournal === 'switched_unconfirmed' ? ['switched_unconfirmed', 'starting'] : ['stopped_before_switch', 'switching', 'stopped', 'reverted_after_interrupted_switch']
      if (!acceptable.includes(journalK.status)) throw new Error(`${id}: unexpected journal ${journalK.status}`)
      const reentry = run(cli(target), ['upgrade', '--json', '--to', target, '--backup', join(root, `${name}b.pab`), ...rootArgs(rK)], { allowExit: [1, 2] })
      if (reentry.json?.code !== 'upgrade_recover_required') throw new Error(`${id}: re-entry was not refused: ${JSON.stringify(reentry.json).slice(0, 300)}`)
      const recovered = run(cli(target), ['upgrade', '--recover', '--json', ...rootArgs(rK)], { allowExit: [0, 1, 2] })
      if (!['RECOVERED', 'REVERTED', 'RECOVERED_PREVIOUS'].includes(recovered.json?.status)) throw new Error(`${id}: recovery did not settle: ${JSON.stringify(recovered.json).slice(0, 300)}`)
      const after = JSON.parse(readFileSync(join(rK.config, 'install-switch.json'), 'utf8'))
      if (!['confirmed', 'binary_rolled_back', 'reverted_after_interrupted_switch', 'reverted_after_failed_start'].includes(after.status)) throw new Error(`${id}: recovery left a non-terminal journal ${after.status}`)
      const running = instanceOf(rK)
      if (running === null) throw new Error(`${id}: recovery left no verified running instance`)
      section(id, 'PASS', { signal: killed.signal, journalAfterKill: journalK.status, reentry: reentry.json.code, recovered: recovered.json.status, terminalJournal: after.status, buildId: running.buildId })
      stopOwned(rK)
    }
  }

  stopOwned(r)
  evidence.status = Object.values(evidence.sections).every((entry) => entry.status === 'PASS') ? 'PASS' : 'PARTIAL'
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = String(error?.stack ?? error)
} finally {
  evidence.finishedAt = new Date().toISOString()
  evidence.limitations = [
    'Both D wave-07 artifacts use product schema 13, so the binary rollback check is compatibility-preserving; the incompatible-direction proof uses the frozen schema-12 wave-06 build.',
    'Only darwin/arm64 + Node 24.21.x + SQLite ABI 137 is measured; other platforms/ABIs are NOT_TESTED.',
    'Reverting the install pointer is a binary rollback: data is never rolled back or deleted. Explicit `pa rollback --bundle`/`pa restore` is the only data-return path and preserves the original state.',
    'No user service (5180-5185/8796-8801) was started or stopped; all roots/ports are isolated.',
  ]
  // Stop anything this run left behind: the pid must still be one of ours according to its command
  // line (the temp root is unique), so a reused pid or a foreign process is never killed.
  for (const pid of startedPids) {
    try {
      const command = spawnSync('ps', ['-ww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout ?? ''
      if (command.includes(root)) process.kill(pid, 'SIGKILL')
    } catch { /* already gone */ }
  }
  rmSync(root, { recursive: true, force: true })
  void resolve
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
