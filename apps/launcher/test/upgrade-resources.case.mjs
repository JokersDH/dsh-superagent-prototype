/**
 * D1/D2 process-accounting invariants. These use real child processes but never touch a product
 * instance: a matching spawn is owned, an unmatched live process stays UNKNOWN and blocks.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { accountRegisteredResources, stopRegisteredResources } from '../lib/upgrade.mjs'

const roots = (dir) => ({ install: join(dir, 'app'), config: join(dir, 'config'), data: join(dir, 'data'), cache: join(dir, 'cache'), logs: join(dir, 'logs'), workspace: join(dir, 'workspace') })
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

test('a matching child is owned and stopped, with the stop proven', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-res-own-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const r = roots(dir)
  const child = spawn(process.execPath, ['-e', `setTimeout(() => {}, 60000); // ${r.data}`], { stdio: 'ignore' })
  await wait(150)
  const accounted = await accountRegisteredResources({ roots: r, target: null, spawnedPid: child.pid })
  assert.equal(accounted.owned.some((entry) => entry.pid === child.pid), true)
  const proof = await stopRegisteredResources({ roots: r, target: null, journalSpawn: { pid: child.pid } })
  assert.equal(proof.proven, true)
  // A stopped child may still be an unreaped zombie for this test process; kill(0) would call that
  // alive, so wait for the exit event instead.
  await new Promise((resolveWait) => { if (child.exitCode !== null || child.signalCode !== null) resolveWait(); else child.once('exit', resolveWait) })
  assert.notEqual(child.exitCode ?? child.signalCode, null)
})

test('an unmatched live process stays UNKNOWN and prevents an empty-set stop proof', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-res-unknown-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const r = roots(dir)
  const stranger = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
  await wait(150)
  try {
    const proof = await stopRegisteredResources({ roots: r, target: null, spawnedPid: stranger.pid })
    assert.equal(proof.proven, false)
    assert.equal(proof.unknownLive.some((entry) => entry.pid === stranger.pid), true)
    assert.equal(alive(stranger.pid), true)
  } finally { stranger.kill('SIGKILL') }
})

test('a sibling path sharing a prefix with the private root is not claimed', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-res-prefix-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const r = roots(dir)
  const sibling = spawn(process.execPath, ['-e', `setTimeout(() => {}, 60000); // ${dir}-sibling/data`], { stdio: 'ignore' })
  await wait(150)
  try {
    const accounted = await accountRegisteredResources({ roots: r, target: null, spawnedPid: sibling.pid })
    assert.equal(accounted.owned.some((entry) => entry.pid === sibling.pid), false)
  } finally { sibling.kill('SIGKILL') }
})
