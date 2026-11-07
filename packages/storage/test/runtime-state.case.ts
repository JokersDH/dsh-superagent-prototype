/**
 * Batch 1 invariants: the current pointer cannot move across tickets, back in epoch, or to an ended
 * attempt; binding state only advances; resources are append-only; a Work has one enabled contract
 * revision. Includes the v3 → v4 upgrade and frozen v1–v3 migration checksums.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  applyMigrations, AuthorityConflict, BindingConflict, MIGRATIONS, migrationChecksum, ProductStore, PRODUCT_SCHEMA_VERSION,
} from '../src/index.ts'
import { makeStore, tempDir, withStore } from './helpers.ts'

const contract = { workId: 'work-1', revision: 1, digest: 'digest-1' }
const binding = (overrides: Record<string, unknown> = {}) => ({
  attemptId: 'attempt-1', ticketId: 'ticket-1', assignmentId: 'assignment-1', fenceEpoch: 1,
  contract, runnerIdentityRef: 'runner-1', source: 'codex', state: 'active' as const,
  resources: [{ ref: 'resource-1', ownership: 'spawned_process' as const }],
  ...overrides,
})

test('the current pointer refuses another ticket, an ended attempt, and a backward or ambiguous epoch', async () => {
  await withStore(({ store }) => {
    store.bindings.record(binding())
    store.bindings.record(binding({ attemptId: 'attempt-2', ticketId: 'ticket-2' }))
    store.bindings.record(binding({ attemptId: 'attempt-3', fenceEpoch: 3 }))
    store.bindings.record(binding({ attemptId: 'attempt-4', fenceEpoch: 3 }))
    store.bindings.setCurrent('ticket-1', 'attempt-1')
    store.bindings.setCurrent('ticket-1', 'attempt-1')
    assert.equal(store.bindings.current('ticket-1')?.attemptId, 'attempt-1', 'the same pointer retry is an idempotent no-op')

    assert.throws(() => store.bindings.setCurrent('ticket-1', 'attempt-2'), (error: unknown) =>
      error instanceof BindingConflict && /belongs to ticket ticket-2/.test((error as Error).message))
    assert.throws(() => store.bindings.setCurrent('ticket-2', 'attempt-1'), BindingConflict)

    store.bindings.setCurrent('ticket-1', 'attempt-3')
    assert.throws(() => store.bindings.setCurrent('ticket-1', 'attempt-1'), (error: unknown) =>
      error instanceof BindingConflict && /newer current epoch/.test((error as Error).message))
    assert.throws(() => store.bindings.setCurrent('ticket-1', 'attempt-4'), (error: unknown) =>
      error instanceof BindingConflict && /shares epoch/.test((error as Error).message))

    // An ended attempt can never become current; the current attempt ending does not move the pointer.
    store.bindings.record(binding({ attemptId: 'attempt-5', fenceEpoch: 5, state: 'ended' }))
    assert.throws(() => store.bindings.setCurrent('ticket-1', 'attempt-5'), (error: unknown) =>
      error instanceof BindingConflict && /Ended attempt/.test((error as Error).message))
    store.bindings.end('attempt-3')
    assert.equal(store.bindings.current('ticket-1')?.attemptId, 'attempt-3', 'ending the current attempt leaves the pointer as history')
    assert.equal(store.bindings.binding('attempt-3')?.state, 'ended', 'history stays readable')
  })
})

test('binding state only advances and resources are append-only with immutable ownership', async () => {
  await withStore(({ store }) => {
    store.bindings.record(binding())
    store.bindings.record(binding({ state: 'stopping' }))
    assert.equal(store.bindings.binding('attempt-1')?.state, 'stopping')
    assert.throws(() => store.bindings.record(binding({ state: 'active' })), (error: unknown) =>
      error instanceof BindingConflict && /cannot move from stopping back to active/.test((error as Error).message))
    store.bindings.record(binding({ state: 'ended' }))
    assert.throws(() => store.bindings.record(binding({ state: 'stopping' })), BindingConflict)
    store.bindings.record(binding({ state: 'ended' }))
    assert.equal(store.bindings.binding('attempt-1')?.state, 'ended', 'ended → ended remains an idempotent update')

    // Resources: appending is allowed; removing or replacing the ownership of a registered resource is not.
    store.bindings.record(binding({ attemptId: 'attempt-2', state: 'active', resources: [{ ref: 'resource-1', ownership: 'spawned_process' }, { ref: 'resource-2', ownership: 'shared_service_session' }] }))
    assert.equal(store.bindings.binding('attempt-2')?.resources.length, 2)
    assert.throws(() => store.bindings.record(binding({ attemptId: 'attempt-2', resources: [{ ref: 'resource-2', ownership: 'shared_service_session' }] })), (error: unknown) =>
      error instanceof BindingConflict && /cannot be removed/.test((error as Error).message))
    assert.throws(() => store.bindings.record(binding({ attemptId: 'attempt-2', resources: [{ ref: 'resource-1', ownership: 'shared_service_session' }, { ref: 'resource-2', ownership: 'shared_service_session' }] })), (error: unknown) =>
      error instanceof BindingConflict && /cannot change ownership/.test((error as Error).message))
    assert.equal(store.bindings.binding('attempt-2')?.resources.length, 2, 'refused updates did not persist')
  })
})

test('one enabled contract revision per Work; re-issued revision digests conflict; revocation survives a reopen', async () => {
  const context = makeStore()
  try {
    const { store } = context
    store.authority.enable(contract)
    assert.throws(() => store.authority.enable({ ...contract, revision: 2, digest: 'digest-2' }), AuthorityConflict)
    assert.throws(() => store.authority.enable({ ...contract, digest: 'digest-reissued' }), (error: unknown) =>
      error instanceof AuthorityConflict && /refusing a different digest/.test((error as Error).message))
    store.uow.atomic(() => {
      store.authority.disable(contract)
      store.authority.enable({ ...contract, revision: 2, digest: 'digest-2' })
    })
    assert.deepEqual(store.authority.current(contract.workId), { workId: 'work-1', revision: 2, digest: 'digest-2' })
    store.authority.disable({ ...contract, revision: 2, digest: 'digest-2' })
    store.close()

    const reopened = new ProductStore({ path: join(context.dir, 'product.sqlite') })
    try {
      assert.equal(reopened.authority.isCurrent(contract), false, 'the previously enabled revision stays revoked after a reopen')
      assert.equal(reopened.authority.isCurrent({ ...contract, revision: 2, digest: 'digest-2' }), false)
      assert.equal(reopened.authority.current(contract.workId), undefined)
      assert.deepEqual(reopened.authority.history(contract.workId).map(row => [row.revision, row.enabled]), [[2, false], [1, false]])
      // No enabled revision: the old rows cannot be re-used implicitly, only an explicit enable restores one.
      assert.throws(() => reopened.authority.enable({ ...contract, revision: 2, digest: 'different' }), AuthorityConflict)
      reopened.authority.enable({ ...contract, revision: 2, digest: 'digest-2' })
      assert.equal(reopened.authority.isCurrent({ ...contract, revision: 2, digest: 'digest-2' }), true)
    } finally { reopened.close() }
  } finally { rmSync(context.dir, { recursive: true, force: true }) }
})

test('a failed transaction rolls the current pointer and authority back together', async () => {
  await withStore(({ store }) => {
    store.bindings.record(binding())
    store.bindings.record(binding({ attemptId: 'attempt-2', fenceEpoch: 2 }))
    store.bindings.setCurrent('ticket-1', 'attempt-1')
    store.authority.enable(contract)
    assert.throws(() => store.uow.atomic(() => {
      store.bindings.setCurrent('ticket-1', 'attempt-2')
      store.authority.disable(contract)
      store.authority.enable({ ...contract, revision: 2, digest: 'digest-2' })
      throw new Error('late failure')
    }), /late failure/)
    assert.equal(store.bindings.current('ticket-1')?.attemptId, 'attempt-1', 'pointer rolled back')
    assert.equal(store.authority.isCurrent(contract), true, 'authority rolled back')
    assert.equal(store.authority.current(contract.workId)?.revision, 1)
  })
})

test('migrations v1–v3 checksums stay frozen', () => {
  assert.equal(migrationChecksum(MIGRATIONS[0]!), '6658f4334eaecdf265008e01c349223c4fab857697a21c1ca57c278b375f02cd')
  assert.equal(migrationChecksum(MIGRATIONS[1]!), 'a6555fed118d6c12fe8d3c92cd4f5bb5667e0dec3f7ef749adb5375903a9b1ab')
  assert.equal(migrationChecksum(MIGRATIONS[2]!), '8dc5bac776324f5d052fb26eb01c3f68327630b32542f98bdcce9a6e04ed1be6')
  assert.equal(PRODUCT_SCHEMA_VERSION, 4)
})

test('a v3 database upgrades to v4 with its data intact and the new invariants enforced', () => {
  const dir = tempDir()
  const path = join(dir, 'v3.sqlite')
  try {
    const v3 = new Database(path)
    v3.exec('PRAGMA journal_mode = WAL')
    applyMigrations(v3, { registry: MIGRATIONS.slice(0, 3) })
    v3.prepare('INSERT INTO runtime_bindings (attempt_id, ticket_id, state, value) VALUES (?, ?, ?, ?)')
      .run('attempt-1', 'ticket-1', 'active', JSON.stringify(binding()))
    v3.prepare('INSERT INTO runtime_current (ticket_id, attempt_id) VALUES (?, ?)').run('ticket-1', 'attempt-1')
    v3.prepare('INSERT INTO runtime_authority (work_id, revision, digest, enabled) VALUES (?, ?, ?, 1)')
      .run(contract.workId, contract.revision, contract.digest)
    v3.close()

    const upgraded = new ProductStore({ path })
    try {
      assert.equal(upgraded.database.productSchema, 4)
      assert.equal(upgraded.bindings.binding('attempt-1')?.attemptId, 'attempt-1', 'v3 binding data survives')
      assert.equal(upgraded.bindings.current('ticket-1')?.attemptId, 'attempt-1', 'v3 pointer survives')
      assert.equal(upgraded.authority.isCurrent(contract), true, 'v3 enabled authority survives')
      // The v4 invariant applies after the upgrade.
      assert.throws(() => upgraded.authority.enable({ ...contract, revision: 2, digest: 'digest-2' }), AuthorityConflict)
      assert.deepEqual(upgraded.database.checkIntegrity(), { integrity: 'ok', foreignKeyViolations: 0 })
    } finally { upgraded.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
