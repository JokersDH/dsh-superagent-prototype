/** REL-03: unique writer, safe takeover of a verifiably dead holder, and refusal on suspected PID reuse. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { InstanceRegistry, ProductStore, WriterLock, WriterLockHeld } from '../src/index.ts'
import { makeStore, tempDir } from './helpers.ts'

const holderPath = join(dirname(fileURLToPath(import.meta.url)), 'crash', 'lock-holder.mjs')

test('a fresh state directory acquires the lock, a second instance is refused, and release frees it', async () => {
  await withLockStore(async ({ dir, store }) => {
    const registry = new InstanceRegistry(store.db)
    const first = new WriterLock(dir, registry)
    const held = first.acquire()
    assert.equal(held.pid, process.pid)
    assert.match(held.nonce, /.+/)
    assert.equal(first.probe().verdict, 'in_use')
    assert.equal(first.probe().registryMatch, true)

    const second = new WriterLock(dir, registry)
    assert.throws(() => second.acquire(), (error: unknown) => error instanceof WriterLockHeld && error.verdict === 'in_use')

    first.release()
    assert.equal(first.probe().verdict, 'free')
    const reacquired = second.acquire()
    assert.notEqual(reacquired.nonce, held.nonce)
    second.release()
  })
})

test('a killed holder is taken over; a live PID with an unknown nonce is suspected PID reuse and never taken over', async () => {
  await withLockStore(async ({ dir, store }) => {
    const registry = new InstanceRegistry(store.db)
    // 1. A real child holds the lock and heartbeats; the parent sees in_use, then SIGKILLs it.
    const child = spawn(process.execPath, [holderPath, join(dir, 'product.sqlite'), dir], { stdio: ['ignore', 'pipe', 'inherit'] })
    let output = ''
    child.stdout.on('data', chunk => { output += String(chunk) })
    for (let attempts = 0; !output.includes('LOCKED'); attempts++) {
      if (attempts > 10_000) throw new Error(`lock holder never reported: ${output}`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    const parent = new WriterLock(dir, registry)
    assert.equal(parent.probe().verdict, 'in_use')
    assert.throws(() => parent.acquire(), WriterLockHeld)
    child.kill('SIGKILL')
    await once(child, 'exit')

    // 2. The dead holder leaves the lockfile and registry row behind; the death is verifiable, so takeover is safe.
    const afterDeath = parent.probe()
    assert.equal(afterDeath.verdict, 'stale')
    const taken = parent.acquire()
    assert.match(taken.nonce, /.+/)

    // 3. PID reuse: a live PID with a nonce the product never registered is not death proof and not a takeover target.
    const forged = new WriterLock(dir, registry)
    writeFileSync(join(dir, 'coordinator.lock'), JSON.stringify({ pid: process.pid, nonce: 'forged-instance-nonce', startedAt: '2000-01-01T00:00:00.000Z' }))
    const probe = forged.probe()
    assert.equal(probe.verdict, 'suspect_pid_reuse')
    assert.equal(probe.registryMatch, false)
    assert.throws(() => forged.acquire(), (error: unknown) => error instanceof WriterLockHeld && error.verdict === 'suspect_pid_reuse')
    assert.match(readFileSync(join(dir, 'coordinator.lock'), 'utf8'), /forged-instance-nonce/, 'the suspect lockfile is left untouched')
  })
})

async function withLockStore(fn: (context: { dir: string; store: ProductStore }) => Promise<void>): Promise<void> {
  const context = makeStore()
  try {
    await fn({ dir: context.dir, store: context.store })
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
  }
}
