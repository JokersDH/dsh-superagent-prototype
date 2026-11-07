/**
 * REL-03 negative and race cases: at most one owner in every window.
 * - an empty in-flight lockfile is not death evidence (fail closed, no registry)
 * - a claim that exists before its breadcrumb/audit row still blocks a second instance
 * - two concurrent stale takers: exactly one wins the atomic claim CAS
 * - an old holder's release never deletes the new owner's claim or breadcrumb
 * - a registry failure after claiming releases the claim (no leaked ownership)
 * - a killed holder is verifiably dead and taken over; a live unregistered claim is refused
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { InstanceRegistry, ProductStore, WriterLock, WriterLockHeld, type LockContent, type LockRegistry } from '../src/index.ts'
import { makeStore, tempDir } from './helpers.ts'

const holderPath = join(dirname(fileURLToPath(import.meta.url)), 'crash', 'lock-holder.mjs')

const withLockStore = async (fn: (context: { dir: string; store: ProductStore; registry: InstanceRegistry }) => Promise<void>): Promise<void> => {
  const context = makeStore()
  try {
    await fn({ dir: context.dir, store: context.store, registry: new InstanceRegistry(context.store.db) })
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
  }
}

/** A pid that is certainly not running: spawn a trivial process and wait for its exit. */
const deadPid = async (): Promise<number> => {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await once(child, 'exit')
  return child.pid!
}

const entry = (nonce: string, pid = process.pid): LockContent => ({ nonce, pid, startedAt: new Date().toISOString() })

test('a fresh state directory acquires the lock, a second instance is refused, and release frees it', async () => {
  await withLockStore(async ({ dir, registry }) => {
    const first = new WriterLock(dir, registry)
    const held = first.acquire()
    assert.equal(held.pid, process.pid)
    assert.equal(first.probe().verdict, 'in_use')
    assert.equal(first.probe().registryMatch, true)
    assert.equal(JSON.parse(readFileSync(join(dir, 'coordinator.lock'), 'utf8')).nonce, held.nonce)

    const second = new WriterLock(dir, registry)
    assert.throws(() => second.acquire(), (error: unknown) => error instanceof WriterLockHeld && error.verdict === 'in_use')
    assert.equal(second.holder, undefined, 'the refused instance holds nothing')

    first.release()
    assert.equal(first.probe().verdict, 'free')
    assert.equal(registry.current(), undefined)
    const reacquired = second.acquire()
    assert.notEqual(reacquired.nonce, held.nonce)
    second.release()
  })
})

test('an empty or corrupt lockfile without a registry is not death evidence: acquisition fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writer-lock-unknown-'))
  try {
    // Exactly the review repro: a first owner opened the lockfile with O_EXCL but has not written it yet.
    writeFileSync(join(dir, 'coordinator.lock'), '')
    const lock = new WriterLock(dir)
    assert.throws(() => lock.acquire(), (error: unknown) => error instanceof WriterLockHeld && error.verdict === 'unknown')
    assert.equal(lock.holder, undefined)
    assert.equal(readFileSync(join(dir, 'coordinator.lock'), 'utf8'), '', 'the unknown file is left untouched')

    writeFileSync(join(dir, 'coordinator.lock'), '{not json')
    assert.throws(() => new WriterLock(dir).acquire(), (error: unknown) => error instanceof WriterLockHeld && error.verdict === 'unknown')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('lockfile-only mode creates content atomically and refuses a stale holder instead of guessing death', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writer-lock-only-'))
  try {
    const lock = new WriterLock(dir)
    const held = lock.acquire()
    const file = JSON.parse(readFileSync(join(dir, 'coordinator.lock'), 'utf8')) as LockContent
    assert.deepEqual(file, held, 'the lockfile never exists without its full content')
    assert.throws(() => new WriterLock(dir).acquire(), (error: unknown) => error instanceof WriterLockHeld && error.verdict === 'in_use')
    lock.release()
    assert.equal(lock.probe().verdict, 'free')

    // A dead holder without the atomic registry cannot be taken over safely.
    writeFileSync(join(dir, 'coordinator.lock'), JSON.stringify({ nonce: 'dead', pid: 999999, startedAt: '2000-01-01T00:00:00.000Z' }))
    assert.throws(() => new WriterLock(dir).acquire(), (error: unknown) => error instanceof WriterLockHeld && error.verdict === 'stale')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a claim that exists before its breadcrumb and audit row still blocks a second instance', async () => {
  await withLockStore(async ({ dir, registry }) => {
    // The owner's claim is the ownership act; the breadcrumb and audit row follow it.
    assert.equal(registry.claim(entry('owner-in-flight')), true)
    assert.equal(registry.has('owner-in-flight'), false, 'the audit row has not been written yet')

    const second = new WriterLock(dir, registry)
    assert.throws(() => second.acquire(), (error: unknown) => error instanceof WriterLockHeld && error.verdict === 'suspect_pid_reuse')
    assert.equal(second.holder, undefined, 'at most one owner: the second instance never holds the claim')

    // An empty lockfile planted by anyone is inert while the claim decides.
    writeFileSync(join(dir, 'coordinator.lock'), '')
    assert.throws(() => second.acquire(), WriterLockHeld)
    assert.equal(registry.current()?.nonce, 'owner-in-flight', 'the claim is untouched')
  })
})

test('two concurrent stale takers: exactly one wins the atomic claim', async () => {
  await withLockStore(async ({ dir, registry }) => {
    const dead = await deadPid()
    registry.register(entry('dead-owner', dead))
    registry.claim(entry('dead-owner', dead))
    writeFileSync(join(dir, 'coordinator.lock'), JSON.stringify(entry('dead-owner', dead)))

    const first = new WriterLock(dir, registry)
    const second = new WriterLock(dir, registry)
    const outcomes: unknown[] = []
    for (const lock of [first, second]) {
      try { outcomes.push(lock.acquire()) } catch (error) { outcomes.push(error) }
    }
    const winners = outcomes.filter(outcome => !(outcome instanceof Error))
    assert.equal(winners.length, 1, 'exactly one taker became owner')
    assert.equal([first.holder, second.holder].filter(Boolean).length, 1, 'exactly one instance holds the lock')
    const owned = first.holder ? first : second
    assert.equal(registry.current()?.nonce, owned.holder!.nonce)
    assert.match(readFileSync(join(dir, 'coordinator.lock'), 'utf8'), new RegExp(owned.holder!.nonce))
    owned.release()
  })
})

test("an old holder's release never deletes the new owner's claim or breadcrumb", async () => {
  await withLockStore(async ({ dir, registry }) => {
    const oldHolder = new WriterLock(dir, registry)
    const takenOver = oldHolder.acquire()
    // A supported takeover by another instance: the CAS replaces the claim, then the winner writes its breadcrumb.
    const successor = entry('successor')
    assert.equal(registry.takeOver(takenOver.nonce, successor), true)
    writeFileSync(join(dir, 'coordinator.lock'), JSON.stringify(successor))

    oldHolder.release()
    assert.equal(registry.current()?.nonce, 'successor', 'the conditional release matched no claim')
    assert.equal(JSON.parse(readFileSync(join(dir, 'coordinator.lock'), 'utf8')).nonce, 'successor', 'the new breadcrumb survives')
  })
})

test('a registry failure after claiming releases the claim and the breadcrumb (no leaked ownership)', async () => {
  await withLockStore(async ({ dir, registry }) => {
    const failing: LockRegistry = {
      current: () => registry.current(),
      has: nonce => registry.has(nonce),
      claim: entry => registry.claim(entry),
      takeOver: (observed, entry) => registry.takeOver(observed, entry),
      release: nonce => registry.release(nonce),
      register: () => { throw new Error('instance table unavailable') },
      beat: nonce => registry.beat(nonce),
    }
    const lock = new WriterLock(dir, failing)
    assert.throws(() => lock.acquire(), /instance table unavailable/)
    assert.equal(lock.holder, undefined)
    assert.equal(registry.current(), undefined, 'the claim was released after the post-claim failure')
    assert.throws(() => readFileSync(join(dir, 'coordinator.lock'), 'utf8'), /ENOENT/)
    // The state is clean: a normal acquire succeeds afterwards.
    const normal = new WriterLock(dir, registry)
    normal.acquire()
    normal.release()
  })
})

test('a killed holder is verifiably dead and taken over; a live unregistered claim is refused', async () => {
  await withLockStore(async ({ dir, store, registry }) => {
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

    assert.equal(parent.probe().verdict, 'stale', 'a verifiably dead holder is stale')
    const taken = parent.acquire()
    assert.equal(registry.current()?.nonce, taken.nonce)
    assert.match(readFileSync(join(dir, 'coordinator.lock'), 'utf8'), new RegExp(taken.nonce))
    parent.release()
    void store
  })
})

test('a live claim with no audit row is suspected PID reuse and never taken over', async () => {
  await withLockStore(async ({ dir, registry }) => {
    // Claimed by something that never registered: could be PID reuse or a foreign process.
    assert.equal(registry.claim(entry('unregistered', process.pid)), true)
    assert.equal(registry.has('unregistered'), false)
    const lock = new WriterLock(dir, registry)
    assert.equal(lock.probe().verdict, 'suspect_pid_reuse')
    assert.throws(() => lock.acquire(), (error: unknown) => error instanceof WriterLockHeld && error.verdict === 'suspect_pid_reuse')
    assert.equal(registry.current()?.nonce, 'unregistered', 'the suspicious claim is left untouched')
  })
})
