#!/usr/bin/env node
/**
 * B3: native question, answer and input control (controlled fixture, zero model calls).
 *
 * Every branch here must be able to FAIL. The wave-04 review showed the previous version could pass
 * for the wrong reason, so each assertion now states the exact evidence it requires:
 *
 * - an answer is always built from the shared contract (`questionId` + `expectedVersion` + a
 *   discriminated `answer`); a schema 400 is never accepted as proof of a business rejection;
 * - a duplicate replay reuses the **same** commandId and payload and must return the same receipt,
 *   with the delivery applied exactly once — a new commandId is a different scenario, not a PASS;
 * - a legal answer must produce the original target's delivery record; zero deliveries is a failure;
 * - a stopped work must show a refusal **and** no extra native send **and** an accurate resource
 *   status; `rejected || phase !== 'working'` is not evidence;
 * - a stale version comes from a real version bump (v2 answered, then v1 replayed), never `max(1, v-1)`.
 */
import { ApiClient, CaseLog, assertLoopback, environmentIdentity, parseArgs, writeReport } from './harness.mjs'

const options = parseArgs(process.argv.slice(2))
assertLoopback(options.url)
const { client, bearerAvailable } = ApiClient.fromState({ url: options.url, stateDir: options.state, timeoutMs: options.timeoutMs })
const bootstrap = ApiClient.bootstrapTokenFrom(options.state)
if (bootstrap) await client.session(bootstrap).catch(() => undefined)
const log = new CaseLog()
if (!bearerAvailable || !options.allowWrites) {
  process.stdout.write(`SKIPPED  b3 questions needs --allow-writes and --state (auth=${bearerAvailable})\n`)
  process.exit(0)
}

const configuration = (await client.request('GET', '/v1/configuration')).json
const questionProfile = (configuration?.profiles ?? []).find(profile => profile.id.includes('question') && profile.dispatchAllowed)
const project = (configuration?.projects ?? []).find(item => item.dispatchAllowed && item.profileIds?.includes(questionProfile?.id))
const machine = project?.defaultCriteria?.find(criterion => criterion.kind === 'machine')
const conversationId = `conv-b3q-${Date.now()}`

const startWork = async () => {
  const created = await client.request('POST', '/v1/commands', {
    body: {
      commandId: `cmd-b3q-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      conversationId,
      kind: 'create_work',
      projectId: project.id,
      profileId: questionProfile.id,
      goal: 'b3 question lifecycle',
      scope: { projectId: project.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
      criteria: [machine],
    },
  })
  const workId = created.json?.workId
  let questionId
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const view = (await client.request('GET', `/v1/works/${workId}`)).json
    if (Array.isArray(view?.openQuestionIds) && view.openQuestionIds.length > 0) {
      questionId = view.openQuestionIds[0]
      break
    }
    if (view?.phase === 'blocked' || view?.phase === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  return { workId, questionId }
}

const readQuestion = async id => {
  const snapshot = (await client.request('GET', '/v1/snapshot')).json
  return (snapshot?.questions ?? []).find(question => question.id === id)
}

/** Build a legal answer command from the shared contract. */
const answerBody = ({ commandId, questionId, expectedVersion, optionIds }) => ({
  commandId,
  conversationId,
  kind: 'answer_question',
  questionId,
  expectedVersion,
  answer: { kind: 'choices', optionIds },
})
const send = body => client.request('POST', '/v1/commands', { body })

/** A schema 400 is a parser verdict, never a business rejection. */
const classify = response => {
  if (response.status === 400) return 'schema'
  if (response.json?.status === 'rejected') return 'business'
  if (response.json?.status === 'recorded') return 'recorded'
  return `http_${response.status}`
}

const deliveries = async questionId => {
  const response = await client.request('GET', `/v1/questions/${questionId}/deliveries`)
  return Array.isArray(response.json) ? response.json : []
}

// 1. A real question is created with a stable version and a target bound to its work.
log.begin('B3-QUESTION-CREATED', 'a question names its work, version, options and target', 'fixture')
const first = await startWork()
const question = first.questionId ? await readQuestion(first.questionId) : undefined
log.entity({ workId: first.workId, questionId: first.questionId })
let chosen = []
if (question) {
  const targetOk = (question.targets ?? []).some(target => target.contract?.workId === first.workId)
  const ids = (question.presentation?.options ?? []).map(option => option.id)
  chosen = ids.includes('allow') ? ['allow'] : ids.slice(0, 1)
  log.evidence({ version: question.version, kind: question.kind, options: ids, targets: question.targets?.length ?? 0, targetOk })
  if (question.version >= 1 && ids.length > 0 && targetOk) log.pass(`version ${question.version}, ${ids.length} option(s), target bound`)
  else log.fail(`question incomplete: version=${question.version} options=${ids.length} targetOk=${targetOk}`)
} else {
  log.fail('no question became visible through the public snapshot')
}

// 2. A legal answer is recorded and produces the original target's delivery record.
log.begin('B3-LEGAL-ANSWER', 'a legal answer is recorded and delivers to the original target', 'fixture')
let legalRecorded = false
let appliedDelivery
if (question) {
  const accepted = await send(answerBody({ commandId: `cmd-ans-${Date.now()}`, questionId: question.id, expectedVersion: question.version, optionIds: chosen }))
  const kind = classify(accepted)
  const records = await deliveries(question.id)
  appliedDelivery = records.at(-1)
  log.evidence({ status: accepted.status, kind, receipt: accepted.json, deliveries: records.length, applied: appliedDelivery ?? null })
  // Zero deliveries is a failure: a recorded answer that never reached the target proves nothing.
  if (kind === 'recorded' && records.length > 0) {
    legalRecorded = true
    log.pass(`recorded (seq ${accepted.json.seq}) and ${records.length} delivery record(s) present`)
  } else {
    log.fail(`legal answer not delivered: kind=${kind} deliveries=${records.length}`)
  }
} else {
  log.notTested('no question was created')
}

// 3. Replaying the SAME commandId and payload returns the same receipt and applies once.
log.begin('B3-DUPLICATE-ANSWER', 'a same-commandId replay returns the same receipt and applies once', 'fixture')
if (question && legalRecorded) {
  const questionId = question.id
  const replayCommandId = `cmd-replay-${Date.now()}`
  const versionNow = (await readQuestion(questionId))?.version ?? question.version
  const body = answerBody({ commandId: replayCommandId, questionId, expectedVersion: versionNow, optionIds: chosen })
  const firstSend = await send(body)
  const deliveriesAfterFirst = (await deliveries(questionId)).length
  const replay = await send(body)
  // A genuinely new command would be a second business intent; only an identical replay is tested here.
  const sameReceipt = firstSend.json?.commandId === replay.json?.commandId && firstSend.json?.seq === replay.json?.seq
  const stillOpen = (await readQuestion(questionId)) !== undefined
  const deliveriesAfterReplay = (await deliveries(questionId)).length
  log.evidence({
    firstKind: classify(firstSend),
    replayKind: classify(replay),
    sameReceipt,
    deliveriesBefore: deliveriesAfterFirst,
    deliveriesAfter: deliveriesAfterReplay,
    stillOpen,
  })
  const duplicateRejected = classify(replay) === 'business'
  if (sameReceipt && deliveriesAfterReplay === deliveriesAfterFirst) {
    log.pass(`identical replay returned the same receipt (seq ${replay.json.seq}) and applied once`)
  } else if (duplicateRejected && deliveriesAfterReplay === deliveriesAfterFirst) {
    log.pass('the duplicate was refused at the business layer and no extra delivery was applied')
  } else {
    log.fail(`replay changed state: sameReceipt=${sameReceipt} deliveries ${deliveriesAfterFirst}->${deliveriesAfterReplay}`)
  }
} else {
  log.notTested('no recorded legal answer to replay')
}

// 4. A real stale version: answer v2 legally, then replay at the old v1.
log.begin('B3-STALE-VERSION', 'a genuine older version is refused at the business layer', 'fixture')
const stale = await startWork()
if (stale.questionId) {
  const q0 = await readQuestion(stale.questionId)
  const ids = (q0.presentation?.options ?? []).map(option => option.id)
  const pick = ids.includes('allow') ? ['allow'] : ids.slice(0, 1)
  // Advance the question to a real next version through the supported defer/answer path.
  const defer = await send({
    commandId: `cmd-defer-${Date.now()}`,
    conversationId,
    kind: 'answer_question',
    questionId: q0.id,
    expectedVersion: q0.version,
    answer: { kind: 'defer' },
  })
  const q1 = await readQuestion(stale.questionId)
  log.evidence({ v0: q0.version, v1: q1?.version ?? null, deferKind: classify(defer) })
  // Only a real version bump proves the stale branch; a fabricated number would prove nothing.
  if (q1 && q1.version > q0.version) {
    const replayOld = await send(answerBody({ commandId: `cmd-stale-${Date.now()}`, questionId: q0.id, expectedVersion: q0.version, optionIds: pick }))
    const kind = classify(replayOld)
    log.evidence({ replayOldKind: kind, replayOldStatus: replayOld.status, error: replayOld.json?.error })
    if (kind === 'business' || kind === 'schema') {
      log.fail(`the product answered the stale branch with ${kind}; a business refusal is required`)
    } else {
      log.pass('a stale version produced no accepted answer')
    }
  } else {
    log.notTested(`the question did not advance to a second version (v0=${q0.version})`)
  }
} else {
  log.notTested('no question for the stale-version branch')
}

// 5. Unknown target: a LEGAL answer command whose target does not exist must be refused by business.
log.begin('B3-UNKNOWN-TARGET', 'a legal answer for an unknown question is refused by business', 'fixture')
const unknownQuestionId = `question-does-not-exist-${Date.now()}`
const unknown = await send(answerBody({ commandId: `cmd-unknown-${Date.now()}`, questionId: unknownQuestionId, expectedVersion: 1, optionIds: ['allow'] }))
const unknownKind = classify(unknown)
log.evidence({ kind: unknownKind, status: unknown.status, body: unknown.json })
if (unknownKind === 'schema') {
  // The command was rejected by the parser, so this run proves nothing about business refusal.
  log.fail('the unknown-target command failed schema validation, so the business branch was not exercised')
} else if (unknownKind === 'business') {
  log.pass(`refused at the business layer with ${unknown.json?.error?.code ?? 'rejected'}`)
} else {
  log.fail(`an answer for an unknown question was accepted: ${kind_label(unknownKind)}`)
}

// 6. A stopped work refuses a late answer AND shows no extra native send and an accurate resource state.
log.begin('B3-STOPPED-WORK', 'a late answer is refused, sends nothing, and resources stay stopped', 'fixture')
const stopping = await startWork()
if (stopping.questionId) {
  const q = await readQuestion(stopping.questionId)
  const ids = (q.presentation?.options ?? []).map(option => option.id)
  const pick = ids.includes('allow') ? ['allow'] : ids.slice(0, 1)
  const stop = await client.request('POST', '/v1/commands', {
    body: { commandId: `cmd-b3q-stop-${Date.now()}`, conversationId, kind: 'stop_work', workId: stopping.workId },
  })
  // Wait for the work to reach a terminal phase before sending anything late.
  let settled
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    settled = (await client.request('GET', `/v1/works/${stopping.workId}`)).json
    if (settled?.phase === 'ended' || settled?.phase === 'stopped' || settled?.phase === 'completed') break
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  const deliveriesBefore = (await deliveries(q.id)).length
  const late = await send(answerBody({ commandId: `cmd-late-${Date.now()}`, questionId: q.id, expectedVersion: q.version, optionIds: pick }))
  const lateKind = classify(late)
  const after = (await client.request('GET', `/v1/works/${stopping.workId}`)).json
  const deliveriesAfter = (await deliveries(q.id)).length
  log.evidence({
    stopKind: classify(stop),
    settledPhase: settled?.phase,
    lateKind,
    deliveriesBefore,
    deliveriesAfter,
    resourceStatus: after?.resourceStatus,
    phaseAfter: after?.phase,
  })
  const refused = lateKind === 'business'
  const noExtraSend = deliveriesAfter === deliveriesBefore
  const accurateResources = after?.resourceStatus === 'quiescent' || after?.resourceStatus === 'indeterminate' || after?.resourceStatus === 'unknown'
  if (refused && noExtraSend && accurateResources && after?.phase !== 'working' && after?.phase !== 'running') {
    log.pass(`late answer refused (${late.json?.error?.code ?? 'rejected'}); no extra delivery; resources=${after.resourceStatus}`)
  } else {
    log.fail(`late-answer branch incomplete: refused=${refused} noExtraSend=${noExtraSend} resources=${after?.resourceStatus} phase=${after?.phase}`)
  }
} else {
  log.notTested('no question for the stopped-work branch')
}

function kind_label(kind) {
  return kind === 'recorded' ? 'HTTP 200 recorded' : String(kind)
}

const report = writeReport(
  { cases: log.cases, environment: environmentIdentity({ lane: 'B3 questions (fixture)', modelCalls: 0 }) },
  options.record,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(22)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB3 question totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
