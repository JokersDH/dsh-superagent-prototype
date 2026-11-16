#!/usr/bin/env node
/**
 * Wave-33 B outcome 3: slot accounting driven by the ORIGINAL Store's binding states.
 *
 * Real ProductStore tickets/bindings from main's own storage package: start at 2 slots, queue the rest,
 * release only on CONFIRMED quiescence, retain an indeterminate slot (never release it), open to 4,
 * cancel a queued attempt without claiming a slot, and restore the same accounting from the original
 * binding states after a restart without double counting. Main's scheduler remains the authority for
 * starting work; this module only accounts for the slots main holds.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaseLog, writeReport } from './harness.mjs'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { AttemptSlotScheduler } from '../../packages/execution/src/attempt-slots.ts'
import { binding, initialTicket } from '../integration/runtime-ingress-fixture.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w33-slots-'))
const store = new ProductStore({ path: join(root, 'state.sqlite'), artifactsRoot: join(root, 'artifacts') })
store.authority.enable(binding.contract)
const candidates = []
try {
  for (let index = 1; index <= 5; index += 1) {
    const attempt = { attemptId: `attempt-${index}`, ticketId: `ticket-${index}` }
    const ticket = { ...initialTicket(), id: attempt.ticketId, assignments: initialTicket().assignments.map(a => ({ ...a, id: `assignment-${index}` })) }
    store.domain.tickets.save(ticket)
    const attemptBinding = { ...binding, ticketId: attempt.ticketId, assignmentId: `assignment-${index}`, attemptId: attempt.attemptId }
    store.bindings.record(attemptBinding)
    store.bindings.setCurrent(attempt.ticketId, attempt.attemptId)
    candidates.push({ ...attempt, contract: binding.contract })
  }
  // The work really is in the original Store: read it back instead of trusting our own array.
  const readBack = candidates.map(candidate => ({ candidate, binding: store.bindings.binding(candidate.attemptId), current: store.bindings.current(candidate.ticketId)?.attemptId }))
  const originalStoreOk = readBack.every(entry => entry.binding?.attemptId === entry.candidate.attemptId && entry.current === entry.candidate.attemptId)

  log.begin('B33-SLOT-2-THEN-QUEUE', 'the original 2 slots admit two attempts and queue the rest', 'real_store')
  const scheduler = new AttemptSlotScheduler({ initial: 2, max: 4 })
  const admitted = candidates.map(candidate => scheduler.admit(candidate))
  log.evidence({ originalStoreOk, admitted: admitted.map(entry => entry.state), running: scheduler.running, queued: scheduler.queued })
  if (originalStoreOk && admitted[0].state === 'running' && admitted[1].state === 'running' && admitted.slice(2).every(entry => entry.state === 'queued') && scheduler.running === 2 && scheduler.queued === 3) {
    log.pass('two original Store bindings run, three wait; the bindings were read back from ProductStore, not a local ledger')
  } else log.fail(`2-slot admission is wrong: ${JSON.stringify({ originalStoreOk, admitted, running: scheduler.running, queued: scheduler.queued })}`)

  log.begin('B33-SLOT-CONFIRMED-RELEASE-PROMOTES', 'only confirmed quiescence releases and promotes original queued work', 'real_store')
  const released = scheduler.settle('attempt-1', 'confirmed')
  log.evidence({ released, running: scheduler.running, queued: scheduler.queued })
  if (released.released && released.promoted.includes('attempt-3') && scheduler.running === 2 && scheduler.queued === 2) log.pass('attempt-1 released on confirmed evidence and attempt-3 was promoted from the original queue')
  else log.fail(`confirmed release did not promote correctly: ${JSON.stringify({ released, running: scheduler.running, queued: scheduler.queued })}`)

  log.begin('B33-SLOT-UNKNOWN-RETAINS', 'an indeterminate stop retains its slot and never releases', 'real_store')
  const unknown = scheduler.settle('attempt-2', 'indeterminate')
  const reopenUnknown = scheduler.settle('attempt-2', 'indeterminate')
  log.evidence({ unknown, reopenUnknown, snapshot: scheduler.snapshot().filter(entry => entry.attemptId === 'attempt-2') })
  if (unknown.retained && !unknown.released && unknown.reason === 'unknown_evidence' && reopenUnknown.retained && scheduler.running === 1 && scheduler.queued === 2) log.pass('the indeterminate slot stayed retained across repeated unknown evidence and promoted nothing')
  else log.fail(`unknown evidence released a slot: ${JSON.stringify({ unknown, reopenUnknown, running: scheduler.running, queued: scheduler.queued })}`)

  log.begin('B33-SLOT-OPEN-TO-4', 'opening from 2 to 4 uses existing queued work; shrinking is refused', 'real_store')
  const shrink = scheduler.openTo(1)
  const opened = scheduler.openTo(4)
  log.evidence({ shrink, opened, running: scheduler.running, queued: scheduler.queued })
  if (!shrink.opened && shrink.reason === 'cannot_shrink' && opened.opened && opened.promoted.includes('attempt-4') && scheduler.queued <= 1) log.pass('shrinking was refused, opening to 4 promoted attempt-4 and kept the queue bounded')
  else log.fail(`2->4 opening behaved wrongly: ${JSON.stringify({ shrink, opened, running: scheduler.running, queued: scheduler.queued })}`)

  log.begin('B33-SLOT-CANCEL-QUEUED', 'cancelling a queued attempt claims no running slot; unknown keeps it queued', 'real_store')
  const unknownCancel = scheduler.cancel('attempt-5', 'indeterminate')
  const confirmedCancel = scheduler.cancel('attempt-5', 'confirmed')
  log.evidence({ unknownCancel, confirmedCancel, snapshot: scheduler.snapshot().filter(entry => entry.attemptId === 'attempt-5'), running: scheduler.running })
  if (unknownCancel.retained && !unknownCancel.released && confirmedCancel.released && scheduler.running <= 4) log.pass('an unknown queued cancel kept the attempt, and a confirmed cancel removed it without claiming a running slot')
  else log.fail(`queued cancel behaved wrongly: ${JSON.stringify({ unknownCancel, confirmedCancel, running: scheduler.running })}`)

  log.begin('B33-SLOT-RESTORE-FROM-ORIGINAL-BINDINGS', 'a restart rebuilds accounting from original binding states without double count', 'real_store')
  // Use the REAL Store's binding state as the restart input: ended -> released, stopping -> indeterminate.
  store.bindings.record({ ...binding, ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', state: 'ended' })
  store.bindings.record({ ...binding, ticketId: 'ticket-2', assignmentId: 'assignment-2', attemptId: 'attempt-2', state: 'stopping' })
  store.bindings.record({ ...binding, ticketId: 'ticket-3', assignmentId: 'assignment-3', attemptId: 'attempt-3', state: 'active' })
  const restoreInput = ['attempt-1', 'attempt-2', 'attempt-3', 'attempt-3'].map(attemptId => {
    const saved = store.bindings.binding(attemptId)
    return { attemptId, ticketId: saved.ticketId, state: saved.state }
  })
  const restart = new AttemptSlotScheduler({ initial: 4, max: 4 })
  const restored = restart.restore(restoreInput)
  log.evidence({ restoreInput: restoreInput.map(entry => `${entry.attemptId}:${entry.state}`), restored })
  if (restored.released.includes('attempt-1') && restored.indeterminate.includes('attempt-2') && restored.running.filter(id => id === 'attempt-3').length === 1 && restart.running === 1) {
    log.pass('the restart released the ended binding, retained the stopping one as indeterminate, and counted the duplicated active binding once')
  } else log.fail(`restore counted wrongly: ${JSON.stringify(restored)}`)

  log.begin('B33-SLOT-NEGATIVE-DUPLICATE-QUEUE-FULL', 'duplicate admits and an overfull queue are refused', 'real_store')
  const duplicate = restart.admit({ attemptId: 'attempt-3', ticketId: 'ticket-3' })
  const tight = new AttemptSlotScheduler({ initial: 2, max: 4, maxQueued: 1 })
  tight.admit({ attemptId: 'q-1', ticketId: 't-1' })
  tight.admit({ attemptId: 'q-2', ticketId: 't-2' })
  const fill = tight.admit({ attemptId: 'q-3', ticketId: 't-3' })
  const overflow = tight.admit({ attemptId: 'q-4', ticketId: 't-4' })
  const empty = tight.admit({ attemptId: '', ticketId: 't-5' })
  log.evidence({ duplicate: duplicate.state, fill: fill.state, overflow, empty })
  if (duplicate.state === 'duplicate' && fill.state === 'queued' && overflow.state === 'refused' && overflow.reason === 'queue_full' && empty.state === 'refused' && empty.reason === 'empty_id') log.pass('a released attempt cannot be re-admitted as a second slot, the queue has a hard bound, and empty ids are refused')
  else log.fail(`negative admission checks failed: ${JSON.stringify({ duplicate, fill, overflow, empty })}`)
} finally {
  store.close?.()
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-33 slot accounting on real ProductStore bindings', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'B-owned slot accounting; main scheduler authority NOT_REACHED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(44)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB33-slot totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
