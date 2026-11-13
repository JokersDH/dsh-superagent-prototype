#!/usr/bin/env node
/**
 * Independent same-UID child ownership probe.
 *
 * The ownership helper is imported from the *frozen install package* named by `PA_HELPER_PACKAGE`
 * (a tar.gz plus its committed source/build/digest), never from a developer checkout. The tar bytes
 * are verified before extraction, and the exact helper file digests are returned so the gate can bind
 * them to the artifact subject. A checkout import cannot certify an older binary's safety.
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const result = { protocol: 'w18-d-child-gate/2', steps: [] }
const step = (id, status, detail) => result.steps.push({ id, status, detail })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const dir = mkdtempSync(join(tmpdir(), 'pa-w18-dchild-'))
const roots = { install: join(dir, 'app'), config: join(dir, 'config'), data: join(dir, 'data'), cache: join(dir, 'cache'), logs: join(dir, 'logs'), workspace: join(dir, 'workspace') }
let parent, childPid
try {
  const spec = JSON.parse(process.env.PA_HELPER_PACKAGE ?? 'null')
  if (!spec?.tarPath) throw new Error('PA_HELPER_PACKAGE with tarPath is required; helper must come from a frozen install package')
  if (!existsSync(spec.tarPath)) throw new Error(`frozen package tar missing: ${spec.tarPath}`)
  if (sha(spec.tarPath) !== spec.tarSha256) throw new Error('frozen package tar sha256 differs from the declared artifact')
  if (statSync(spec.tarPath).size !== spec.tarBytes) throw new Error('frozen package tar size differs from the declared artifact')
  const pkgDir = join(dir, 'pkg')
  mkdirSync(pkgDir, { recursive: true })
  execFileSync('tar', ['-xzf', spec.tarPath, '-C', pkgDir], { timeout: 180_000 })
  const root = existsSync(join(pkgDir, 'install')) ? join(pkgDir, 'install') : pkgDir
  const upgradeFile = join(root, 'app/apps/launcher/lib/upgrade.mjs')
  const instanceFile = join(root, 'app/apps/launcher/lib/instance.mjs')
  if (!existsSync(upgradeFile) || !existsSync(instanceFile)) throw new Error('frozen package has no launcher ownership helper')
  result.package = { tarPath: spec.tarPath, tarSha256: spec.tarSha256, tarBytes: spec.tarBytes, sourceCommit: spec.sourceCommit, buildId: spec.buildId }
  result.helper = {
    upgradePath: 'install/app/apps/launcher/lib/upgrade.mjs',
    instancePath: 'install/app/apps/launcher/lib/instance.mjs',
    upgradeSha256: sha(upgradeFile), instanceSha256: sha(instanceFile),
    upgradeBytes: statSync(upgradeFile).size, instanceBytes: statSync(instanceFile).size,
    sourceCommit: spec.sourceCommit, buildId: spec.buildId, tarSha256: spec.tarSha256,
  }
  step('package_verified', 'PASS', JSON.stringify({ sourceCommit: spec.sourceCommit, buildId: spec.buildId, tarSha256: spec.tarSha256 }))
  const upgrade = await import(pathToFileURL(upgradeFile).href)
  const instance = await import(pathToFileURL(instanceFile).href)
  const childCode = `setTimeout(() => {}, 60000); // ${roots.data}`
  const parentCode = `const {spawn}=require('child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});console.log(c.pid);setTimeout(()=>{},60000); // ${roots.data}`
  parent = spawn(process.execPath, ['-e', parentCode], { stdio: ['ignore', 'pipe', 'ignore'] })
  childPid = await new Promise((resolve, reject) => {
    let buffer = ''
    parent.stdout.on('data', chunk => { buffer += chunk; const line = buffer.split('\n').find(Boolean); if (line) resolve(Number(line.trim())) })
    parent.once('exit', () => reject(new Error('parent exited before reporting child')))
    setTimeout(() => reject(new Error('child pid timeout')), 5_000)
  })
  await wait(250)
  const start = await instance.processStart(parent.pid)
  const uid = await instance.processUid(parent.pid)
  const command = await instance.processCommand(parent.pid)
  const operationId = 'w18-child-gate-operation'
  const journalSpawn = { pid: parent.pid, processStart: start, uid, command, configRoot: roots.config, dataRoot: roots.data, operationId }
  const accounted = await upgrade.accountRegisteredResources({ roots, target: null, spawnedPid: parent.pid, spawnedStart: start, journalSpawn, operationId })
  const parentOwned = accounted.owned.some(entry => entry.pid === parent.pid)
  const childOwned = accounted.owned.some(entry => entry.pid === childPid)
  step('parent_owned', parentOwned ? 'PASS' : 'FAIL', String(parent.pid))
  step('same_uid_child_not_owned', childOwned ? 'FAIL' : 'PASS', JSON.stringify({ childPid, owned: accounted.owned.map(entry => entry.pid) }))
  const proof = await upgrade.stopRegisteredResources({ roots, target: null, journalSpawn, operationId })
  step('child_not_signalled', alive(childPid) ? 'PASS' : 'FAIL', JSON.stringify({ childPid, alive: alive(childPid), proof: { proven: proof.proven, unknownLive: proof.unknownLive, stopped: proof.stopped } }))
  step('unknown_child_blocks_proof', proof.proven === false ? 'PASS' : 'FAIL', JSON.stringify({ proven: proof.proven }))
  result.accounted = { owned: accounted.owned, unknownLive: accounted.unknownLive, unverifiable: accounted.unverifiable, considered: accounted.considered }
  result.proof = { proven: proof.proven, stopped: proof.stopped, unknownLive: proof.unknownLive }
  result.ok = result.steps.every(item => item.status === 'PASS')
} catch (error) {
  step('exception', 'FAIL', String(error?.message ?? error).slice(0, 500))
  result.ok = false
} finally {
  try { if (childPid && alive(childPid)) process.kill(childPid, 'SIGKILL') } catch {}
  try { if (parent && alive(parent.pid)) process.kill(parent.pid, 'SIGKILL') } catch {}
  rmSync(dir, { recursive: true, force: true })
}
console.log(JSON.stringify(result))
