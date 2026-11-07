/**
 * Production runtime-ingress storage: binding history vs the current pointer, immutable binding
 * identity, enabled-contract authority, and immutable content-addressed payloads.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { BindingConflict, canonicalDigest, ProductStore } from '../src/index.ts'
import { makeStore, tempDir, withStore } from './helpers.ts'

const contract = { workId: 'work-1', revision: 2, digest: 'digest-1' }
const binding = (overrides: Record<string, unknown> = {}) => ({
  attemptId: 'attempt-1', ticketId: 'ticket-1', assignmentId: 'assignment-1', fenceEpoch: 3,
  contract, runnerIdentityRef: 'runner-1', source: 'codex', state: 'active' as const,
  resources: [{ ref: 'resource-1', ownership: 'spawned_process' as const }],
  bridgeNote: { kept: true },
  ...overrides,
})
type StoredBinding = ReturnType<typeof binding>

test('bindings keep history distinct from the current pointer, and ended attempts stay known', async () => {
  await withStore(({ store }) => {
    store.bindings.record(binding())
    store.bindings.setCurrent('ticket-1', 'attempt-1')
    assert.deepEqual(store.bindings.binding<StoredBinding>('attempt-1')?.bridgeNote, { kept: true }, 'complete binding JSON is preserved')
    assert.equal(store.bindings.current('ticket-1')?.attemptId, 'attempt-1')

    // A newer attempt becomes current; the older attempt remains in history.
    store.bindings.record(binding({ attemptId: 'attempt-2', fenceEpoch: 4 }))
    store.bindings.setCurrent('ticket-1', 'attempt-2')
    store.bindings.end('attempt-1')
    assert.equal(store.bindings.current('ticket-1')?.attemptId, 'attempt-2')
    assert.equal(store.bindings.binding('attempt-1')?.state, 'ended')
    assert.equal(store.bindings.binding('attempt-2')?.state, 'active')
    store.bindings.end('attempt-1')
    assert.equal(store.bindings.binding('attempt-1')?.state, 'ended', 'ending is idempotent')
  })
})

test('a binding identity is immutable and an ended attempt never reactivates', async () => {
  await withStore(({ store }) => {
    store.bindings.record(binding())
    assert.throws(() => store.bindings.record(binding({ fenceEpoch: 5 })), BindingConflict)
    assert.throws(() => store.bindings.record(binding({ ticketId: 'ticket-2' })), BindingConflict)
    assert.throws(() => store.bindings.record(binding({ contract: { ...contract, revision: 3 } })), BindingConflict)
    assert.throws(() => store.bindings.record(binding({ runnerIdentityRef: 'runner-2' })), BindingConflict)
    store.bindings.end('attempt-1')
    assert.throws(() => store.bindings.record(binding({ state: 'active' })), BindingConflict)
    store.bindings.record(binding({ state: 'ended' }))
    assert.equal(store.bindings.binding('attempt-1')?.state, 'ended')
    assert.throws(() => store.bindings.setCurrent('ticket-1', 'unknown-attempt'), BindingConflict)
    assert.equal(store.bindings.current('ticket-1'), undefined)
  })
})

test('the current pointer and history survive a reopen', async () => {
  const context = makeStore()
  try {
    context.store.bindings.record(binding())
    context.store.bindings.setCurrent('ticket-1', 'attempt-1')
    context.store.close()
    const reopened = new ProductStore({ path: join(context.dir, 'product.sqlite') })
    try {
      assert.equal(reopened.bindings.binding('attempt-1')?.attemptId, 'attempt-1')
      assert.equal(reopened.bindings.current('ticket-1')?.attemptId, 'attempt-1')
    } finally { reopened.close() }
  } finally { rmSync(context.dir, { recursive: true, force: true }) }
})

test('authority enables and disables the current contract revision', async () => {
  await withStore(({ store }) => {
    assert.equal(store.authority.isCurrent(contract), false)
    store.authority.enable(contract)
    assert.equal(store.authority.isCurrent(contract), true)
    store.authority.enable({ ...contract, revision: 3 })
    assert.equal(store.authority.isCurrent({ ...contract, revision: 3 }), true)
    store.authority.disable(contract)
    assert.equal(store.authority.isCurrent(contract), false)
    assert.equal(store.authority.isCurrent({ ...contract, revision: 3 }), true, 'other revisions are independent')
  })
})

test('payloads are immutable, content-addressed, and read back with the canonical digest', async () => {
  await withStore(async ({ store }) => {
    const written = store.payloads.write({ b: 1, a: [true, null, 'x'] })
    assert.match(written.ref, /^payload:[0-9a-f]{64}$/)
    assert.equal(written.ref, `payload:${written.sha256}`)
    assert.equal(written.sha256, canonicalDigest({ b: 1, a: [true, null, 'x'] }))

    // Key order does not change the canonical payload identity.
    const again = store.payloads.write({ a: [true, null, 'x'], b: 1 })
    assert.equal(again.ref, written.ref)
    assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM ingress_payloads').get() as { n: number }).n, 1)

    const resolved = await store.payloads.read(written.ref)
    assert.deepEqual(resolved.value, { a: [true, null, 'x'], b: 1 })
    assert.equal(resolved.sha256, written.sha256)
    await assert.rejects(store.payloads.read('payload:missing'), /Unknown immutable payload/)
  })
})
