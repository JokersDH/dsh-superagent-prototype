#!/usr/bin/env node
/**
 * Milestone-03 final control consumer — zero-model only.
 *
 *   node tests/product-acceptance/m03-control.mjs --preflight
 *   node tests/product-acceptance/m03-control.mjs --audit
 *   node tests/product-acceptance/m03-control.mjs --controlled
 *
 * Budget is 4/4, so --run never sends: it refuses. The consumer observes the original Store by
 * work -> primary ticket link -> attempt/binding -> native turn facts -> question/answer/steer ->
 * stop -> barrier/resource observations. Physical running state comes from dispatch.observed /
 * turn.ended and original resource observations, never from a global ps enumeration or a PID diff.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = resolve('.')
const PRIVATE = process.env.PA_E_M03_CONTROL_ROOT ?? '/Users/hh/Desktop/joker/pa-artifacts/m03-e-live'
const STATE_DB = process.env.PA_E_M03_STATE ?? join(process.env.HOME, 'Library/Application Support/PersonalAgent/Preview-d3ba0ec6dccc5eac/data/state.sqlite')
const EVIDENCE_DIR = join(ROOT, 'tests/product-acceptance/evidence')
const PKG = { zip: '/Users/hh/Desktop/joker/pa-artifacts/m03-preview-d3ba0ec/PersonalAgent-Preview-d3ba0ec.zip',
  outer: '163b32170680bcbdb324a4fd8edc631bdfb685633911a787c3b3de353577075b',
  source: '83f79e8249efd68f429f2b6828ea233278071737', build: 'd3ba0ec6dccc5eac' }
const ORIGINAL = {
  workId: '6dd113a40e7656be47c023494c61c3e7',
  contractDigest: '65dac49411e34936225ed3c7042a1fca5152983cbabbf53b26cdb9795bbb3a0a',
  ticketId: 'a7c31233b1859ba7515169eab72e6275',
  assignmentId: 'e9dbd4b2882d8ea51428267d17099a88',
  attemptId: 'attempt-b5f967fe-022d-45ad-b838-70dc20e87a6b',
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const db = () => new DatabaseSync(STATE_DB, { readOnly: true })
const all = (sql, params = []) => { const value = db(); try { return value.prepare(sql).all(...params) } finally { value.close() } }
const lit = value => typeof value === 'string' ? JSON.parse(value) : value

/** Resolve work -> primary ticket link -> ticket/attempt. No second lifecycle or scheduler. */
export function resolveWork(workId) {
  const link = all("select * from ticket_links where work_id=? and role='primary' order by revision desc limit 1", [workId])[0]
  if (!link) return { resolved: false, reason: 'primary_ticket_link_missing' }
  const ticket = all('select id, value from ticket where id=?', [link.ticket_id])[0]
  if (!ticket) return { resolved: false, reason: 'ticket_missing', ticketId: link.ticket_id }
  const value = lit(ticket.value)
  const assignmentId = value.assignments?.[0]?.id ?? null
  const current = all('select * from runtime_current where ticket_id=?', [ticket.id])[0] ?? null
  const observations = all('select * from runtime_observations where ticket_id=? order by observed_at', [ticket.id])
  const attemptIds = [...new Set([...observations.map(row => row.attempt_id),
    ...all('select attempt_id from runtime_bindings where ticket_id=?', [ticket.id]).map(row => row.attempt_id),
    ...(current ? [current.attempt_id] : [])])]
  return {
    resolved: true, workId, contract: lit(link.value).contract, ticketId: ticket.id, assignmentId,
    ticket: value, attemptIds,
    binding: attemptIds.length === 1 ? all('select attempt_id, state from runtime_bindings where attempt_id=?', [attemptIds[0]])[0] ?? null : null,
    observations: observations.map(row => ({ kind: row.kind, disposition: row.disposition, detail: lit(row.detail),
      payloadRef: row.payload_ref, observedAt: row.observed_at, attemptId: row.attempt_id })),
  }
}

/** Explain the historical live consumer's observation gap against the original data. */
export function reproduceObservationGap(workId) {
  const historical = all("select id from ticket where json_extract(value,'$.mandate.scope.contract.workId')=?", [workId])
  const linked = all("select ticket_id from ticket_links where work_id=? and role='primary'", [workId])
  const actual = all("select id from ticket where json_extract(value,'$.mandate.basis.scope.contract.workId')=?", [workId])
  return { historicalPathHits: historical.length, primaryLinkHits: linked.length,
    actualPathHits: actual.length,
    explanation: 'The earlier live consumer resolved the ticket from a JSON path that returns no row on this original data, so it kept treating the attempt as not observed and wrote UNKNOWN at 08:42:55 while the native facts show dispatch.observed at 08:41:12 and turn.ended at 08:46:39. This is a consumer observation defect proven against the original Store; it is not a claim about the product cause.' }
}

/** Read the original control Work into the neutral observation shape. */
export function observeOriginal(workId = ORIGINAL.workId) {
  const resolved = resolveWork(workId)
  if (!resolved.resolved) return { resolved: false, reason: resolved.reason }
  const attemptId = resolved.attemptIds.includes(ORIGINAL.attemptId) ? ORIGINAL.attemptId : resolved.attemptIds[0]
  const questions = all('select * from user_questions where work_id=? order by opened_at', [workId]).map(row => ({
    id: row.id, validity: row.validity, openedAt: row.opened_at, value: lit(row.value),
  }))
  const answers = questions.length
    ? all(`select * from answers where question_id in (${questions.map(() => '?').join(',')}) order by recorded_at`, questions.map(q => q.id))
      .map(row => ({ answerId: row.answer_id, questionId: row.question_id, version: row.expected_version, recordedAt: row.recorded_at }))
    : []
  const steers = attemptId ? all("select * from dispatch_receipts where target=? and command_id like '%deliver%' order by updated_at", [attemptId])
    .map(row => ({ commandId: row.command_id, delivery: row.delivery, at: row.updated_at })) : []
  const begin = attemptId ? all("select * from dispatch_receipts where target=? and command_id like '%begin%'", [attemptId])
    .map(row => ({ commandId: row.command_id, delivery: row.delivery, at: row.updated_at })) : []
  const ticket = resolved.ticket
  const stopAt = ticket.ended?.at ?? null
  const barrier = all('select * from event_log where topic=? and entity_ref=?', ['runtime.barrier.confirmed', attemptId])
    .map(row => ({ at: row.at, value: lit(row.payload) })).at(-1) ?? null
  const resources = attemptId ? all('select * from resource_observations where attempt_id=? order by observed_at', [attemptId]).map(row => ({
    factId: row.fact_id, resourceRef: row.resource_ref, ownership: row.ownership, kind: row.kind,
    status: row.status, observedAt: row.observed_at,
  })) : []
  return {
    resolved: true, workId, contractDigest: resolved.contract?.digest ?? null, ticketId: resolved.ticketId,
    assignmentId: resolved.assignmentId, attemptId,
    events: resolved.observations.map(row => ({ kind: row.kind, delivery: row.detail?.delivery, outcome: row.detail?.outcome,
      at: row.observedAt })),
    begin, steers, questions, answers,
    stop: stopAt ? { requestedAt: stopAt, endedAt: stopAt, by: ticket.ended.by, outcome: ticket.ended.outcome } : null,
    barrier: barrier ? { at: barrier.at, writerFactId: barrier.value?.writerFactId, barrierCommandId: barrier.value?.barrierCommandId } : null,
    resources,
    binding: resolved.binding, assignmentState: ticket.assignments?.[0]?.state ?? null,
  }
}

const PASS = 'PASS', FAIL = 'FAIL', UNKNOWN = 'UNKNOWN', NOT_TRIGGERED = 'NOT_TRIGGERED', PARTIAL = 'PARTIAL'

/** Pure control decision over original identities; no product writes and no second scheduler. */
export function evaluateControl(obs) {
  if (!obs?.resolved) return { ok: false, status: 'FAIL', reason: obs?.reason ?? 'unresolved' }
  const turnEnd = obs.events.filter(event => event.kind === 'turn.ended').at(-1) ?? null
  const dispatch = obs.events.filter(event => event.kind === 'dispatch.observed').at(-1) ?? null
  const phase = !dispatch ? 'not_started' : !turnEnd ? 'native_running' : 'native_ended'
  const question = obs.questions.at(-1) ?? null
  const answer = question ? obs.answers.filter(item => item.questionId === question.id).at(-1) ?? null : null
  const boundQuestion = !!question && question.value?.contract?.workId === obs.workId &&
    question.value?.contract?.digest === obs.contractDigest &&
    Array.isArray(question.value?.targets) && question.value.targets.length > 0 &&
    question.value.targets.every(target => typeof target.id === 'string' && typeof target.nativeRequestId === 'string')
  const questionStatus = !question ? NOT_TRIGGERED : !boundQuestion ? FAIL : answer ? PASS : UNKNOWN
  const answerStatus = !question ? NOT_TRIGGERED : !boundQuestion ? FAIL : answer ? PASS : UNKNOWN
  const steer = obs.steers.filter(item => item.delivery === 'native_accepted').at(-1) ?? null
  const steerStatus = steer && obs.begin.length === 1 ? PASS : obs.begin.length > 1 ? FAIL : UNKNOWN
  const stop = obs.stop
  const stopBeforeTurnEnd = stop && turnEnd ? Date.parse(stop.requestedAt) < Date.parse(turnEnd.at) : !!stop && !turnEnd
  const runningStopStatus = !stop ? UNKNOWN : stopBeforeTurnEnd && stop.outcome === 'stopped' ? PASS
    : stop.outcome === 'stopped' ? FAIL : UNKNOWN
  const barrierAfterStop = obs.barrier && stop && Date.parse(obs.barrier.at) >= Date.parse(stop.requestedAt)
  const latestByRef = new Map()
  for (const item of obs.resources.filter(entry => entry.ownership === 'spawned_process')) latestByRef.set(item.resourceRef, item)
  const fixed = [...latestByRef.values()]
  const quiescent = fixed.length > 0 && fixed.every(item => item.status === 'quiescent')
  const resourceStatus = !obs.barrier ? UNKNOWN : !fixed.length ? UNKNOWN : quiescent ? PASS : UNKNOWN
  const barrierStatus = !obs.barrier ? UNKNOWN : barrierAfterStop && quiescent ? PASS : FAIL
  const items = { question: questionStatus, answer: answerStatus, steer: steerStatus, runningStop: runningStopStatus,
    barrier: barrierStatus, resources: resourceStatus }
  const ok = items.question === PASS && items.answer === PASS && items.steer === PASS &&
    items.runningStop === PASS && items.barrier === PASS && items.resources === PASS
  const partial = !ok && items.steer === PASS && items.runningStop === PASS && items.barrier === PASS &&
    items.resources === PASS && items.question === NOT_TRIGGERED
  const action = question && !answer && obs.answerUnknown ? 'await_answer_no_resend'
    : question && !answer ? 'answer_question'
      : phase === 'native_running' && answerStatus === PASS && steerStatus !== PASS ? 'send_supplement_steer'
        : phase === 'native_running' && steerStatus === PASS && !stop ? 'stop_running_work'
          : !stop ? 'continue_observable_controls'
            : resourceStatus === UNKNOWN || barrierStatus === UNKNOWN ? 'hold_resources_unknown'
              : runningStopStatus === FAIL ? 'no_running_stop' : 'none'
  return { ok, status: ok ? PASS : partial ? PARTIAL : 'FAIL', phase, turnEndAt: turnEnd?.at ?? null,
    dispatchAt: dispatch?.at ?? null, stopBeforeTurnEnd, questionId: question?.id ?? null,
    answerId: answer?.answerId ?? null, steerCommandId: steer?.commandId ?? null,
    barrierAt: obs.barrier?.at ?? null, assignmentState: obs.assignmentState, items,
    // No resend/cleanup actions: missing answer or resource evidence stays UNKNOWN/held.
    action }
}

function writeEvidence(name, value) {
  mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 })
  mkdirSync(join(PRIVATE, 'evidence'), { recursive: true, mode: 0o700 })
  writeFileSync(join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  writeFileSync(join(PRIVATE, 'evidence', name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

const commands = {
  preflight() {
    const zip = existsSync(PKG.zip) ? readFileSync(PKG.zip) : null
    const resolved = resolveWork(ORIGINAL.workId)
    const result = { package: zip ? { outer: sha(zip), matches: sha(zip) === PKG.outer } : { missing: true },
      store: existsSync(STATE_DB), resolved, openQuestions: all("select count(*) n from user_questions where validity='open'")[0]?.n ?? null }
    console.log(JSON.stringify(result, null, 1))
    if (!zip || sha(zip) !== PKG.outer || !resolved.resolved) process.exitCode = 1
  },
  audit() {
    const obs = observeOriginal()
    const gap = reproduceObservationGap(ORIGINAL.workId)
    const decision = evaluateControl(obs)
    const evidence = { at: new Date().toISOString(), kind: 'original-store-audit', original: ORIGINAL,
      observationGap: gap, observation: obs, decision,
      physicalVsCore: {
        coreAssignmentState: obs.assignmentState,
        nativeDispatchAt: decision.dispatchAt,
        nativeTurnEndedAt: decision.turnEndAt,
        caveat: 'Core assignment.state is a business state and can remain running while waiting for acceptance after the native turn ended. Physical running is inferred only from dispatch.observed without a later turn.ended plus the original resource observations.',
        consumerTimeline: { unknownWrittenAt: '2026-11-20T08:42:55.410Z', dispatchObservedAt: '2026-11-20T08:41:12.531Z',
          turnEndedAt: '2026-11-20T08:46:39.983Z', humanStopAt: '2026-11-20T08:56:38.159Z' },
      },
      scope: 'This is read-only original evidence. It preserves the failed live control chain; controlled results are reported separately.' }
    writeEvidence('m03-control-audit.json', evidence)
    console.log(JSON.stringify({ decision, gap, observation: { phase: decision.phase, dispatchAt: decision.dispatchAt,
      turnEndAt: decision.turnEndAt, assignmentState: decision.assignmentState, stop: obs.stop,
      barrier: obs.barrier, resources: obs.resources, questions: obs.questions.length,
      answers: obs.answers.length, steers: obs.steers.length, begins: obs.begin.length } }, null, 1))
    if (decision.ok) process.exitCode = 1
  },
  controlled() {
    console.log(JSON.stringify({ refused: true, reason: 'self_filled_simulation_retired',
      replacement: 'node tests/product-acceptance/m03-real-consumer.mjs --verify' }, null, 1))
    process.exitCode = 3
  },
  run() {
    console.log(JSON.stringify({ refused: true, reason: 'milestone_budget_exhausted_4_of_4',
      message: 'No real Work, continue or begin may be sent. Use --audit and --controlled for zero-model evidence.' }, null, 1))
    process.exitCode = 2
  },
}

const argv = process.argv.slice(2)
try {
  if (argv.includes('--preflight')) commands.preflight()
  else if (argv.includes('--audit')) commands.audit()
  else if (argv.includes('--controlled')) commands.controlled()
  else if (argv.includes('--run')) commands.run()
  else { console.log('usage: --preflight | --audit | --controlled | --run (always refuses)'); process.exitCode = 2 }
} catch (error) {
  console.error(`m03-control failed: ${String(error?.message ?? error).slice(0, 800)}`)
  process.exitCode = 1
}
