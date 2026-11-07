import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createPersonalEngine } from '../../packages/orchestrator-core/dist/index.js'
import { JsonSchema } from '../../packages/contracts/dist/index.js'
import { bindCoreRepositories } from '../../apps/coordinator/main.ts'
import { createRuntimeIngress, jsonDigest, IngressError } from '../../apps/coordinator/runtime-ingress.ts'
import { initialTicket, binding, producer, turnPayload, exitPayload, fact } from './runtime-ingress-fixture.ts'

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'g1-ingress-sqlite-'))
  const path = join(directory, 'fixture.sqlite')
  let database, core
  const payloads = new Map()
  const trace = []
  function open() {
    database = new ProductStore({ path, artifactsRoot: join(directory, 'artifacts') })
    // Test-only schema: production runtime tables/migrations remain owned by WP-02.
    database.db.exec(`
      CREATE TABLE IF NOT EXISTS review_ingress_bindings (attempt_id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS review_ingress_current (ticket_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS review_ingress_authority (work_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, digest TEXT NOT NULL, enabled INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS review_ingress_observations (fact_id TEXT PRIMARY KEY, disposition TEXT NOT NULL, payload TEXT NOT NULL);
    `)
    core = createPersonalEngine({
      repo: bindCoreRepositories(database),
      policy: () => ({ version: 'v1', paused: false, gate: () => ({ admissible: false, reason: 'fixture' }), revalidate: () => true, admitsInferred: () => false, evalTimeoutMs: 1000 }),
      scope: { scope: () => ({ listened: true, observed: false }) }, assessor: { request: () => {} },
      executor: { start: () => {}, deliver: () => {}, stop: () => {} }, outbox: { send: () => {}, withdraw: () => {}, status: () => undefined },
      completionPolicy: () => { throw new Error('Preseeded fixture only') },
      isCurrentContract: ref => database.db.prepare('SELECT 1 FROM review_ingress_authority WHERE work_id = ? AND revision = ? AND digest = ? AND enabled = 1').get(ref.workId, ref.revision, ref.digest) !== undefined,
    })
  }
  const within = label => { trace.push({ label, nesting: database.uow.nesting }); assert.ok(database.uow.nesting > 0, `${label} is outside the transaction`) }
  const ports = {
    nesting: () => database.uow.nesting,
    atomic: work => database.uow.atomic(work),
    binding: id => { within('known-binding'); const row = database.db.prepare('SELECT value FROM review_ingress_bindings WHERE attempt_id = ?').get(id); return row ? JSON.parse(row.value) : undefined },
    current: id => { within('current-binding'); const row = database.db.prepare('SELECT value FROM review_ingress_bindings b JOIN review_ingress_current c ON c.attempt_id = b.attempt_id WHERE c.ticket_id = ?').get(id); return row ? JSON.parse(row.value) : undefined },
    ticket: id => { within('core-ticket'); return database.domain.tickets.get(id) },
    authorized: ticket => { within('authority'); const ref = ticket.completion.contract; return !!database.db.prepare('SELECT 1 FROM review_ingress_authority WHERE work_id = ? AND revision = ? AND digest = ? AND enabled = 1').get(ref.workId, ref.revision, ref.digest) },
    facts: {
      get: id => { within('fact-get'); return database.facts.get(id) },
      record: (id, digest, apply) => { within('fact-record'); return database.facts.record(id, digest, apply) },
    },
    applyBusiness: (input, payload) => {
      within('business-reducer')
      if (payload.kind === 'turn.ended') core.personalExecutor().turnEnded(input.ticketId, input.assignmentId)
      database.db.prepare('INSERT INTO review_ingress_observations VALUES (?, ?, ?)').run(input.factId, 'business', JSON.stringify(payload))
      database.queue.enqueue('review-notify', input.factId, input.payloadRef, database.queue.maxSeq() + 1, 0, '2026-11-07T00:00:00Z')
    },
    applyPhysical: (input, payload) => { within('physical-reducer'); database.db.prepare('INSERT INTO review_ingress_observations VALUES (?, ?, ?)').run(input.factId, 'physical_only', JSON.stringify(payload)) },
  }
  const reader = { read: async id => { assert.equal(database.uow.nesting, 0); const item = payloads.get(id); if (!item) throw new Error('missing immutable payload'); return structuredClone(item) } }
  open()
  database.uow.atomic(() => {
    database.domain.tickets.save(initialTicket())
    database.db.prepare('INSERT INTO review_ingress_bindings VALUES (?, ?)').run(binding.attemptId, JSON.stringify(binding))
    database.db.prepare('INSERT INTO review_ingress_current VALUES (?, ?)').run(binding.ticketId, binding.attemptId)
    database.db.prepare('INSERT INTO review_ingress_authority VALUES (?, ?, ?, 1)').run(binding.contract.workId, binding.contract.revision, binding.contract.digest)
  })
  t.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }) })
  return {
    get database() { return database }, get core() { return core }, ports, reader, trace, payloads,
    ingress: createRuntimeIngress(ports, reader),
    add(payload = turnPayload, id = 'fact-1') { const input = fact(payload, id); payloads.set(input.payloadRef, { value: structuredClone(payload), sha256: jsonDigest(JsonSchema.parse(payload)) }); return input },
    reopen() { database.close(); open() },
    observations() { return database.db.prepare('SELECT * FROM review_ingress_observations').all() },
  }
}

test('real SQLite commits core turn, normalized observation, queued effect and fact receipt together', async t => {
  const h = fixture(t), input = h.add()
  const result = await h.ingress.recordFenced(input, producer)
  assert.equal(result.accepted, true)
  assert.equal(h.database.uow.nesting, 0)
  assert.equal(h.database.facts.get(input.factId).seq, result.receipt.seq)
  assert.equal(h.database.events.cursor(), result.receipt.seq)
  assert.equal(h.database.queue.dueRows('review-notify', 0, 10).length, 1)
  assert.equal(h.observations().length, 1)
  assert.ok(h.database.domain.tickets.get(binding.ticketId).assignments[0].idleAt)
  assert.equal(h.database.domain.tickets.get(binding.ticketId).ended, undefined)
  assert.ok(h.trace.every(entry => entry.nesting >= 1))
})
test('reopening the database replays the same durable receipt without changing core/effects/cursor', async t => {
  const h = fixture(t), input = h.add()
  const first = await h.ingress.recordFenced(input, producer)
  h.reopen()
  const replay = await h.ingress.recordFenced(input, producer)
  assert.deepEqual(replay.receipt, first.receipt)
  assert.equal(replay.replayed, true)
  assert.equal(h.observations().length, 1)
  assert.equal(h.database.queue.dueRows('review-notify', 0, 10).length, 1)
  assert.equal(h.database.events.cursor(), first.receipt.seq)
})
test('a receipt INSERT failure rolls back core, observation, effect and its event in real SQLite', async t => {
  const h = fixture(t), input = h.add(), before = h.database.events.cursor()
  h.database.db.exec("CREATE TRIGGER review_fail_receipt BEFORE INSERT ON fact_receipts BEGIN SELECT RAISE(ABORT, 'review receipt failure'); END")
  await assert.rejects(h.ingress.recordFenced(input, producer), /review receipt failure/)
  assert.equal(h.database.facts.get(input.factId), undefined)
  assert.equal(h.observations().length, 0)
  assert.equal(h.database.queue.dueRows('review-notify', 0, 10).length, 0)
  assert.equal(h.database.events.cursor(), before)
  assert.equal(h.database.domain.tickets.get(binding.ticketId).assignments[0].idleAt, undefined)
  h.database.db.exec('DROP TRIGGER review_fail_receipt')
  assert.equal((await h.ingress.recordFenced(input, producer)).accepted, true)
})
test('current binding replacement during payload read refuses the old business fact with no row', async t => {
  const h = fixture(t), input = h.add()
  const ingress = createRuntimeIngress(h.ports, { read: async id => {
    const resolved = await h.reader.read(id)
    h.database.uow.atomic(() => h.database.db.prepare('UPDATE review_ingress_current SET attempt_id = ?').run('attempt-2'))
    return resolved
  } })
  assert.deepEqual(await ingress.recordFenced(input, producer), { accepted: false, reason: 'attempt_mismatch' })
  assert.equal(h.database.facts.get(input.factId), undefined)
  assert.equal(h.observations().length, 0)
})
test('retired work keeps known old physical observations while rejecting new business facts', async t => {
  const h = fixture(t)
  h.core.retireTicket(binding.ticketId, 'new contract')
  h.database.db.prepare('UPDATE review_ingress_bindings SET value = ?').run(JSON.stringify({ ...binding, state: 'ended' }))
  h.database.db.prepare('UPDATE review_ingress_current SET attempt_id = ?').run('attempt-2')
  const oldExit = await h.ingress.recordFenced(h.add(exitPayload, 'exit-1'), producer)
  assert.equal(oldExit.accepted && oldExit.disposition, 'physical_only')
  assert.equal((await h.ingress.recordFenced(h.add(turnPayload, 'turn-2'), producer)).accepted, false)
  assert.equal(h.database.domain.tickets.get(binding.ticketId).ended.outcome, 'stopped')
  assert.equal(h.observations()[0].disposition, 'physical_only')
})
test('duplicate known receipt after authorization revocation is returned without a new business action', async t => {
  const h = fixture(t), input = h.add(), first = await h.ingress.recordFenced(input, producer)
  h.database.db.prepare('UPDATE review_ingress_authority SET enabled = 0').run()
  const result = await h.ingress.recordFenced(input, producer)
  assert.equal(result.accepted && result.replayed, true)
  assert.deepEqual(result.receipt, first.receipt)
  assert.equal((await h.ingress.recordFenced(h.add(turnPayload, 'fact-new'), producer)).accepted, false)
  assert.equal(h.observations().length, 1)
})
test('a changed same-ID payload conflicts after reopening and cannot overwrite the original receipt', async t => {
  const h = fixture(t), input = h.add(), first = await h.ingress.recordFenced(input, producer)
  h.reopen()
  const altered = h.add({ ...turnPayload, value: { ...turnPayload.value, nativeTurnRef: 'turn-2' } })
  await assert.rejects(h.ingress.recordFenced(altered, producer), error => error instanceof IngressError && error.code === 'fact_conflict')
  assert.equal(h.database.facts.get(input.factId).seq, first.receipt.seq)
  assert.equal(h.observations().length, 1)
})
