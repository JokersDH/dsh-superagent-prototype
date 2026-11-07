/** Algorithm tests over an in-memory QueueStore fake mirroring the SQLite row semantics. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { Effects, FAILURES_BEFORE_ERROR, Later, UnknownSend, type ParkedRow, type QueueRow, type QueueStore, type QueueStats } from '../src/index.ts'

/** Mutable internally; read-only through the QueueRow interface at the port boundary. */
interface Row { kind: string; key: string; payload: string; seq: number; generation: number; attempts: number; error: string; due: number; since: string; parkedReason?: string; parkedAt?: string }
class MemoryQueue implements QueueStore {
  readonly rows = new Map<string, Row>()
  private id = (kind: string, key: string) => `${kind}\u0000${key}`
  maxSeq(): number { return [...this.rows.values()].reduce((max, row) => Math.max(max, row.seq), 0) }
  enqueue(kind: string, key: string, payload: string, seq: number, due: number, since: string): void {
    const existing = this.rows.get(this.id(kind, key))
    if (existing && existing.parkedAt) return // parked rows stay parked
    if (existing) {
      existing.payload = payload; existing.generation += 1; existing.attempts = 0; existing.error = ''; existing.due = due
    } else {
      this.rows.set(this.id(kind, key), { kind, key, payload, seq, generation: 0, attempts: 0, error: '', due, since })
    }
  }
  private live(kind: string): Row[] { return [...this.rows.values()].filter(row => row.kind === kind && !row.parkedAt) }
  // Rows leave the store as snapshots, mirroring SQLite query results: a row mutated later never rewrites an in-flight attempt.
  dueRows(kind: string, now: number, limit: number): QueueRow[] { return this.live(kind).filter(row => row.due <= now).sort((a, b) => a.seq - b.seq).slice(0, limit).map(row => ({ ...row })) }
  oldestRow(kind: string): QueueRow | undefined { const head = this.live(kind).sort((a, b) => a.seq - b.seq)[0]; return head ? { ...head } : undefined }
  private matching(kind: string, key: string, seq: number, generation: number): Row | undefined {
    const row = this.rows.get(this.id(kind, key))
    return row && row.seq === seq && row.generation === generation ? row : undefined
  }
  complete(kind: string, key: string, seq: number, generation: number): void {
    const row = this.matching(kind, key, seq, generation)
    if (row) this.rows.delete(this.id(kind, key))
  }
  reschedule(kind: string, key: string, seq: number, generation: number, due: number): void {
    const row = this.matching(kind, key, seq, generation)
    if (row) row.due = due
  }
  recordFailure(kind: string, key: string, seq: number, generation: number, attempts: number, error: string, due: number): void {
    const row = this.matching(kind, key, seq, generation)
    if (row) { row.attempts = attempts; row.error = error; row.due = due }
  }
  park(kind: string, key: string, seq: number, generation: number, reason: string, at: string): void {
    const row = this.matching(kind, key, seq, generation)
    if (row) { row.parkedReason = reason; row.parkedAt = at }
  }
  parked(kind?: string): ParkedRow[] {
    return [...this.rows.values()]
      .filter(row => !!row.parkedAt && (kind === undefined || row.kind === kind))
      .sort((a, b) => a.seq - b.seq)
      .map(row => ({ ...row, parkedReason: row.parkedReason!, parkedAt: row.parkedAt! }) as ParkedRow)
  }
  cancel(kind: string, key: string): void { this.rows.delete(this.id(kind, key)) }
  stats(kind: string): QueueStats {
    const rows = this.live(kind)
    return {
      waiting: rows.length,
      ...(rows.length ? { oldestSince: rows.reduce((min, row) => (row.since < min ? row.since : min), rows[0]!.since) } : {}),
      maxAttempts: rows.reduce((max, row) => Math.max(max, row.attempts), 0),
      ...(rows.some(row => row.error) ? { lastError: [...rows].reverse().find(row => row.error)!.error } : {}),
    }
  }
}

const settle = () => setImmediate()
const onlyRow = (queue: MemoryQueue): Row => {
  const rows = [...queue.rows.values()]
  assert.equal(rows.length, 1)
  return rows[0]!
}

/** A deferred-capture handler body for tests that need to hold a row mid-flight. */
const harness = () => {
  const calls: { payload: unknown; key: string; resolve: () => void }[] = []
  const handlerBody = (payload: unknown, key: string) => new Promise<void>(resolve => { calls.push({ payload, key, resolve }) })
  return { calls, handlerBody }
}

test('dispatch runs a due row once and removes it', async () => {
  const queue = new MemoryQueue()
  const effects = new Effects(queue, undefined, () => 0)
  const { calls, handlerBody } = harness()
  effects.handle('reply', handlerBody)
  effects.enqueue('reply', 'm1', { text: 'hello' })
  assert.equal(effects.pending('reply'), true)
  effects.start()
  await settle()
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0]!.payload, { text: 'hello' })
  calls[0]!.resolve()
  await effects.idle()
  assert.equal(effects.pending('reply'), false)
})

test('coalescing keeps queue position and replaces the payload of the waiting row', async () => {
  const queue = new MemoryQueue()
  const effects = new Effects(queue, undefined, () => 0)
  const { calls, handlerBody } = harness()
  effects.handle('delivery', handlerBody, { limit: () => 1 })
  effects.enqueue('delivery', 't1', { n: 1 })
  const seq = onlyRow(queue).seq
  effects.enqueue('delivery', 't1', { n: 2 })
  assert.equal(onlyRow(queue).seq, seq, 'queue position is kept')
  assert.equal(queue.rows.size, 1, 'one coalesced row')
  effects.start()
  await settle()
  assert.deepEqual(calls[0]!.payload, { n: 2 })
  calls[0]!.resolve()
  await effects.idle()
  assert.equal(queue.rows.size, 0)
})

test('a row replaced while running keeps its newer payload for the next start', async () => {
  const queue = new MemoryQueue()
  const effects = new Effects(queue, undefined, () => 0)
  const { calls, handlerBody } = harness()
  effects.handle('launch', handlerBody)
  effects.enqueue('launch', 'a1', { n: 1 })
  effects.start()
  await settle()
  assert.equal(calls.length, 1)
  effects.enqueue('launch', 'a1', { n: 2 })
  calls[0]!.resolve()
  await effects.drain()
  assert.equal(calls.length, 1, 'drain stops new dispatches; the replaced row waits')
  const waiting = onlyRow(queue)
  assert.deepEqual(JSON.parse(waiting.payload), { n: 2 }, 'the newer payload survived the running attempt')
  // A restart on the same queue dispatches the surviving row with the newer payload.
  const seen: unknown[] = []
  const restarted = new Effects(queue, undefined, () => 0)
  restarted.handle('launch', payload => { seen.push(payload); return Promise.resolve() })
  restarted.start()
  await restarted.idle()
  assert.deepEqual(seen, [{ n: 2 }])
})

test('Later reschedules without counting a failure', async () => {
  const queue = new MemoryQueue()
  const effects = new Effects(queue, undefined, () => 0)
  effects.handle('relay', () => Promise.reject(new Later('paused')), { retry: [5000, 60_000] })
  effects.enqueue('relay', 'r1', {})
  effects.start()
  await effects.idle()
  const row = onlyRow(queue)
  assert.equal(row.attempts, 0)
  assert.equal(row.error, '')
  assert.equal(row.due, 5000)
})

test('failures back off, record the message, and reach health error at the threshold', async () => {
  const queue = new MemoryQueue()
  const entries: { state: string; detail: string }[] = []
  let ticks = 0
  const effects = new Effects(queue, { claim: () => ({ set: entry => { entries.push(entry) } }) }, () => ticks)
  effects.handle('launch', () => Promise.reject(new Error('boom')), { retry: [1000, 4000] })
  effects.enqueue('launch', 'a1', {})
  effects.start()
  await effects.idle()
  let row = onlyRow(queue)
  assert.equal(row.attempts, 1)
  assert.equal(row.error, 'Error: boom')
  assert.equal(row.due, 1000, 'first backoff is the initial delay')
  ticks = 1000
  effects.kick()
  await settle()
  await effects.idle()
  row = onlyRow(queue)
  assert.equal(row.attempts, 2)
  assert.equal(row.due, 1000 + 2000, 'second backoff doubles')
  ticks = row.due
  effects.kick()
  await settle()
  await effects.idle()
  row = onlyRow(queue)
  assert.equal(row.attempts, 3)
  assert.equal(row.due, 1000 + 2000 + 4000, 'third backoff is capped at the maximum')
  assert.equal(row.attempts, FAILURES_BEFORE_ERROR)
  assert.equal(entries.at(-1)!.state, 'error', 'health reports error at the failure threshold')
  assert.match(entries.at(-1)!.detail, /boom/)
})

test('an ordered kind blocks behind its head row until that row completes', async () => {
  const queue = new MemoryQueue()
  const effects = new Effects(queue, undefined, () => 0)
  const { calls, handlerBody } = harness()
  effects.handle('notice', handlerBody, { ordered: true })
  effects.enqueue('notice', 'n1', {})
  effects.enqueue('notice', 'n2', {})
  effects.start()
  await settle()
  assert.equal(calls.length, 1, 'only the head row runs')
  calls[0]!.resolve()
  await settle()
  assert.equal(calls.length, 2, 'the next row runs after the head completes')
  calls[1]!.resolve()
  await effects.idle()
  assert.equal(queue.rows.size, 0)
})

test('an unknown native send parks its row instead of retrying', async () => {
  const queue = new MemoryQueue()
  const effects = new Effects(queue, undefined, () => 0)
  const seen: unknown[] = []
  effects.handle('answer', payload => { seen.push(payload); return Promise.reject(new UnknownSend('ack lost', 'transport_lost')) }, { retry: [1000, 60_000] })
  effects.enqueue('answer', 'q1', { optionIds: ['deny'] })
  effects.start()
  await effects.idle()
  assert.deepEqual(seen, [{ optionIds: ['deny'] }])
  const parked = queue.parked('answer')
  assert.equal(parked.length, 1)
  assert.match(parked[0]!.parkedReason, /transport_lost: ack lost/)
  assert.equal(effects.pending('answer'), true, 'parked rows still count as pending')
  // Time passing and further kicks never redispatch a parked row.
  for (let i = 0; i < 3; i++) { effects.kick(); await settle(); await effects.idle() }
  assert.equal(queue.parked('answer').length, 1)
  assert.equal([...queue.rows.values()].filter(row => !row.parkedAt).length, 0)
  effects.enqueue('answer', 'q1', { optionIds: ['allow'] })
  assert.equal(queue.parked('answer').length, 1, 'a parked row is not coalesced back into dispatch')
  effects.cancel('answer', 'q1')
  assert.equal(queue.parked('answer').length, 0, 'cancel drops a parked row for reconcile takeover elsewhere')
})

test('drain leaves waiting rows for the next start', async () => {
  const queue = new MemoryQueue()
  const effects = new Effects(queue, undefined, () => 0)
  effects.handle('delivery', () => Promise.resolve(), { limit: () => 0 })
  effects.enqueue('delivery', 'd1', {})
  effects.start()
  await effects.drain()
  assert.equal(queue.rows.size, 1, 'the held row stays durable')
})
