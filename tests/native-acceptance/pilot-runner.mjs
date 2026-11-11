/**
 * Pilot run boundary (wave-06 B2): the operations E drives, with their real side effects.
 *
 * This module is deliberately pure. It parses intent, validates the preconditions that must hold
 * before anything reaches a native send, and describes what each operation would do. It performs
 * no I/O and starts no model turn, so `inspect`/`plan` can never bill a turn by accident.
 *
 * What the installed Codex 0.164.0 actually supports (verified from
 * `codex app-server generate-ts`, 751 generated bindings - this is a protocol surface check, not
 * a compatibility PASS):
 *
 *   thread/start     new thread; `ephemeral: true` keeps it off disk
 *   thread/resume    continue an existing thread by id
 *   thread/fork      branch from a thread, optionally `lastTurnId` (inclusive cut point)
 *   thread/read      read a thread without sending
 *   thread/turns/list, thread/items/list
 *
 * So "author checkpoint", "continue author session" and "fresh isolated session" are all
 * expressible natively. The choice between them is a *policy* decision below, because getting it
 * wrong silently turns the pilot's independent arm into a same-session arm.
 */
import { createHash } from 'node:crypto'

/** The three pilot arms from the pre-registered protocol. */
export const ARMS = ['no_review', 'author_continue', 'fresh_session']

/**
 * How a run obtains its conversation. Each is a distinct native operation, never an imitation.
 */


/**
 * Conservative per-turn bound. The packet is explicit that a wall-clock timeout, an already-sent
 * cancel, a single `max_output_tokens` field, or usage that only arrives at the end cannot by
 * themselves prove a native turn is bounded. So a bound must name every component it charges.
 */


/** Which session plan each arm is allowed to use. This is the anti-substitution rule. */
const ARM_SESSION = {
  no_review: ['author'],
  author_continue: ['resume_author', 'fork_author'],
  fresh_session: ['fresh'],
}

function sessionFor(request, arm) {
  switch (arm) {
    case 'fresh_session':
      // A fresh reviewer must not inherit the author's thread, and must leave no thread on disk.
      return { kind: 'fresh', ephemeral: true }
    case 'author_continue':
      if (!request.authorThreadId) {
        return { error: 'author_thread_required', detail: 'the author_continue arm must name the real author thread it continues' }
      }
      return request.lastTurnId
        ? { kind: 'fork_author', sourceThreadId: request.authorThreadId, lastTurnId: request.lastTurnId }
        : { kind: 'resume_author', sourceThreadId: request.authorThreadId }
    case 'no_review':
      return { kind: 'author', ephemeral: false }
    default:
      return { error: 'unknown_arm', detail: `unknown arm ${arm}` }
  }
}

/**
 * Validate a run request and produce its plan, or refuse.
 *
 * Order matters: the free checks run first so a misconfigured arm never reaches the budget hook,
 * and the hook runs last because calling it may reserve real capacity.
 */
export function planRun(request) {
  if (!ARMS.includes(request.arm)) {
    return { ok: false, reason: 'unknown_arm', detail: `arm must be one of ${ARMS.join(', ')}` }
  }
  const arm = request.arm

  if (!request.caseId || !Number.isInteger(request.turn) || request.turn <= 0) {
    return { ok: false, reason: 'material_digest_missing', detail: 'a run needs a stable caseId and a positive turn number' }
  }
  if (!request.materialDigest || !/^[a-f0-9]{64}$/.test(request.materialDigest)) {
    return { ok: false, reason: 'material_digest_missing', detail: 'a run must bind a 64-hex material digest, not a path or free text' }
  }
  if (request.subjectFrozen !== true) {
    return { ok: false, reason: 'subject_not_frozen', detail: 'the frozen subject must exist before any arm runs' }
  }

  const session = sessionFor(request, arm)
  if ('error' in session) return { ok: false, reason: session.error, detail: session.detail }

  // The arm/session pair must be the one this arm is allowed to use.
  if (!ARM_SESSION[arm].includes(session.kind)) {
    return { ok: false, reason: 'arm_session_mismatch', detail: `arm ${arm} may not use ${session.kind}` }
  }
  if (session.kind === 'fresh' && session.ephemeral !== true) {
    return { ok: false, reason: 'fresh_must_be_ephemeral', detail: 'a fresh reviewer thread must be ephemeral' }
  }

  const billable = arm !== 'no_review'
  const operations = [
    { name: 'inspect', billsNativeTurn: false, sideEffect: 'reads thread/session metadata only; starts nothing' },
    ...(arm === 'author_continue'
      ? [{ name: 'createAuthorCheckpoint', billsNativeTurn: false, sideEffect: 'records the author thread id and cut turn; sends nothing' }]
      : []),
    { name: 'startRun', billsNativeTurn: billable, sideEffect: billable ? 'may send a native turn after the budget hook admits it' : 'author run only; its own budget is the author experiment' },
    { name: 'reconcile', billsNativeTurn: false, sideEffect: 're-reads the thread by the original identity; never re-sends' },
    { name: 'cancel', billsNativeTurn: false, sideEffect: 'stops this run own native work; never kills a shared service' },
    { name: 'collectReport', billsNativeTurn: false, sideEffect: 'reads the returned report; does not execute anything in it' },
  ]

  if (billable) {
    if (!request.bound || !request.bound.basis.priceSource) {
      return {
        ok: false,
        reason: 'budget_refused',
        detail: 'no named price source: pricing_unavailable blocks a billable run rather than estimating a cost',
      }
    }
    if (!request.budgetHook) {
      return { ok: false, reason: 'no_budget_hook', detail: 'a billable run requires the E reservation hook; missing hook refuses rather than sends' }
    }
    let verdict
    try {
      verdict = request.budgetHook.reserve({
        caseId: request.caseId,
        arm,
        turn: request.turn,
        materialDigest: request.materialDigest,
        bound: request.bound,
      })
    } catch (error) {
      return { ok: false, reason: 'budget_refused', detail: `the reservation hook threw: ${String(error)}` }
    }
    if (!verdict?.admitted) {
      return { ok: false, reason: 'budget_refused', detail: verdict?.reason ?? 'the reservation hook did not admit this run' }
    }
  }

  return {
    ok: true,
    arm,
    session,
    identity: { caseId: request.caseId, arm, turn: request.turn, materialDigest: request.materialDigest },
    operations,
    billable,
  }
}

/** Stable digest binding a report to the exact subject it reviewed (0023 §5). */
export function subjectDigestOf(materialDigest, candidateDigest) {
  return createHash('sha256').update(JSON.stringify(['review-subject/1', materialDigest, candidateDigest])).digest('hex')
}

/**
 * Classify a returned report. A malformed, mistyped or wrong-subject report is never a PASS.
 */
export function classifyReport(report, expected) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    return { disposition: 'inconclusive', reason: 'the report is not an object; nothing can be inferred from it' }
  }
  const value = report
  if (value.protocol !== 'review-report/1') {
    return { disposition: 'rejected', reason: `unexpected protocol ${String(value.protocol)}` }
  }
  if (typeof value.subjectDigest !== 'string' || value.subjectDigest !== expected.subjectDigest) {
    return { disposition: 'rejected', reason: 'the report is bound to a different subject than the one that ran' }
  }
  const disposition = value.disposition
  if (disposition !== 'findings' && disposition !== 'no_findings' && disposition !== 'inconclusive') {
    return { disposition: 'rejected', reason: `unknown disposition ${String(disposition)}` }
  }
  const findings = Array.isArray(value.findings) ? value.findings : []
  if (disposition === 'findings' && findings.length === 0) {
    return { disposition: 'inconclusive', reason: 'the report claims findings but carries none' }
  }
  if (disposition === 'no_findings' && findings.length > 0) {
    return { disposition: 'inconclusive', reason: 'the report claims no findings but carries some' }
  }
  return { disposition: 'accepted', findings: findings.length }
}
