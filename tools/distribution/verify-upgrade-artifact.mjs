#!/usr/bin/env node
/**
 * E-consumable, checkout-independent acceptance for the two frozen wave-07 installs.
 *
 * It never uses this repository at runtime: both installs are extracted from the frozen tars into an
 * E-owned root, then the installed launcher/coordinator are what run. The recipe proves:
 *   install/doctor/static workbench -> backup -> exact binary switch -> target identity -> binary-only
 *   rollback -> baseline runs again on post-upgrade data -> stop. It does not seed business rows
 *   (that needs product commands, which are main-owned) and does not claim data migration.
 *
 *   node tools/distribution/verify-upgrade-artifact.mjs \
 *     --baseline-tar <wave06-alpha2 tar> --target-tar <wave07-target tar> \
 *     --baseline-sha256 <sha256> --target-sha256 <sha256> [--json]
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    'baseline-tar': { type: 'string' },
    'target-tar': { type: 'string' },
    'baseline-sha256': { type: 'string' },
    'target-sha256': { type: 'string' },
    'work-root': { type: 'string' },
    'schema-change': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
})
if (values['baseline-tar'] === undefined || values['target-tar'] === undefined) {
  process.stderr.write('verify-upgrade-artifact 需要 --baseline-tar 与 --target-tar\n')
  process.exit(3)
}
const schemaChange = values['schema-change'] === true
const evidence = { case: schemaChange ? 'WAVE09-ARTIFACT-UPGRADE' : 'WAVE07-ARTIFACT-UPGRADE', status: 'FAIL', startedAt: new Date().toISOString(), steps: [] }
const step = (id, status, detail) => {
  evidence.steps.push({ id, status, ...(detail === undefined ? {} : { detail }) })
  if (values.json !== true) process.stderr.write(`${status} ${id}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 200)}`}\n`)
}
const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const workRoot = values['work-root'] === undefined ? mkdtempSync(join(tmpdir(), 'pa-e-upgrade-')) : resolve(values['work-root'])
const cleanup = values['work-root'] === undefined
const freePort = () => new Promise((resolvePort, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(() => resolvePort(port))
  })
})
const waitForInstance = async (configRoot, buildId) => {
  const path = join(configRoot, 'instance.json')
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const record = JSON.parse(readFileSync(path, 'utf8'))
      if (record.buildId === buildId) return record
    } catch { /* not written yet */ }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`no instance record for build ${buildId} in ${configRoot}`)
}
const run = (binary, args, options = {}) => {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: options.timeout ?? 300_000, cwd: options.cwd ?? workRoot })
  let json = null
  try { json = JSON.parse(result.stdout) } catch { json = null }
  if (options.allowExit !== undefined && !options.allowExit.includes(result.status))
    throw new Error(`${binary} ${args.slice(0, 3).join(' ')} exit ${result.status}\n${result.stdout}\n${result.stderr}`)
  return { ...result, json }
}
const extract = (tarPath, name) => {
  const target = join(workRoot, name)
  mkdirSync(target, { recursive: true, mode: 0o700 })
  const listed = spawnSync('tar', ['-tzf', tarPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (listed.status !== 0) throw new Error(`tar list failed: ${listed.stderr}`)
  for (const entry of listed.stdout.split('\n').filter(Boolean)) {
    if (entry.startsWith('/') || entry.split('/').includes('..')) throw new Error(`unsafe tar entry ${entry}`)
  }
  const extracted = spawnSync('tar', ['-xzf', tarPath, '-C', target], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (extracted.status !== 0) throw new Error(`tar extract failed: ${extracted.stderr}`)
  const entries = readdirSync(target)
  const installDir = join(target, entries.length === 1 ? entries[0] : '')
  if (!existsSync(join(installDir, 'install.json'))) throw new Error(`extracted tar has no install manifest (${target})`)
  for (const relative of ['var/config', 'var/data', 'var/cache', 'var/logs', 'var/workspaces']) {
    const path = join(installDir, relative)
    if (existsSync(path)) spawnSync('chmod', ['700', path])
  }
  return { root: target, installDir, manifest: JSON.parse(readFileSync(join(installDir, 'install.json'), 'utf8')) }
}

async function main() {
  for (const [flag, expected] of [['baseline-sha256', values['baseline-sha256']], ['target-sha256', values['target-sha256']]]) {
    if (expected === undefined) continue
    const path = flag === 'baseline-sha256' ? values['baseline-tar'] : values['target-tar']
    const actual = sha256File(path)
    if (actual !== expected) throw new Error(`${flag} mismatch: ${actual} != ${expected}`)
  }
  const baseline = extract(resolve(values['baseline-tar']), 'baseline')
  const target = extract(resolve(values['target-tar']), 'target')
  if (baseline.manifest.buildId === target.manifest.buildId) throw new Error('the two artifacts are the same build')
  if (baseline.manifest.source.commit === target.manifest.source.commit) throw new Error('the two artifacts share one source commit')
  step('extract-verify', 'PASS', {
    baseline: { buildId: baseline.manifest.buildId, commit: baseline.manifest.source.commit, files: baseline.manifest.files.length },
    target: { buildId: target.manifest.buildId, commit: target.manifest.source.commit, files: target.manifest.files.length },
    tarSha256: { baseline: sha256File(values['baseline-tar']), target: sha256File(values['target-tar']) },
  })

  const roots = {
    install: join(baseline.installDir, 'app'),
    config: join(baseline.installDir, 'var/config'),
    data: join(workRoot, 'state'),
    cache: join(workRoot, 'cache'),
    logs: join(workRoot, 'logs'),
    workspace: join(workRoot, 'workspace'),
  }
  const stateArgs = (currentRoots) => ['--install', currentRoots.install, '--config-root', currentRoots.config,
    '--data-root', currentRoots.data, '--cache-root', currentRoots.cache,
    '--logs-root', currentRoots.logs, '--workspace-root', currentRoots.workspace]
  const baselineCli = join(baseline.installDir, 'bin', 'pa')
  const targetCli = join(target.installDir, 'bin', 'pa')

  const firstRun = run(baselineCli, ['first-run', '--json', ...stateArgs(roots)], { allowExit: [0] })
  if (firstRun.json?.status !== 'OK') throw new Error(`baseline first-run failed: ${JSON.stringify(firstRun.json).slice(0, 300)}`)
  // The frozen baseline (wave-06) predates the release-adoption report, so the binding is read from
  // the manifest instead. Either way the config root must describe this exact install build.
  const boundRelease = JSON.parse(readFileSync(join(roots.config, 'release.json'), 'utf8'))
  if (boundRelease.buildId !== baseline.manifest.buildId)
    throw new Error(`baseline config root is not bound to its own build: ${boundRelease.buildId} != ${baseline.manifest.buildId}`)
  const doctorBefore = run(baselineCli, ['doctor', '--json', ...stateArgs(roots)], { allowExit: [0, 1] })
  if (doctorBefore.json.checks.some((entry) => entry.status === 'FAIL'))
    throw new Error(`baseline doctor reported FAIL before start: ${JSON.stringify(doctorBefore.json.checks.filter((entry) => entry.status === 'FAIL')).slice(0, 400)}`)
  step('baseline-first-run-doctor', 'PASS', { release: boundRelease.buildId, doctor: doctorBefore.json.status })

  const consolePort = await freePort()
  let apiPort = await freePort()
  if (apiPort === consolePort) apiPort = await freePort()
  const outFd = openSync(join(workRoot, 'start-baseline.out.log'), 'w', 0o600)
  const errFd = openSync(join(workRoot, 'start-baseline.err.log'), 'w', 0o600)
  const child = spawn(baselineCli, ['start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort), ...stateArgs(roots)], {
    cwd: baseline.installDir, stdio: ['ignore', outFd, errFd], detached: true,
  })
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
    await new Promise((r) => setTimeout(r, 150))
  }
  if (health === null) throw new Error('baseline instance did not become healthy')
  const page = await fetch(`http://127.0.0.1:${consolePort}/`).catch(() => null)
  if (page?.ok !== true) throw new Error('static workbench did not answer')
  if (!(await page.text()).includes('<div id="root">')) throw new Error('static workbench is not the product console')
  const baselineRecord = await waitForInstance(roots.config, baseline.manifest.buildId)
  const lsofBefore = spawnSync('lsof', ['-p', String(baselineRecord.apiPid), '-Fn'], { encoding: 'utf8' }).stdout
  step('baseline-start-workbench', 'PASS', { api: `http://127.0.0.1:${apiPort}`, workbench: true, openFilesSampled: lsofBefore.split('\n').length })

  const preBackup = join(workRoot, 'pre-upgrade.pab')
  const backup = run(baselineCli, ['backup', '--json', '--out', preBackup, ...stateArgs(roots)], { allowExit: [0] })
  if (backup.json?.status !== 'CREATED') throw new Error('pre-upgrade backup failed')
  const evidenceBefore = backup.json.evidence?.digest ?? null
  if (typeof evidenceBefore !== 'string') throw new Error('pre-upgrade backup did not record an evidence digest')
  step('pre-upgrade-backup', 'PASS', { sha256: backup.json.archiveSha256, evidenceDigest: evidenceBefore })

  const switchBackup = join(workRoot, 'switch-backup.pab')
  const switched = run(targetCli, ['upgrade', '--json', '--to', target.installDir, '--backup', switchBackup, ...stateArgs(roots)], { allowExit: [0], timeout: 600_000 })
  if (switched.json?.status !== 'CONFIRMED') throw new Error(`switch did not confirm: ${JSON.stringify(switched.json).slice(0, 400)}`)
  const record = await waitForInstance(roots.config, target.manifest.buildId)
  let targetHealth = null
  for (let attempt = 0; attempt < 20 && targetHealth?.ok !== true; attempt += 1) {
    targetHealth = await fetch(`${record.apiURL}/v1/health`, { signal: AbortSignal.timeout(1000) }).catch(() => null)
    if (targetHealth?.ok !== true) await new Promise((r) => setTimeout(r, 300))
  }
  if (targetHealth?.ok !== true) throw new Error(`target instance is not healthy at ${record.apiURL}`)
  // Business evidence must be identical across the switch; launcher/registry rows legitimately change
  // on a start, so the product evidence digest (not the raw DB bytes) is the comparison.
  const afterSwitchBackup = join(workRoot, 'after-switch.pab')
  const afterSwitch = run(targetCli, ['backup', '--json', '--out', afterSwitchBackup, ...stateArgs({ ...roots, install: join(target.installDir, 'app') })], { allowExit: [0] })
  const evidenceAfter = afterSwitch.json?.evidence?.digest ?? null
  if (schemaChange) {
    // A schema-changing target migrates metadata on first start; business rows must survive, and an
    // empty target must stay empty. The raw evidence digest is not comparable across schemas.
    const afterSwitchSchema = afterSwitch.json?.evidence?.productSchema ?? null
    const baselineSchema = baseline.manifest.producer?.productSchema ?? null
    if (afterSwitchSchema === null || afterSwitchSchema === baselineSchema)
      throw new Error(`--schema-change was requested but the state schema did not change (${baselineSchema} -> ${afterSwitchSchema})`)
    step('schema-migration-observed', 'PASS', { baselineSchema, afterSchema: afterSwitchSchema, evidenceBefore, evidenceAfter })
  } else if (evidenceAfter !== evidenceBefore) throw new Error(`the binary switch changed business evidence: ${evidenceBefore} != ${evidenceAfter}`)
  step('binary-switch', 'PASS', {
    from: baseline.manifest.buildId, to: target.manifest.buildId,
    stopped: switched.json.stopped?.status ?? null, backup: switched.json.backup?.sha256 ?? null,
    instanceBuildId: record.buildId, evidenceDigest: evidenceAfter, evidenceUnchanged: !schemaChange,
  })

  const postDoctor = run(targetCli, ['doctor', '--json', ...stateArgs({ ...roots, install: join(target.installDir, 'app') })], { allowExit: [0, 1] })
  if (postDoctor.json.checks.some((entry) => entry.status === 'FAIL'))
    throw new Error(`target doctor reported FAIL after switch: ${JSON.stringify(postDoctor.json.checks.filter((entry) => entry.status === 'FAIL')).slice(0, 400)}`)
  const status = run(targetCli, ['status', '--json', ...stateArgs({ ...roots, install: join(target.installDir, 'app') })], { allowExit: [0, 1] })
  if (status.json?.instance?.buildId !== target.manifest.buildId) throw new Error('status did not report the target build')
  const upgradeStatus = run(targetCli, ['upgrade-status', '--json', ...stateArgs({ ...roots, install: join(target.installDir, 'app') })], { allowExit: [0] })
  if (upgradeStatus.json?.status !== 'confirmed' || upgradeStatus.json.dataRolledBack !== false)
    throw new Error(`upgrade-status is not a clean confirmation: ${JSON.stringify(upgradeStatus.json).slice(0, 300)}`)
  step('target-doctor-status-journal', 'PASS', { doctor: postDoctor.json.status, status: status.json.status, journal: upgradeStatus.json.status, dataRolledBack: upgradeStatus.json.dataRolledBack })

  const rollback = run(targetCli, ['rollback-install', '--json', ...stateArgs({ ...roots, install: join(target.installDir, 'app') })], { allowExit: [0] })
  if (rollback.json?.status !== 'BINARY_ROLLED_BACK' || rollback.json.dataRolledBack !== false)
    throw new Error('rollback-install did not report a binary-only rollback')
  const pointerAfterRollback = JSON.parse(readFileSync(join(roots.config, 'release.json'), 'utf8')).buildId
  if (pointerAfterRollback !== baseline.manifest.buildId) throw new Error('binary rollback did not restore the baseline pointer')

  if (schemaChange) {
    // The older binary must refuse the newer state without writing anything; the pointer stays at the
    // baseline and the data is untouched. The executable cannot be restarted by design, so re-switch
    // to the compatible target is the only supported way to run on this state again.
    const restartConsole = await freePort()
    let restartApi = await freePort()
    if (restartApi === restartConsole) restartApi = await freePort()
    const oldStartOut = openSync(join(workRoot, 'start-old-after-rollback.out.log'), 'w', 0o600)
    const oldStartErr = openSync(join(workRoot, 'start-old-after-rollback.err.log'), 'w', 0o600)
    spawn(baselineCli, ['start', '--fixture', '--port', String(restartConsole), '--api-port', String(restartApi), ...stateArgs(roots)], {
      cwd: baseline.installDir, stdio: ['ignore', oldStartOut, oldStartErr], detached: true,
    }).unref()
    closeSync(oldStartOut)
    closeSync(oldStartErr)
    await new Promise((r) => setTimeout(r, 3000))
    if (existsSync(join(roots.config, 'instance.json'))) throw new Error('the older binary started on a newer schema instead of refusing')
    const oldLogs = readdirSync(roots.logs).filter((name) => name.endsWith('.log')).map((name) => join(roots.logs, name))
    const refused = oldLogs.some((path) => /MigrationIntegrityError: Applied migration \d+ is not registered in this build/.test(readFileSync(path, 'utf8')))
    if (!refused) throw new Error('the older binary did not record the exact schema refusal')
    step('old-binary-schema-refusal', 'PASS', { pointer: pointerAfterRollback, instanceRecord: false, exactStorageRefusal: true })

    const back = run(targetCli, ['upgrade', '--json', '--to', target.installDir, '--backup', join(workRoot, 'reswitch.pab'), ...stateArgs({ ...roots, install: join(target.installDir, 'app') })], { allowExit: [0], timeout: 600_000 })
    if (back.json?.status !== 'CONFIRMED') throw new Error(`re-switch to the compatible target did not confirm: ${JSON.stringify(back.json).slice(0, 300)}`)
    const backRecord = await waitForInstance(roots.config, target.manifest.buildId)
    const backHealth = await fetch(`${backRecord.apiURL}/v1/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null)
    if (backHealth?.ok !== true) throw new Error('re-switched target is not healthy')
    run(targetCli, ['stop', '--json', ...stateArgs({ ...roots, install: join(target.installDir, 'app') })], { allowExit: [0] })
    step('reswitch-compatible-target', 'PASS', { pointer: target.manifest.buildId, instanceBuildId: backRecord.buildId })
  } else {
    // `pa start` supervises until stopped, so the instance is spawned detached like a real restart.
    const restartConsole = await freePort()
    let restartApi = await freePort()
    if (restartApi === restartConsole) restartApi = await freePort()
    const restartOut = openSync(join(workRoot, 'start-baseline-after-rollback.out.log'), 'w', 0o600)
    const restartErr = openSync(join(workRoot, 'start-baseline-after-rollback.err.log'), 'w', 0o600)
    spawn(baselineCli, ['start', '--fixture', '--port', String(restartConsole), '--api-port', String(restartApi), ...stateArgs(roots)], {
      cwd: baseline.installDir, stdio: ['ignore', restartOut, restartErr], detached: true,
    }).unref()
    closeSync(restartOut)
    closeSync(restartErr)
    const afterRollback = await waitForInstance(roots.config, baseline.manifest.buildId)
    const afterRollbackEvidence = run(baselineCli, ['backup', '--json', '--out', join(workRoot, 'after-rollback.pab'), ...stateArgs(roots)], { allowExit: [0] })
    if (afterRollbackEvidence.json?.evidence?.digest !== evidenceBefore)
      throw new Error('the binary rollback changed or lost business evidence')
    run(baselineCli, ['stop', '--json', ...stateArgs(roots)], { allowExit: [0] })
    step('binary-rollback-no-data-loss', 'PASS', {
      pointer: baseline.manifest.buildId, instanceBuildId: afterRollback.buildId,
      dataRolledBack: false, evidenceDigest: afterRollbackEvidence.json.evidence.digest, evidenceUnchanged: true,
      note: 'Binary-only rollback: the state directory and any post-upgrade rows stay in place.',
    })
  }

  evidence.status = evidence.steps.every((entry) => entry.status === 'PASS') ? 'PASS' : 'PARTIAL'
}

try {
  await main()
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = String(error?.stack ?? error)
} finally {
  // Stop any process this recipe started, then remove only its own work root.
  for (const cli of [join(workRoot, 'baseline', 'bin', 'pa'), join(workRoot, 'target', 'bin', 'pa')]) {
    if (existsSync(cli)) {
      try {
        spawnSync(cli, ['stop', '--json', '--config-root', join(workRoot, 'baseline', 'var/config'),
          '--data-root', join(workRoot, 'state'), '--cache-root', join(workRoot, 'cache'),
          '--logs-root', join(workRoot, 'logs'), '--workspace-root', join(workRoot, 'workspace')], { timeout: 20_000 })
      } catch { /* best effort */ }
    }
  }
  evidence.finishedAt = new Date().toISOString()
  evidence.limitations = [
    schemaChange
      ? 'The two artifacts use different product schemas; the switch migrates the state, the older binary refuses it after a binary-only rollback, and only the compatible target can run on it again.'
      : 'Both artifacts use one product schema; this recipe proves install/switch/rollback mechanics, not a schema migration.',
    'It does not seed business rows (product commands are main-owned); post-upgrade row preservation is covered by D smoke with its own harness.',
    'darwin/arm64 + Node 24.21.x + SQLite ABI 137 only; other platforms/ABIs are NOT_TESTED.',
    'A tar without its published sha256 cannot be attributed to a source commit; pass --baseline-sha256/--target-sha256.',
  ]
  if (cleanup) rmSync(workRoot, { recursive: true, force: true })
  void realpathSync
  void writeFileSync
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
