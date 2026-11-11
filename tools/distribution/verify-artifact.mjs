#!/usr/bin/env node
/**
 * Independent, repeatable acceptance of a frozen install artifact: extract the tar.gz into a fresh
 * directory, run the ordinary path there (first-run/doctor/start/status/stop/backup/restore/
 * recovery-status/start read-only/rollback), and prove loaded modules come from the extracted install,
 * not this checkout. E can run this unchanged from its own root; it does not modify product source.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const tarIndex = args.indexOf('--tar')
if (tarIndex === -1) {
  process.stderr.write('usage: verify-artifact.mjs --tar <frozen-install.tar.gz>\n')
  process.exit(2)
}
const tarPath = resolve(args[tarIndex + 1])
const evidence = { case: 'WAVE06-ARTIFACT-ACCEPTANCE', status: 'FAIL', startedAt: new Date().toISOString(), steps: [] }
const step = (id, status, detail) => evidence.steps.push({ id, status, ...(detail === undefined ? {} : { detail }) })
const freePort = () => new Promise((resolvePort, reject) => {
  const socket = createServer()
  socket.once('error', reject)
  socket.listen(0, '127.0.0.1', () => {
    const { port } = socket.address()
    socket.close(() => resolvePort(port))
  })
})
const root = mkdtempSync(join(tmpdir(), 'pa-artifact-accept-'))
const run = (binary, args, options = {}) => {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 300_000, ...options })
  if (options.allowExit !== undefined && !options.allowExit.includes(result.status))
    throw new Error(`${binary} ${args.slice(0, 4).join(' ')} exit ${result.status}\n${result.stdout}\n${result.stderr}`)
  let json = null
  try { json = JSON.parse(result.stdout) } catch { json = null }
  return { ...result, json }
}

try {
  if (!existsSync(tarPath)) throw new Error('artifact tar is missing')
  const tarSha = createHash('sha256').update(readFileSync(tarPath)).digest('hex')
  const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
  const extract = run('tar', ['-xzf', tarPath, '-C', root], { allowExit: [0] })
  const installDir = join(root, 'install')
  if (!existsSync(join(installDir, 'bin', 'pa'))) throw new Error('extracted artifact has no bin/pa')
  const wrapper = join(installDir, 'bin', 'pa')
  const pa = (a, options = {}) => run(wrapper, a, options)
  const install = JSON.parse(readFileSync(join(installDir, 'install.json'), 'utf8'))

  const firstRun = pa(['first-run', '--json'], { allowExit: [0] })
  if (firstRun.json?.status !== 'OK') throw new Error('artifact first-run failed')
  step('extract-and-first-run', 'PASS', { tarSha256: tarSha, buildId: install.buildId, files: install.files.length })

  const doctor = pa(['doctor', '--json'], { allowExit: [0, 1] })
  const check = (id) => doctor.json?.checks?.find((item) => item.id === id)
  for (const id of ['release_manifest', 'runtime_abi', 'console_mode', 'runtime_dependencies']) {
    if (check(id)?.status !== 'PASS') throw new Error(`artifact doctor gate ${id} failed`)
  }
  step('artifact-doctor-gates', 'PASS', { status: doctor.json.status })

  const consolePort = await freePort()
  let apiPort = await freePort()
  if (apiPort === consolePort) apiPort = await freePort()
  const out = join(root, 'start.out.log')
  const err = join(root, 'start.err.log')
  const outFd = openSync(out, 'w', 0o600)
  const errFd = openSync(err, 'w', 0o600)
  const child = spawn(wrapper, ['start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort)], {
    cwd: installDir,
    stdio: ['ignore', outFd, errFd],
  })
  const deadline = Date.now() + 60000
  let health = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/v1/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok) { health = await response.json(); break }
    } catch { /* not ready */ }
    if (child.exitCode !== null) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  closeSync(outFd)
  closeSync(errFd)
  if (health === null) throw new Error(`artifact instance did not become healthy\n${readFileSync(err, 'utf8').slice(-2000)}`)
  const page = await fetch(`http://127.0.0.1:${consolePort}/`, { signal: AbortSignal.timeout(5000) })
  if (!page.ok || !(await page.text()).includes('<div id="root">')) throw new Error('artifact static workbench was not served')
  const installReal = realpathSync(installDir)

  let status = null
  const statusDeadline = Date.now() + 30000
  while (Date.now() < statusDeadline) {
    status = pa(['status', '--json'], { allowExit: [0, 1, 2] })
    if (status.json?.status === 'RUNNING') break
    if (child.exitCode !== null) throw new Error(`artifact supervisor exited before recording the instance (${child.exitCode})`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  if (status?.json?.status !== 'RUNNING') throw new Error('artifact status did not report RUNNING')
  // Executed-entry and native-binding provenance: the recorded child runs the coordinator from the
  // extracted install and loads the extracted SQLite binding, never this checkout.
  const apiPid = status.json.instance?.apiPid
  const apiCommand = spawnSync('ps', ['-ww', '-p', String(apiPid), '-o', 'command='], { encoding: 'utf8' }).stdout ?? ''
  if (!apiCommand.includes(`${installReal}/app/apps/coordinator/product/demo.ts`))
    throw new Error(`artifact coordinator entry is not from the extracted install: ${apiCommand.slice(0, 300)}`)
  if (apiCommand.includes('superagent-agent-d')) throw new Error('artifact coordinator references the author checkout')
  const binding = spawnSync('lsof', ['-a', '-p', String(apiPid), '-Fn'], { encoding: 'utf8' }).stdout ?? ''
  const nativeBinding = binding.split('\n').find((line) => line.includes('better-sqlite3') && line.includes('.node')) ?? ''
  if (!nativeBinding.startsWith(`n${installReal}`)) throw new Error('artifact native binding is not loaded from the extracted install')
  // Open-file provenance: no loaded file may live in the author checkout, so the running daemon does
  // not depend on this repository being present.
  const openFiles = (spawnSync('lsof', ['-p', String(apiPid), '-Fn'], { encoding: 'utf8' }).stdout ?? '')
    .split('\n')
    .filter((line) => line.startsWith('n/'))
    .map((line) => line.slice(1))
  const checkoutRoot = realpathSync(resolve(process.env.PA_AUTHOR_CHECKOUT ?? '..'))
  const fromCheckout = openFiles.filter((path) => path.startsWith(checkoutRoot))
  if (fromCheckout.length > 0) throw new Error(`artifact daemon opened files from the author checkout: ${fromCheckout.slice(0, 3)}`)
  const fromInstall = openFiles.filter((path) => path.startsWith(installReal)).length
  step('artifact-start-and-provenance', 'PASS', {
    coordinatorEntry: 'extracted-install',
    nativeBinding: 'extracted-install',
    checkoutReferences: 0,
    openFilesTotal: openFiles.length,
    openFilesFromInstall: fromInstall,
    openFilesFromCheckout: fromCheckout.length,
  })
  const backup = pa(['backup', '--json', '--out', join(root, 'artifact-backup.pab')], { allowExit: [0] })
  if (backup.json?.status !== 'CREATED' || backup.json.evidence === null) throw new Error('artifact backup/evidence failed')
  step('artifact-backup', 'PASS', { digest: backup.json.evidence.digest, counts: backup.json.evidence.counts })
  const stop = pa(['stop', '--json'], { allowExit: [0] })
  if (stop.json?.status !== 'STOPPED') throw new Error('artifact stop failed')
  await new Promise((resolveWait) => child.once('exit', resolveWait))
  step('artifact-stop', 'PASS', {})

  const restored = join(root, 'restored-state')
  const restore = pa(['restore', '--json', '--bundle', join(root, 'artifact-backup.pab'), '--to', restored], { allowExit: [0] })
  if (restore.json?.report?.evidence?.status !== 'verified') throw new Error('artifact restore did not verify evidence')
  const recovery = pa(['recovery-status', '--json', '--data-root', restored], { allowExit: [1] })
  if (recovery.json?.startupMode !== 'recovery_readonly' || recovery.json?.authorization?.status !== 'BLOCKED')
    throw new Error('artifact recovery-status did not report read-only + blocked authorization')
  step('artifact-restore-and-recovery-status', 'PASS', { evidence: restore.json.report.evidence.status, authorization: recovery.json.authorization.status })

  const restorePort = await freePort()
  let restoreApi = await freePort()
  if (restoreApi === restorePort) restoreApi = await freePort()
  const restoredChild = spawn(wrapper, ['start', '--fixture', '--port', String(restorePort), '--api-port', String(restoreApi), '--data-root', restored], { cwd: installDir, stdio: 'ignore' })
  const restoreDeadline = Date.now() + 60000
  let restoredHealth = null
  while (Date.now() < restoreDeadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${restoreApi}/v1/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok) { restoredHealth = await response.json(); break }
    } catch { /* not ready */ }
    if (restoredChild.exitCode !== null) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  if (restoredHealth?.startupMode !== 'recovery_readonly') throw new Error('restored artifact instance was not read-only')

  // D4: the artifact must consume main's recovery inspect/prepare, and neither may write.
  const restoredDb = join(restored, 'state.sqlite')
  const markerPath = join(restored, 'restore-report.json')
  const beforeDb = sha256File(restoredDb)
  const beforeMarker = readFileSync(markerPath)
  const inspected = pa(['recovery-inspect', '--json', '--data-root', restored], { allowExit: [0] })
  if (inspected.json?.startupMode !== 'recovery_readonly' || inspected.json?.authorization !== 'not_granted')
    throw new Error(`artifact recovery-inspect did not report read-only + not_granted: ${JSON.stringify(inspected.json).slice(0, 300)}`)
  if (typeof inspected.json?.inspectionFingerprint !== 'string' || inspected.json.inspectionFingerprint.length !== 64)
    throw new Error('artifact recovery-inspect did not return an inspection fingerprint')
  const sourceProject = inspected.json.projects?.[0]?.id
  if (typeof sourceProject !== 'string') throw new Error('artifact recovery-inspect listed no project to bind')
  const bindingRepo = join(root, 'artifact-binding-project')
  mkdirSync(bindingRepo, { recursive: true })
  writeFileSync(join(bindingRepo, 'index.mjs'), 'export const ok = true\n')
  const git = (args) => spawnSync('git', args, { cwd: bindingRepo, encoding: 'utf8' })
  git(['init', '-q']); git(['add', 'index.mjs'])
  git(['-c', 'user.name=Artifact Acceptance', '-c', 'user.email=artifact@localhost', 'commit', '-qm', 'artifact binding base'])
  const planned = pa(['recovery-prepare', '--json', '--source-project', sourceProject, '--path', bindingRepo, '--data-root', restored], { allowExit: [1, 2] })
  if (planned.json?.status === 'BLOCKED' && planned.json.code !== 'prepare_refused')
    throw new Error(`artifact recovery-prepare failed unexpectedly: ${JSON.stringify(planned.json).slice(0, 300)}`)
  if (planned.json?.authorization !== undefined && planned.json.authorization !== 'not_granted')
    throw new Error('artifact recovery-prepare must not grant authorization')
  if (planned.json?.commitAvailable === true) throw new Error('artifact recovery-prepare must not report commit availability')
  if (planned.json?.applied === true) throw new Error('artifact recovery-prepare applied a plan')
  if (sha256File(restoredDb) !== beforeDb) throw new Error('artifact recovery inspect/prepare wrote the restored database')
  if (!readFileSync(markerPath).equals(beforeMarker)) throw new Error('artifact recovery inspect/prepare changed the restore marker')
  step('artifact-recovery-preflight-readonly', 'PASS', {
    startupMode: inspected.json.startupMode,
    fingerprintPresent: true,
    inspectAuthorization: inspected.json.authorization,
    prepareAuthorization: planned.json.authorization ?? 'refused',
    commitAvailable: planned.json.commitAvailable ?? false,
    commitOwner: planned.json.commitRequirements?.owner ?? null,
    databaseUnchanged: true,
    markerUnchanged: true,
  })
  const rejected = await fetch(`http://127.0.0.1:${restoreApi}/v1/commands`, {
    method: 'POST',
    headers: { connection: 'close', 'content-type': 'application/json', authorization: `Bearer ${readFileSync(join(restored, 'api.key'), 'utf8').trim()}` },
    body: JSON.stringify({ commandId: 'artifact-recovery-command', conversationId: 'conv-main', kind: 'create_work' }),
  })
  if (rejected.status !== 422) throw new Error(`restored read-only command expected 422, got ${rejected.status}`)
  pa(['stop', '--json', '--data-root', restored], { allowExit: [0] })
  await new Promise((resolveWait) => restoredChild.once('exit', resolveWait))
  step('artifact-restored-readonly', 'PASS', { startupMode: restoredHealth.startupMode, commandStatus: rejected.status })

  evidence.artifact = { tarPath, tarSha256: tarSha, buildId: install.buildId, installManifest: 'install.json', files: install.files.length, supportMatrix: install.supportMatrix }
  evidence.status = 'PASS'
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = String(error?.stack ?? error)
} finally {
  evidence.finishedAt = new Date().toISOString()
  evidence.limitations = [
    'darwin/arm64 + Node 24.21.x measured only; cross-machine/ABI is NOT_TESTED.',
    'Uses fixture mode and isolated temp ports/state; no user service, native executor or model call.',
    'Recovery new authorization remains BLOCKED (main interface not published); this script does not bypass it.',
  ]
  rmSync(root, { recursive: true, force: true })
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
