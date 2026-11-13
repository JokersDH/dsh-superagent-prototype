#!/usr/bin/env node
/** Independent same-UID child ownership probe against D's current ownership exports. */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dRoot = process.env.PA_D_ROOT ?? '/Users/hh/Desktop/joker/superagent-agent-d'
const result = { protocol: 'w17-d-child-gate/1', dRoot, steps: [] }
const step = (id, status, detail) => result.steps.push({ id, status, detail })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
const dir = mkdtempSync(join(tmpdir(), 'pa-w17-dchild-'))
const roots = { install: join(dir, 'app'), config: join(dir, 'config'), data: join(dir, 'data'), cache: join(dir, 'cache'), logs: join(dir, 'logs'), workspace: join(dir, 'workspace') }
let parent, childPid
try {
  const upgrade = await import(pathToFileURL(join(dRoot, 'apps/launcher/lib/upgrade.mjs')).href)
  const instance = await import(pathToFileURL(join(dRoot, 'apps/launcher/lib/instance.mjs')).href)
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
  const operationId = 'w17-child-gate-operation'
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
} finally {
  try { if (childPid && alive(childPid)) process.kill(childPid, 'SIGKILL') } catch {}
  try { if (parent && alive(parent.pid)) process.kill(parent.pid, 'SIGKILL') } catch {}
  rmSync(dir, { recursive: true, force: true })
}
console.log(JSON.stringify(result))
