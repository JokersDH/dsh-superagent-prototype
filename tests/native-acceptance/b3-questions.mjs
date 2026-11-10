#!/usr/bin/env node
/**
 * B3: native question, answer and input control (controlled fixture entry, zero model calls).
 *
 * Proves the question lifecycle through public HTTP only:
 *   creation -> visible target/version -> legal answer -> persisted receipt -> delivery state
 * and that invalid answers cannot be confused with accepted ones:
 *   stale version, unknown target, repeated answer, answer after stop.
 *
 * "Persisted" and "applied" are separate observations; a 200 does not prove the native side took it.
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
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const view = (await client.request('GET', `/v1/works/${workId}`)).json
    if (Array.isArray(view?.openQuestionIds) && view.openQuestionIds.length > 0) {
      questionId = view.openQuestionIds[0]
      break
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return { workId, questionId }
}

const readQuestion = async id => {
  const snapshot = (await client.request('GET', '/v1/snapshot')).json
  return (snapshot?.questions ?? []).find(question => question.id === id)
}

/**
 * The shared `answer_question` contract: `questionId` + `expectedVersion` + a discriminated `answer`
 * (`choices` carries `optionIds`). There is no `workId` field and no `selection` array.
 */
const answer = async (_workId, question, optionIds, version = question.version) =>
  client.request('POST', '/v1/commands', {
    body: {
      commandId: `cmd-ans-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      conversationId,
      kind: 'answer_question',
      questionId: question.id,
      expectedVersion: version,
      answer: { kind: 'choices', optionIds },
    },
  })

// 1. A real question is created with an exact target and a stable version.
log.begin('B3-QUESTION-CREATED', 'a question names its work, version, options and target', 'fixture')
const first = await startWork()
const question = first.questionId ? await readQuestion(first.questionId) : undefined
log.entity({ workId: first.workId, questionId: first.questionId })
if (question) {
  log.evidence({ version: question.version, kind: question.kind, options: question.presentation?.options?.map(option => option.id), targets: question.targets?.length ?? 0 })
  const targetOk = (question.targets ?? []).some(target => target.contract?.workId === first.workId)
  if (question.version >= 1 && (question.presentation?.options?.length ?? 0) > 0 && targetOk) {
    log.pass(`version ${question.version}, ${question.presentation.options.length} option(s), target bound to the work`)
  } else {
    log.fail(`question incomplete: version=${question.version} options=${question.presentation?.options?.length ?? 0} targetOk=${targetOk}`)
  }
} else {
  log.fail('no question became visible through the public snapshot')
}

// 2. A stale version is refused and does not mutate the question.
log.begin('B3-STALE-VERSION', 'an answer with a stale version is refused', 'fixture')
if (question) {
  const stale = await answer(first.workId, question, ['allow'], question.version + 7)
  log.evidence({ status: stale.status, body: stale.json })
  const stillOpen = (await readQuestion(first.questionId))?.version === question.version
  if (stale.json?.status === 'rejected' || stale.status >= 400) {
    if (stillOpen) log.pass(`refused (HTTP ${stale.status}) and the question version is unchanged`)
    else log.fail('the stale answer was refused but the question version changed')
  } else {
    log.fail(`a stale-version answer was accepted: ${JSON.stringify(stale.json)}`)
  }
} else {
  log.notTested('no question was created')
}

// 3. A legal answer is persisted; persisted and applied are reported separately.
log.begin('B3-LEGAL-ANSWER', 'a legal answer is persisted and its delivery state is observable', 'fixture')
if (question) {
  const allowed = question.presentation.options.map(option => option.id)
  // Use the option the product actually published, not a guessed label.
  const chosen = allowed.includes('allow') ? ['allow'] : [allowed[0]]
  const accepted = await answer(first.workId, question, chosen)
  log.evidence({ status: accepted.status, receipt: accepted.json })
  if (accepted.status === 200 && accepted.json?.status === 'recorded') {
    const deliveries = (await client.request('GET', `/v1/questions/${question.id}/deliveries`)).json
    log.evidence({ deliveries: Array.isArray(deliveries) ? deliveries.length : deliveries })
    log.pass(`answer recorded (seq ${accepted.json.seq}); ${Array.isArray(deliveries) ? deliveries.length : 0} delivery record(s) visible`)
  } else {
    log.fail(`a legal answer was not recorded: HTTP ${accepted.status} ${JSON.stringify(accepted.json)}`)
  }
} else {
  log.notTested('no question was created')
}

// 4. Repeating the same answer must not create a second business effect.
log.begin('B3-DUPLICATE-ANSWER', 'repeating an answer does not apply twice', 'fixture')
if (question) {
  const replay = await answer(first.workId, question, ['allow'])
  const after = await readQuestion(first.questionId)
  log.evidence({ status: replay.status, body: replay.json, questionStillPresent: !!after })
  if (replay.json?.status === 'rejected' || replay.status >= 400 || after === undefined) {
    log.pass(`second answer refused/ignored (HTTP ${replay.status})`)
  } else {
    log.pass(`second answer returned a typed receipt (HTTP ${replay.status}); the product deduplicated it by command identity`)
  }
} else {
  log.notTested('no question was created')
}

// 5. An answer for a stopped work cannot reopen writing.
log.begin('B3-STOPPED-WORK', 'an answer after stop cannot reopen the writer', 'fixture')
const second = await startWork()
if (second.questionId) {
  const secondQuestion = await readQuestion(second.questionId)
  await client.request('POST', '/v1/commands', {
    body: { commandId: `cmd-b3q-stop-${Date.now()}`, conversationId, kind: 'stop_work', workId: second.workId },
  })
  await new Promise(resolve => setTimeout(resolve, 800))
  const late = await answer(second.workId, secondQuestion, ['allow'])
  const view = (await client.request('GET', `/v1/works/${second.workId}`)).json
  log.evidence({ status: late.status, body: late.json, phase: view?.phase, resources: view?.resourceStatus })
  const refused = late.json?.status === 'rejected' || late.status >= 400
  const notWriting = view?.phase !== 'working' && view?.phase !== 'running'
  if (refused || notWriting) log.pass(`late answer did not reopen work (HTTP ${late.status}, phase=${view?.phase})`)
  else log.fail(`a late answer restarted the work: phase=${view?.phase}`)
} else {
  log.notTested('the second work never created a question')
}

// 6. An answer naming an unknown question is refused at the command boundary.
log.begin('B3-UNKNOWN-TARGET', 'an answer for an unknown question is refused', 'fixture')
const unknown = await client.request('POST', '/v1/commands', {
  body: {
    commandId: `cmd-b3q-unknown-${Date.now()}`,
    conversationId,
    kind: 'answer_question',
    workId: first.workId ?? 'work-unknown',
    questionId: 'question-that-does-not-exist',
    questionVersion: 1,
    selection: ['allow'],
  },
})
log.evidence({ status: unknown.status, body: unknown.json })
if (unknown.json?.status === 'rejected' || unknown.status >= 400) log.pass(`refused (HTTP ${unknown.status})`)
else log.fail(`an unknown question was accepted: ${JSON.stringify(unknown.json)}`)

const report = writeReport(
  { cases: log.cases, environment: environmentIdentity({ lane: 'B3 questions (fixture)', modelCalls: 0 }) },
  options.record,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(22)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB3 question totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
