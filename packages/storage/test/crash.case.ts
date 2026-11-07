/** REL-01 + DATA-02: real subprocess SIGKILL at the pre-commit and post-commit windows, then replay the same command. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ProductStore } from '../src/index.ts'
import { tempDir } from './helpers.ts'

const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'crash', 'worker.mjs')

/** Spawns the worker, waits for its marker, SIGKILLs it, and resolves after exit. */
const killAt = async (dbPath: string, phase: 'before-commit' | 'after-commit'): Promise<void> => {
  const child = spawn(process.execPath, [workerPath, dbPath, phase], { stdio: ['ignore', 'pipe', 'inherit'] })
  let output = ''
  child.stdout.on('data', chunk => { output += String(chunk) })
  const marker = phase === 'before-commit' ? 'READY' : 'COMMITTED'
  for (let attempts = 0; !output.includes(marker); attempts++) {
    if (attempts > 10_000) throw new Error(`worker never reported ${marker}: ${output}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  child.kill('SIGKILL')
  await once(child, 'exit')
}

const applyCrashCommand = (store: ProductStore): { replayed: boolean } => {
  // The same transaction shape the worker applies: domain write, receipt, queue row, and event together.
  return store.uow.atomic(() => {
    store.domain.tickets.save({ id: 'ticket-crash', assignments: [], undelivered: [] })
    const outcome = store.commands.record('crash-command', 'crash-digest', () => {
      store.queue.enqueue('demo', 'key-1', JSON.stringify({ n: 1 }), 1, 0, new Date().toISOString())
      store.events.append({ topic: 'demo', entityRef: 'crash-command', payload: { n: 1 } })
      return { accepted: true }
    })
    return { replayed: outcome.replayed }
  })
}

test('killed before commit: nothing was accepted, and replaying the same command applies it exactly once', async () => {
  const dir = tempDir()
  const dbPath = join(dir, 'product.sqlite')
  try {
    await killAt(dbPath, 'before-commit')
    const store = new ProductStore({ path: dbPath })
    try {
      assert.equal(store.domain.tickets.get('ticket-crash'), undefined, 'no half-accepted ticket')
      assert.equal(store.commands.get('crash-command'), undefined, 'no receipt')
      assert.equal(store.queue.stats('demo').waiting, 0, 'no orphan effect')
      assert.equal(store.events.cursor(), 0, 'no event')
      assert.deepEqual(store.database.checkIntegrity(), { integrity: 'ok', foreignKeyViolations: 0 })

      const first = applyCrashCommand(store)
      assert.equal(first.replayed, false, 'the replay is the first acceptance')
      assert.ok(store.domain.tickets.get('ticket-crash'))
      assert.ok(store.commands.get('crash-command'))
      assert.equal(store.queue.stats('demo').waiting, 1)
      assert.equal(store.events.cursor(), 2)

      const second = applyCrashCommand(store)
      assert.equal(second.replayed, true, 'a second replay deduplicates')
      assert.equal(store.queue.stats('demo').waiting, 1, 'no duplicated effect')
      assert.equal(store.events.cursor(), 2, 'no duplicated event')
    } finally { store.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('killed after commit: the receipt and queued effect survived, and a replay does not rebuild work', async () => {
  const dir = tempDir()
  const dbPath = join(dir, 'product.sqlite')
  try {
    await killAt(dbPath, 'after-commit')
    const store = new ProductStore({ path: dbPath })
    try {
      assert.ok(store.domain.tickets.get('ticket-crash'), 'the accepted ticket survived')
      assert.equal(store.commands.get('crash-command')?.payloadDigest, 'crash-digest')
      assert.equal(store.queue.stats('demo').waiting, 1, 'the committed effect continues from the queue')
      assert.equal(store.events.cursor(), 2)
      assert.deepEqual(store.database.checkIntegrity(), { integrity: 'ok', foreignKeyViolations: 0 })

      const replay = applyCrashCommand(store)
      assert.equal(replay.replayed, true, 'the same command ID and digest deduplicates after the crash')
      assert.equal(store.queue.stats('demo').waiting, 1, 'no second queue row')
      assert.equal(store.events.cursor(), 2, 'no second event')
    } finally { store.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
