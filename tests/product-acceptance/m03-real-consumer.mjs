#!/usr/bin/env node
/**
 * Independent zero-model acceptance of mainline's real workbench control consumer.
 *
 *   node tests/product-acceptance/m03-real-consumer.mjs --verify
 *   node tests/product-acceptance/m03-real-consumer.mjs --audit <evidence-root>
 *
 * --verify runs tests/integration/original-control-browser.mjs (mainline 57243a54) into a fresh
 * persistent private directory, then audits the four original Stores itself. It never treats the
 * producer's stdout PASS as evidence, never sends a model turn, and only opens Store files read-only.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = resolve('.')
const PERSISTENT_PARENT = process.env.PA_E_M03_REAL_PARENT ?? '/Users/hh/Desktop/joker/pa-artifacts/pa-e-m03-real-independent'
const MAIN_CONSUMER = join(ROOT, 'tests/integration/original-control-browser.mjs')
const EVIDENCE = join(ROOT, 'tests/product-acceptance/evidence/m03-real-consumer.json')
const MODES = ['question', 'questionless', 'lost-answer-response', 'unknown-resource']

const all = (db, sql, params = []) => db.prepare(sql).all(...params)
const one = (db, sql, params = []) => all(db, sql, params)[0] ?? null
const lit = value => typeof value === 'string' ? JSON.parse(value) : value
const now = () => new Date().toISOString()

function auditMode(root, mode) {
  const dbPath = join(root, mode, 'state/state.sqlite')
  const failures = [], checks = {}
  const check = (name, condition, detail) => { checks[name] = { ok: !!condition, detail }; if (!condition) failures.push(name) }
  if (!existsSync(dbPath)) {
    check('store_present', false, dbPath)
    return { mode, root: join(root, mode), failures, checks }
  }
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const works = all(db, 'select * from works')
    const work = works[0] ?? null
    const workValue = work ? lit(work.value) : null
    const links = work ? all(db, 'select * from ticket_links where work_id=? and role=\'primary\'', [work.id]) : []
    const linkValue = links[0] ? lit(links[0].value) : null
    const ticket = links[0] ? one(db, 'select * from ticket where id=?', [links[0].ticket_id]) : null
    const ticketValue = ticket ? lit(ticket.value) : null
    const assignment = ticketValue?.assignments?.[0] ?? null
    const bindings = all(db, 'select * from runtime_bindings')
    const binding = bindings[0] ? { ...bindings[0], value: lit(bindings[0].value) } : null
    const attemptId = binding?.attempt_id ?? null
    const begin = attemptId ? all(db, "select * from dispatch_receipts where target=? and command_id like '%begin%'", [attemptId]) : []
    const deliver = attemptId ? all(db, "select * from dispatch_receipts where target=? and command_id like '%deliver%'", [attemptId]) : []
    const commands = all(db, 'select * from command_receipts order by seq')
    const byPrefix = prefix => commands.filter(row => row.command_id.startsWith(prefix))
    const workCommands = byPrefix('cmd-work-'), answerCommands = byPrefix('cmd-answer-')
    const chatCommands = byPrefix('cmd-chat-'), stopCommands = byPrefix('cmd-stop-')
    const questions = all(db, 'select * from user_questions')
    const question = questions[0] ? { ...questions[0], value: lit(questions[0].value) } : null
    const answers = all(db, 'select * from answers')
    const answer = answers[0] ? { ...answers[0], value: lit(answers[0].answer) } : null
    const deliveries = all(db, 'select * from answer_deliveries')
    const observations = all(db, 'select * from runtime_observations order by observed_at')
    const answerObserved = observations.filter(row => row.kind === 'answer.observed')
    const dispatches = observations.filter(row => row.kind === 'dispatch.observed' && lit(row.detail)?.delivery === 'native_accepted')
    const barriers = attemptId ? all(db, "select * from event_log where topic='runtime.barrier.confirmed' and entity_ref=? order by seq", [attemptId]) : []
    const resources = attemptId ? all(db, 'select * from resource_observations where attempt_id=? order by observed_at', [attemptId]) : []
    const latestByRef = new Map()
    for (const row of resources) latestByRef.set(row.resource_ref, row)
    const fixed = [...latestByRef.values()]
    const ticketEnded = ticketValue?.ended ?? null
    const stop = stopCommands[0] ?? null
    const chat = chatCommands[0] ?? null
    const answerCommand = answerCommands[0] ?? null
    const bar = barriers.at(-1) ?? null
    const quiescent = fixed.length > 0 && fixed.every(row => row.status === 'quiescent')

    check('work_identity', works.length === 1 && work.project_id === 'control-project' && Boolean(workValue?.id === work.id) &&
      String(workValue?.title ?? '').includes(mode), { works: works.length, project: work?.project_id, title: workValue?.title })
    check('primary_ticket_link', links.length === 1 && linkValue?.contract?.workId === work.id &&
      /^[a-f0-9]{64}$/u.test(linkValue?.contract?.digest ?? '') && linkValue?.ticketId === links[0]?.ticket_id,
      { links: links.length, contract: linkValue?.contract })
    check('ticket_assignment', ticket != null && assignment != null && typeof assignment.id === 'string' &&
      Array.isArray(ticketValue?.assignments), { ticket: ticket?.id, assignment: assignment?.id })
    check('binding_identity', binding != null && binding.value.ticketId === ticket?.id &&
      binding.value.assignmentId === assignment?.id && binding.value.contract?.workId === work.id &&
      binding.value.contract?.digest === linkValue?.contract?.digest,
      { binding: binding?.attempt_id, state: binding?.state, value: binding?.value })
    check('one_begin', begin.length === 1 && begin[0].delivery === 'native_accepted' &&
      begin[0].command_id.includes('-begin-'), begin)
    check('one_deliver', deliver.length === 1 && deliver[0].delivery === 'native_accepted' &&
      deliver[0].command_id.includes('-deliver-'), deliver)
    check('command_identity', workCommands.length === 1 && chatCommands.length === 1 && stopCommands.length === 1 &&
      answerCommands.length === (mode === 'questionless' ? 0 : 1) &&
      lit(workCommands[0]?.result)?.workId === work.id && lit(chat?.result)?.workId === work.id &&
      lit(stop?.result)?.workId === work.id,
      { work: workCommands.length, chat: chatCommands.length, stop: stopCommands.length, answer: answerCommands.length })
    const timestampOrder = [workCommands[0], answerCommands[0], chatCommands[0], stopCommands[0]].filter(Boolean)
      .map(row => row.recorded_at)
    check('request_order', timestampOrder.every((value, index) => index === 0 || Date.parse(timestampOrder[index - 1]) <= Date.parse(value)),
      timestampOrder)

    if (mode === 'questionless') {
      check('no_question', questions.length === 0 && answers.length === 0 && deliveries.length === 0 && answerObserved.length === 0,
        { questions: questions.length, answers: answers.length, deliveries: deliveries.length })
    } else {
      const target = question?.value?.targets?.[0] ?? null
      const answerSnapshot = answer?.value?.question ?? null
      check('question_identity', questions.length === 1 && question.validity === 'answered' &&
        question.value?.contract?.workId === work.id && question.value?.contract?.digest === linkValue?.contract?.digest &&
        target?.ticketId === ticket.id && target?.assignmentId === assignment.id && target?.attemptId === attemptId &&
        target?.contract?.digest === linkValue?.contract?.digest &&
        target?.nativeRequestId?.kind === 'integer' && target?.nativeRequestId?.decimal === '42' &&
        question.value?.presentation?.kind === 'form', { question: question?.id, target })
      check('answer_identity', answers.length === 1 && answer.question_id === question.id &&
        answer.expected_version === 1 && answerSnapshot?.id === question.id && answerSnapshot?.version === 1 &&
        answerSnapshot?.targets?.[0]?.attemptId === attemptId && answer.value?.answer?.values?.['field-0'] === 'option-1',
        { answer: answer?.answer_id, version: answer?.expected_version })
      check('answer_command_identity', answerCommands.length === 1 &&
        lit(answerCommand.result)?.entityRefs?.questionId === question.id &&
        lit(answerCommand.result)?.workId === work.id,
        { command: answerCommand?.command_id, result: lit(answerCommand?.result) })
      check('answer_native_effect', deliveries.length === 1 && deliveries[0].answer_id === answer.answer_id &&
        deliveries[0].target_binding_id === target.id &&
        deliveries[0].status === 'native_applied' && answerObserved.length === 1 &&
        lit(answerObserved[0].detail)?.answerId === answer.answer_id,
        { deliveries, answerObserved: answerObserved.length })
      check('lost_response_no_replay', mode !== 'lost-answer-response' ||
        (answerCommands.length === 1 && answers.length === 1 && deliveries.length === 1 && answerObserved.length === 1),
        { mode, answerCommands: answerCommands.length, answers: answers.length })
    }

    check('supplement_same_attempt', chatCommands.length === 1 && deliver.length === 1 && begin.length === 1 &&
      dispatches.length === 2, { dispatches: dispatches.length, deliver: deliver.length })
    if (mode === 'unknown-resource') {
      check('unknown_resource_held', binding.state === 'stopping' && fixed.length > 0 &&
        fixed.every(row => row.status !== 'quiescent') && barriers.length === 0 && ticketEnded?.outcome === 'stopped',
        { binding: binding.state, resources: fixed, barriers: barriers.length, ended: ticketEnded })
    } else {
      check('stop_before_resource_stop', stop != null && quiescent &&
        Date.parse(stop.recorded_at) < Date.parse(fixed.map(row => row.observed_at).sort().at(-1)) &&
        bar != null && Date.parse(bar.at) >= Date.parse(stop.recorded_at),
        { stop: stop?.recorded_at, barrier: bar?.at, resources: fixed })
      check('barrier_then_ended', barriers.length === 1 && binding.state === 'ended' && quiescent &&
        ticketEnded?.by === 'human' && ticketEnded?.outcome === 'stopped' &&
        fixed.every(row => row.status === 'quiescent'),
        { barriers: barriers.length, binding: binding.state, ended: ticketEnded })
    }
    check('screenshot_present', existsSync(join(root, mode, 'same-work-running.png')), join(root, mode, 'same-work-running.png'))
    return { mode, root: join(root, mode), workId: work.id, ticketId: ticket?.id, assignmentId: assignment?.id,
      attemptId, failures, checks }
  } finally { db.close() }
}

function auditRoot(root) {
  const results = MODES.map(mode => auditMode(root, mode))
  return { root, ok: results.every(item => item.failures.length === 0), results }
}

function writeEvidence(evidence) {
  mkdirSync(join(EVIDENCE, '..'), { recursive: true, mode: 0o700 })
  writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  mkdirSync(join(PERSISTENT_PARENT, 'evidence'), { recursive: true, mode: 0o700 })
  writeFileSync(join(PERSISTENT_PARENT, 'evidence/m03-real-consumer.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
}

const argv = process.argv.slice(2)
try {
  if (argv.includes('--verify')) {
    mkdirSync(PERSISTENT_PARENT, { recursive: true, mode: 0o700 })
    const runParent = join(PERSISTENT_PARENT, `run-${Date.now()}`)
    mkdirSync(runParent, { recursive: true, mode: 0o700 })
    const producer = execFileSync(process.execPath, [MAIN_CONSUMER, runParent], { cwd: ROOT, encoding: 'utf8', timeout: 600_000, maxBuffer: 8 * 1024 * 1024 })
    const created = readdirSync(runParent).map(name => join(runParent, name)).filter(path => existsSync(join(path, 'question', 'state/state.sqlite')))
    const evidenceRoot = created[0]
    if (!evidenceRoot) throw new Error('main consumer produced no evidence root')
    const audit = auditRoot(evidenceRoot)
    const evidence = { at: now(), kind: 'independent-real-workbench-consumer', producer: 'tests/integration/original-control-browser.mjs@57243a54',
      producerExit: 0, producerOutputTail: String(producer).slice(-1200), evidenceRoot, audit,
      limitations: ['Controlled protocol peer and virtual resources only; no Codex/vendor/model/native process or signal.',
        'This independently audits the original App/HTTP/Store/Application/QuestionBroker/Driver wiring and receipts; it is not an installed-package or live native pass.',
        'No real Work/turn was sent; budget remains 4/4 exhausted.'] }
    writeEvidence(evidence)
    console.log(JSON.stringify({ evidence: EVIDENCE, root: evidenceRoot, ok: audit.ok,
      results: audit.results.map(item => ({ mode: item.mode, workId: item.workId, attemptId: item.attemptId, failures: item.failures })) }, null, 1))
    if (!audit.ok) process.exitCode = 1
  } else if (argv[0] === '--audit' && argv[1]) {
    const audit = auditRoot(resolve(argv[1]))
    const evidence = { at: now(), kind: 'independent-real-workbench-consumer-audit', evidenceRoot: resolve(argv[1]), audit,
      limitations: ['Read-only audit of an existing consumer Store; no model turn.'] }
    writeEvidence(evidence)
    console.log(JSON.stringify({ evidence: EVIDENCE, ok: audit.ok,
      results: audit.results.map(item => ({ mode: item.mode, workId: item.workId, attemptId: item.attemptId, failures: item.failures })) }, null, 1))
    if (!audit.ok) process.exitCode = 1
  } else {
    console.log('usage: --verify | --audit <evidence-root>')
    process.exitCode = 2
  }
} catch (error) {
  console.error(`m03-real-consumer failed: ${String(error?.message ?? error).slice(0, 1200)}`)
  process.exitCode = 1
}
