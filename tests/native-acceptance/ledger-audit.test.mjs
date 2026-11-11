/**
 * Negative cases for the B1 ledger audit (wave-06).
 *
 * The audit exists because `grantView()` answers `used: 0, remaining: 4` when no ledger exists.
 * Each test below builds a ledger that *looks* fine and proves the audit refuses to turn a
 * missing, corrupt, incomplete or contradictory record into spendable capacity.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { auditGrant, maySendReal } from './ledger-audit.mjs'

const dir = () => mkdtempSync(join(tmpdir(), 'pa-ledger-audit-'))
const write = (ledger) => {
  const path = join(dir(), 'model-budget.json')
  writeFileSync(path, JSON.stringify(ledger, null, 2))
  return path
}
const GRANT = 'wave03-b-native'

test('a missing ledger is UNVERIFIED, never "nothing was spent"', () => {
  const path = join(dir(), 'model-budget.json') // deliberately not created
  const audit = auditGrant(path, GRANT, 4, { used: 0, source: 'wave03-status.json' })
  assert.equal(audit.verdict, 'UNVERIFIED')
  assert.equal(audit.ledgerPresent, false)
  // The trap: this is what the old helper would have granted.
  assert.equal(maySendReal(audit).allowed, false, 'a missing ledger must not release 4 slots')
})

test('a corrupt ledger is not treated as an empty one', () => {
  const path = join(dir(), 'model-budget.json')
  writeFileSync(path, '{ not json')
  const audit = auditGrant(path, GRANT, 4, { used: 0, source: 'wave03-status.json' })
  assert.equal(audit.verdict, 'UNVERIFIED')
  assert.match(audit.reasons.join(' '), /not valid JSON/)
  assert.equal(maySendReal(audit).allowed, false)
})

test('a ledger with no row for the grant is not proof of zero usage', () => {
  const path = write({ grants: [{ grantId: 'some-other-grant', limit: 9, tasks: [] }] })
  const audit = auditGrant(path, GRANT, 4, { used: 0, source: 'wave03-status.json' })
  assert.equal(audit.verdict, 'UNVERIFIED')
  assert.equal(audit.ledgerGrantFound, false)
  assert.equal(maySendReal(audit).allowed, false)
})

test('a status doc claiming 0 while the ledger records a send is a MISMATCH', () => {
  const path = write({
    grants: [{
      grantId: GRANT, limit: 4,
      tasks: [{ taskId: 't1', commandId: 'cmd-1', state: 'sent' }],
    }],
  })
  const audit = auditGrant(path, GRANT, 4, { used: 0, source: 'wave03-status.json' })
  assert.equal(audit.verdict, 'MISMATCH')
  assert.match(audit.reasons.join(' '), /declares used=0 but the ledger records 1/)
  assert.equal(maySendReal(audit).allowed, false)
})

test('reserved and unknown both consume, so they are never free slots', () => {
  const path = write({
    grants: [{
      grantId: GRANT, limit: 4,
      tasks: [
        { taskId: 't1', commandId: 'cmd-1', state: 'reserved' },
        { taskId: 't2', commandId: 'cmd-2', state: 'unknown' },
        { taskId: 't3', commandId: 'cmd-3', state: 'aborted' },
      ],
    }],
  })
  const audit = auditGrant(path, GRANT, 4, { used: 2, source: 'status.json' })
  assert.equal(audit.recorded.consumed, 2, 'aborted frees; reserved and unknown consume')
  assert.equal(audit.verdict, 'VERIFIED')
  assert.equal(maySendReal(audit).allowed, true)
  assert.match(maySendReal(audit).reason, /2 of 4/)
})

test('a consumed task with no begin/attempt identity is UNVERIFIED', () => {
  const path = write({
    grants: [{ grantId: GRANT, limit: 4, tasks: [{ taskId: 't1', state: 'sent' }] }],
  })
  const audit = auditGrant(path, GRANT, 4, { used: 1, source: 'status.json' })
  assert.equal(audit.verdict, 'UNVERIFIED')
  assert.match(audit.reasons.join(' '), /no begin\/attempt identity/)
  assert.equal(maySendReal(audit).allowed, false)
})

test('a task with no state cannot be split into reserved/used/unknown', () => {
  const path = write({
    grants: [{ grantId: GRANT, limit: 4, tasks: [{ taskId: 't1', commandId: 'cmd-1' }] }],
  })
  const audit = auditGrant(path, GRANT, 4, { used: null, source: 'none' })
  assert.equal(audit.verdict, 'UNVERIFIED')
  assert.match(audit.reasons.join(' '), /no consumption state/)
})

test('a ledger limit that disagrees with the dispatch is a MISMATCH', () => {
  const path = write({ grants: [{ grantId: GRANT, limit: 10, tasks: [] }] })
  const audit = auditGrant(path, GRANT, 4, { used: 0, source: 'status.json' })
  assert.equal(audit.verdict, 'MISMATCH')
  assert.match(audit.reasons.join(' '), /disagrees with the dispatched limit/)
})

test('a fully consumed grant reports no remainder even when VERIFIED', () => {
  const path = write({
    grants: [{
      grantId: GRANT, limit: 4,
      tasks: [1, 2, 3, 4].map(n => ({ taskId: `t${n}`, commandId: `cmd-${n}`, state: 'sent' })),
    }],
  })
  const audit = auditGrant(path, GRANT, 4, { used: 4, source: 'status.json' })
  assert.equal(audit.verdict, 'VERIFIED')
  assert.equal(maySendReal(audit).allowed, false)
  assert.match(maySendReal(audit).reason, /no remainder/)
})

test('an honest, reconciled ledger does allow a send', () => {
  const path = write({
    grants: [{
      grantId: GRANT, limit: 4,
      tasks: [{ taskId: 't1', commandId: 'cmd-1', state: 'sent' }],
    }],
  })
  const audit = auditGrant(path, GRANT, 4, { used: 1, source: 'status.json' })
  assert.equal(audit.verdict, 'VERIFIED')
  const decision = maySendReal(audit)
  assert.equal(decision.allowed, true, 'the gate must be able to open, or it proves nothing')
  assert.match(decision.reason, /3 of 4/)
})

test('a reconstructed ledger with an UNKNOWN remainder never releases capacity', () => {
  // The dangerous regression: losing the original record and rebuilding an empty ledger must not
  // look like "4 slots free". Absence of records is not proof of no spend.
  const path = write({
    grants: [{
      grantId: GRANT, limit: 4, tasks: [],
      remainder: 'UNKNOWN', attributionState: 'UNVERIFIED',
      reconstruction: { method: 'product-side records only', productAttemptRecordsFound: 0 },
    }],
  })
  const audit = auditGrant(path, GRANT, 4, { used: null, source: 'reconstructed' })
  assert.equal(audit.verdict, 'UNVERIFIED')
  assert.match(audit.reasons.join(' '), /remainder is UNKNOWN/)
  assert.equal(maySendReal(audit).allowed, false, 'a reconstructed ledger must not unblock sends')
})

test('a reconstruction that IS reconciled may still release capacity', () => {
  const path = write({
    grants: [{
      grantId: GRANT, limit: 4, tasks: [{ taskId: 't1', commandId: 'cmd-1', state: 'sent' }],
      remainder: '3', attributionState: 'RECORDED',
    }],
  })
  const audit = auditGrant(path, GRANT, 4, { used: 1, source: 'reconstructed' })
  assert.equal(audit.verdict, 'VERIFIED')
  assert.equal(maySendReal(audit).allowed, true, 'a genuinely reconciled ledger must still work')
})
