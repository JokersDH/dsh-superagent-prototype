/**
 * B2: the budget ledger must refuse overspend under concurrency, crashes and uncertainty.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { grantView, recordTask, reserve, settle, totalSpent } from './budget.mjs'

const scratch = () => join(mkdtempSync(join(tmpdir(), 'pa-budget-')), 'ledger.json')
const grant = { grantId: 'g1', limit: 2 }

test('a reservation is durable before any send and consumes capacity', () => {
  const path = scratch()
  reserve({ ...grant, taskId: 't1', commandId: 'c1', instance: 'i1' }, path)
  // Simulate a crash: nothing was settled, yet the slot is not available to anyone else.
  const view = grantView('g1', 2, path)
  assert.equal(view.remaining, 1, 'an unsettled reservation already consumes capacity')
})

test('an uncertain send keeps consuming capacity', () => {
  const path = scratch()
  reserve({ ...grant, taskId: 't1', commandId: 'c1', instance: 'i1' }, path)
  settle({ grantId: 'g1', taskId: 't1', state: 'unknown' }, path)
  assert.equal(grantView('g1', 2, path).remaining, 1, 'an unknown outcome still costs a task')
})

test('an aborted reservation frees capacity', () => {
  const path = scratch()
  reserve({ ...grant, taskId: 't1', commandId: 'c1', instance: 'i1' }, path)
  settle({ grantId: 'g1', taskId: 't1', state: 'aborted' }, path)
  assert.equal(grantView('g1', 2, path).remaining, 2)
})

test('the same taskId is idempotent and never double-charges', () => {
  const path = scratch()
  const first = reserve({ ...grant, taskId: 't1', commandId: 'c1', instance: 'i1' }, path)
  const again = reserve({ ...grant, taskId: 't1', commandId: 'c1', instance: 'i1' }, path)
  assert.deepEqual(first.taskId, again.taskId)
  assert.equal(grantView('g1', 2, path).remaining, 1)
})

test('a settled reservation cannot be rewritten', () => {
  const path = scratch()
  reserve({ ...grant, taskId: 't1', commandId: 'c1', instance: 'i1' }, path)
  settle({ grantId: 'g1', taskId: 't1', state: 'sent' }, path)
  const after = settle({ grantId: 'g1', taskId: 't1', state: 'aborted' }, path)
  assert.equal(after.state, 'sent', 'history is immutable once settled')
})

test('the grant refuses beyond its limit', () => {
  const path = scratch()
  reserve({ ...grant, taskId: 't1', commandId: 'c1', instance: 'i1' }, path)
  reserve({ ...grant, taskId: 't2', commandId: 'c2', instance: 'i1' }, path)
  assert.throws(() => reserve({ ...grant, taskId: 't3', commandId: 'c3', instance: 'i1' }, path), /exhausted/)
})

test('a re-run cannot raise the allowance of an existing grant', () => {
  const path = scratch()
  reserve({ ...grant, taskId: 't1', commandId: 'c1', instance: 'i1' }, path)
  // A caller asking for a bigger limit must not expand the recorded grant.
  assert.throws(() => reserve({ grantId: 'g1', limit: 99, taskId: 't2', commandId: 'c2', instance: 'i1' }, path), /refusing a larger limit/)
})

test('the ledger stores no credentials or native session text', () => {
  const path = scratch()
  reserve({ ...grant, taskId: 't1', commandId: 'c1', instance: 'i1' }, path)
  settle({ grantId: 'g1', taskId: 't1', state: 'sent' }, path)
  const text = readFileSync(path, 'utf8')
  for (const forbidden of ['Bearer', 'token', 'session', 'password', 'api.key']) {
    assert.equal(text.includes(forbidden), false, `ledger must not contain ${forbidden}`)
  }
})

test('totalSpent counts every grant and uncertain sends', () => {
  const path = scratch()
  reserve({ grantId: 'g1', limit: 2, taskId: 't1', commandId: 'c1', instance: 'i' }, path)
  settle({ grantId: 'g1', taskId: 't1', state: 'unknown' }, path)
  recordTask({ grantId: 'g2', limit: 3, entry: { certain: true, workId: 'w' } }, path)
  assert.equal(totalSpent(path), 2)
})

test('a stale lock from a crashed holder is reclaimed', async () => {
  const path = scratch()
  writeFileSync(`${path}.lock`, '')
  // Age the lock past the reclaim window by rewriting it with an old mtime.
  const { utimesSync } = await import('node:fs')
  const past = new Date(Date.now() - 60_000)
  utimesSync(`${path}.lock`, past, past)
  const reservation = reserve({ ...grant, taskId: 't1', commandId: 'c1', instance: 'i1' }, path)
  assert.equal(reservation.state, 'reserved')
})
