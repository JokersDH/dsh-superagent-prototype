/**
 * Destructive state operations must prove inactivity: a live writer claim, another process holding
 * the database files, or an unknown writer claim all refuse the move.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { InstanceRegistry, ProductStore, WriterLock } from '@personal-agent/storage'
import { PortabilityError, assertStateInactive, inspectStateActivity } from '../src/index.ts'

const tempState = (name: string): { root: string; stateDir: string } => {
  const root = mkdtempSync(join(tmpdir(), `pa-state-${name}-`))
  const stateDir = join(root, 'state')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  return { root, stateDir }
}

test('a closed state is provably inactive', async (t) => {
  const { root, stateDir } = tempState('inactive')
  try {
    const store = new ProductStore({ path: join(stateDir, 'state.sqlite') })
    store.close()
    const activity = await inspectStateActivity(stateDir)
    assert.equal(activity.status, 'inactive')
    assert.deepEqual(activity.reasons, [])
    await assertStateInactive(stateDir)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a held writer lock refuses the destructive operation', async (t) => {
  const { root, stateDir } = tempState('writer')
  try {
    const store = new ProductStore({ path: join(stateDir, 'state.sqlite') })
    const lock = new WriterLock(stateDir, new InstanceRegistry(store.db))
    try {
      lock.acquire()
      const activity = await inspectStateActivity(stateDir)
      assert.equal(activity.status, 'active')
      assert.ok(activity.reasons.some((reason) => /writer_claim/.test(reason)))
      assert.ok(activity.writer !== null)
      await assert.rejects(
        () => assertStateInactive(stateDir),
        (error) => error instanceof PortabilityError && error.code === 'state_in_use',
      )
    } finally {
      lock.release()
      store.close()
    }
    const after = await inspectStateActivity(stateDir)
    assert.equal(after.status, 'inactive')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unknown writer claim (dead pid) is refused as uncertain, not as free', async (t) => {
  const { root, stateDir } = tempState('unknown')
  try {
    const store = new ProductStore({ path: join(stateDir, 'state.sqlite') })
    try {
      // Simulate a claim left behind by a process that no longer exists.
      store.db.prepare('INSERT OR REPLACE INTO writer_claim (id, nonce, pid, started_at) VALUES (1, ?, ?, ?)')
        .run('dead-nonce', 999_999, new Date(Date.now() - 60_000).toISOString())
    } finally {
      store.close()
    }
    const activity = await inspectStateActivity(stateDir)
    assert.equal(activity.status, 'unknown')
    assert.equal(activity.writer?.pidAlive, false)
    await assert.rejects(
      () => assertStateInactive(stateDir),
      (error) => error instanceof PortabilityError && error.code === 'writer_uncertain',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('another process holding the database files is detected, not only a writer claim', { timeout: 30_000 }, async (t) => {
  const { root, stateDir } = tempState('holder')
  const store = new ProductStore({ path: join(stateDir, 'state.sqlite') })
  let holder: ReturnType<typeof spawn> | null = null
  try {
    const child = spawn(
      process.execPath,
      [
        '-e',
        "const D=require('better-sqlite3');const db=new D(process.argv[1],{readonly:true,fileMustExist:true});console.log('ready');process.stdin.resume();",
        join(stateDir, 'state.sqlite'),
      ],
      // Resolve better-sqlite3 from this package's own node_modules regardless of test runner cwd.
      { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: ['pipe', 'pipe', 'pipe'] },
    )
    if (child.stdout === null) throw new Error('holder child has no stdout')
    holder = child
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { output += chunk })
    const deadline = Date.now() + 10_000
    while (!output.includes('ready')) {
      if (Date.now() > deadline) throw new Error('holder process did not open the database')
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
    }
    const activity = await inspectStateActivity(stateDir)
    assert.equal(activity.status, 'active')
    assert.ok(activity.holders.some((entry) => entry.pid === child.pid), 'the external holder is reported')
    await assert.rejects(
      () => assertStateInactive(stateDir),
      (error) => error instanceof PortabilityError && error.code === 'state_in_use',
    )
  } finally {
    if (holder !== null && holder.exitCode === null && holder.signalCode === null) {
      holder.kill('SIGTERM')
      await once(holder, 'exit')
    }
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a missing state directory is an explicit invalid_root, not a free state', async () => {
  await assert.rejects(
    () => inspectStateActivity(join(tmpdir(), 'pa-state-does-not-exist')),
    (error) => error instanceof PortabilityError && error.code === 'invalid_root',
  )
})
