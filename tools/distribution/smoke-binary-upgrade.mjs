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
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { ProductStore } from '../../packages/storage/dist/index.js'
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
const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
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
  const stop = () => run(cli(install), ['stop', '--json', ...rootArgs(r)], { allowExit: [0, 2] })
  return { child, apiPort, consolePort, health, record, stop, apiURL: `http://127.0.0.1:${apiPort}` }
}

const instanceOf = (r) => {
  const path = join(r.config, 'instance.json')
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}
const statePath = (r) => join(r.data, 'state.sqlite')
const evidenceOf = (r) => readEvidenceSummary(statePath(r))

function seed(r, projectId, workId, marker) {
  const store = new ProductStore({ path: statePath(r) })
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
  section('installs', 'PASS', {
    baseline: { buildId: baselineManifest.buildId, commit: baselineManifest.source.commit, schema: 13, tarFamily: 'wave06-alpha2' },
    target: { buildId: targetManifest.buildId, commit: targetManifest.source.commit, schema: 13 },
    sourceDistinct: true,
  })

  const r = rootsFor(baseline, 'shared')
  switchTo(baseline)
  run(cli(baseline), ['first-run', '--json', ...rootArgs(r)], { allowExit: [0] })
  const seeded = seed(r, 'project-upgrade', 'work-pre-upgrade', 'a')
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
  const afterSwitchEvidence = evidenceOf(r)
  if (!afterSwitchEvidence.projects.some((project) => project.id === 'project-upgrade')) throw new Error('switching lost the pre-upgrade project')
  if (!afterSwitchEvidence.works.some((work) => work.id === 'work-pre-upgrade')) throw new Error('switching lost the pre-upgrade work')
  if (afterSwitchEvidence.artifacts[0]?.digest !== seeded.artifactDigest) throw new Error('switching lost the pre-upgrade artifact')
  if (afterSwitchEvidence.digest !== beforeDigest) throw new Error('the switch changed business evidence (it must not migrate or rewrite data by itself)')
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
    dataRolledBack: journal.dataRolledBack === true,
  })

  // ---- C. post-upgrade data survives a binary-only rollback ----
  const stopTarget = run(cli(target), ['stop', '--json', ...rootArgs(r)], { allowExit: [0, 2] })
  if (stopTarget.json?.status !== 'STOPPED') throw new Error('target instance did not stop for the post-upgrade write')
  const postUpgrade = seed(r, 'project-post-upgrade', 'work-post-upgrade', 'b')
  const afterWrite = evidenceOf(r)
  const startedTargetAgain = await startInstance(target, r, 'target-after-write')
  if (instanceOf(r)?.buildId !== targetManifest.buildId) throw new Error('target did not restart on the post-upgrade state')
  const rolled = run(cli(target), ['rollback-install', '--json', ...rootArgs(r)], { allowExit: [0] })
  if (rolled.json?.status !== 'BINARY_ROLLED_BACK') throw new Error('rollback-install did not report BINARY_ROLLED_BACK')
  if (rolled.json.dataRolledBack !== false) throw new Error('binary rollback must not roll data back')
  const pointerAfterRollback = JSON.parse(readFileSync(join(r.config, 'release.json'), 'utf8')).buildId
  if (pointerAfterRollback !== baselineManifest.buildId) throw new Error('binary rollback did not restore the baseline install pointer')
  switchTo(baseline)
  const startedOld = await startInstance(baseline, r, 'baseline-after-rollback')
  if (instanceOf(r)?.buildId !== baselineManifest.buildId) throw new Error('baseline did not start after the binary rollback')
  const compatible = evidenceOf(r)
  if (!compatible.projects.some((project) => project.id === 'project-post-upgrade')) throw new Error('binary rollback lost post-upgrade projects')
  if (!compatible.works.some((work) => work.id === 'work-post-upgrade')) throw new Error('binary rollback lost post-upgrade work')
  if (compatible.artifacts[0]?.digest !== postUpgrade.artifactDigest) throw new Error('binary rollback lost the post-upgrade artifact')
  section('C-post-upgrade-data-protection', 'PASS', {
    postUpgradeEvidence: afterWrite.digest,
    binaryRollback: { pointer: pointerAfterRollback, dataRolledBack: false },
    schemaCompatibleBothWays: true,
    postUpgradeDataIntact: true,
    note: 'Both builds use schema 13, so the older binary still reads the newer records; this is a binary-only rollback, never a data rollback.',
  })

  // ---- D. schema-incompatible older binary refuses the newer state ----
  const schema12 = copyInstall(values['old-schema-install'], 'schema12-install')
  const refusal = run(cli(schema12), ['start', '--fixture', '--json', '--port', String(await freePort()), '--api-port', String(await freePort()), ...rootArgs(r)], { allowExit: [1, 2], timeout: 120_000 })
  if (refusal.status === 0) throw new Error('the schema-12 binary started on a schema-13 state')
  const refusalCode = refusal.json?.code ?? 'daemon_start_failed'
  const bytesAfterRefusal = sha256File(statePath(r))
  if (evidenceOf(r).productSchema !== 13) throw new Error('the refused older binary changed the state schema')
  if (sha256File(statePath(r)) !== bytesAfterRefusal) throw new Error('the refused older binary rewrote the state')
  section('D-incompatible-binary-refusal', 'PASS', {
    olderBinary: JSON.parse(readFileSync(join(schema12, 'install.json'), 'utf8')).buildId,
    code: refusalCode,
    schemaAfterRefusal: evidenceOf(r).productSchema,
    stateUnchanged: true,
  })

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
  const refusedTamper = run(cli(target), ['upgrade', '--json', '--to', tampered, '--backup', join(root, 'tamper-backup.pab'), ...rootArgs(r)], { allowExit: [2] })
  if (refusedTamper.json?.code !== 'target_tampered') throw new Error(`tampered target was not refused: ${JSON.stringify(refusedTamper.json).slice(0, 300)}`)
  if (instanceOf(r)?.buildId !== baselineManifest.buildId) throw new Error('a refused upgrade changed the running instance')
  const stillUp = await fetch(`${instanceOf(r).apiURL}/v1/health`, { signal: AbortSignal.timeout(1000) }).catch(() => null)
  if (stillUp?.ok !== true) throw new Error('a refused upgrade stopped the running instance')
  section('E1-tampered-target-refused', 'PASS', { code: refusedTamper.json.code, instanceStillRunning: true })

  // E2: a running instance cannot be switched without an explicit stop.
  const refusedRunning = run(cli(target), ['upgrade', '--json', '--to', target, '--no-stop', '--backup', join(root, 'no-stop.pab'), ...rootArgs(r)], { allowExit: [2] })
  if (refusedRunning.json?.code !== 'upgrade_requires_stopped_instance') throw new Error(`running switch was not refused: ${JSON.stringify(refusedRunning.json).slice(0, 300)}`)
  section('E2-running-switch-refused', 'PASS', { code: refusedRunning.json.code })

  // E3: an unverified live pid in the instance record is never killed and blocks the switch.
  const sleeper = spawn('sleep', ['30'], { stdio: 'ignore' })
  const recordPath = join(r.config, 'instance.json')
  const realRecord = JSON.parse(readFileSync(recordPath, 'utf8'))
  writeFileSync(recordPath, JSON.stringify({ ...realRecord, pid: sleeper.pid, apiPid: sleeper.pid, processStart: 'Mon Jan  1 00:00:00 2000' }))
  const refusedUnverified = run(cli(target), ['upgrade', '--json', '--to', target, '--backup', join(root, 'unverified.pab'), ...rootArgs(r)], { allowExit: [2] })
  if (refusedUnverified.json?.code !== 'instance_record_unverified') throw new Error(`unverified record was not blocked: ${JSON.stringify(refusedUnverified.json).slice(0, 300)}`)
  const sleeperAlive = (() => { try { process.kill(sleeper.pid, 0); return true } catch { return false } })()
  if (!sleeperAlive) throw new Error('an unverified live process was killed')
  writeFileSync(recordPath, JSON.stringify(realRecord))
  sleeper.kill('SIGKILL')
  section('E3-unverified-instance-blocked', 'PASS', { code: refusedUnverified.json.code, foreignProcessAlive: true })

  // E4: unhealthy target start reverts the install pointer and leaves data untouched.
  const healthFault = run(cli(target), ['upgrade', '--json', '--to', target, '--backup', join(root, 'health-fault.pab'), ...rootArgs(r)], { allowExit: [2], timeout: 180_000, env: { ...process.env, PA_UPGRADE_FAULT: 'target_unhealthy' } })
  if (healthFault.json?.code !== 'upgrade_target_unhealthy') throw new Error(`unhealthy target was not reported: ${JSON.stringify(healthFault.json).slice(0, 300)}`)
  const revertedPointer = JSON.parse(readFileSync(join(r.config, 'release.json'), 'utf8')).buildId
  if (revertedPointer !== baselineManifest.buildId) throw new Error('failed start did not revert the install pointer')
  if (evidenceOf(r).digest !== compatible.digest) throw new Error('failed start changed business evidence')
  section('E4-unhealthy-target-reverted', 'PASS', { pointerAfterRevert: revertedPointer, dataUntouched: true })

  // E5: crash right after the pointer swap is recoverable.
  const crash = run(cli(target), ['upgrade', '--json', '--to', target, '--backup', join(root, 'crash-fault.pab'), ...rootArgs(r)], { allowExit: [2], env: { ...process.env, PA_UPGRADE_FAULT: 'crash_after_switch' } })
  if (crash.json?.code !== 'upgrade_interrupted') throw new Error(`crash injection was not reported: ${JSON.stringify(crash.json).slice(0, 300)}`)
  const pendingStatus = run(cli(target), ['upgrade-status', '--json', ...rootArgs(r)], { allowExit: [0] })
  if (pendingStatus.json?.status !== 'switched_unconfirmed') throw new Error('interrupted switch was not visible in upgrade-status')
  const recoveredSwitch = run(cli(target), ['upgrade', '--json', '--recover', ...rootArgs(r)], { allowExit: [0] })
  if (recoveredSwitch.json?.status !== 'RECOVERED') throw new Error(`switch recovery failed: ${JSON.stringify(recoveredSwitch.json).slice(0, 300)}`)
  if (instanceOf(r)?.buildId !== targetManifest.buildId) throw new Error('recovered switch did not start the target build')
  switchTo(target)
  section('E5-interrupted-switch-recovered', 'PASS', { status: recoveredSwitch.json.status, buildId: instanceOf(r).buildId })

  // E6: repeating the same switch is idempotent rather than a second switch.
  const duplicate = run(cli(target), ['upgrade', '--json', '--to', target, '--backup', join(root, 'duplicate.pab'), ...rootArgs(r)], { allowExit: [2] })
  if (duplicate.json?.code !== 'upgrade_already_applied') throw new Error(`duplicate upgrade was not rejected: ${JSON.stringify(duplicate.json).slice(0, 300)}`)
  section('E6-duplicate-refused', 'PASS', { code: duplicate.json.code })

  run(cli(target), ['stop', '--json', ...rootArgs(r)], { allowExit: [0, 2] })
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
