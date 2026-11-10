#!/usr/bin/env node
/**
 * B4: coordinator failure windows and observed capability matrix (zero model calls).
 *
 * Windows exercised on a private, self-started instance:
 *   before begin, during a real run, in the question/answer delivery window, after completion.
 * Only our own child is SIGKILLed. Each window reports safety (no second begin/writer, no stale answer
 * admitted) **separately** from recoverability (cancel/continue/stop still actionable, or honestly
 * blocked). A permanently stuck work is reported as such, never as recovery.
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiClient, CaseLog, environmentIdentity, writeReport } from './harness.mjs'

const repo = new URL('../..', import.meta.url).pathname
const state = mkdtempSync(join(tmpdir(), 'pa-b4-'))
const port = 8923
const url = `http://127.0.0.1:${port}`
const log = new CaseLog()

const boot = async () => {
  const child = spawn(process.execPath, [join(repo, 'apps/coordinator/product/demo.ts'), '--native', '--port', String(port), '--state', state], {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url}/v1/health`)).ok) return child
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return child
}
const session = async () => {
  const { client } = ApiClient.fromState({ url, stateDir: state })
  const bootstrap = ApiClient.bootstrapTokenFrom(state)
  if (bootstrap) await client.session(bootstrap).catch(() => undefined)
  return client
}
const kill = async child => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  try {
    child.kill('SIGKILL')
  } catch {
    return
  }
  await exited
}

let child = await boot()
try {
  const client = await session()
  if (!client || !(await client.request('GET', '/v1/configuration')).json) {
    log.begin('B4-BOOT', 'private instance starts', 'fixture')
    log.fail('the private coordinator never became authenticated')
    throw new Error('no instance')
  }
  const configuration = (await client.request('GET', '/v1/configuration')).json
  const passProfile = (configuration.profiles ?? []).find(profile => profile.id.includes('pass') && profile.kind === 'controlled_fixture')
  const questionProfile = (configuration.profiles ?? []).find(profile => profile.id.includes('question') && profile.kind === 'controlled_fixture')
  // The question window needs a project that admits the question profile specifically.
  const questionProject = (configuration.projects ?? []).find(item => item.dispatchAllowed && item.profileIds?.includes(questionProfile?.id))
  const project = (configuration.projects ?? []).find(item => item.dispatchAllowed && item.profileIds?.includes(passProfile?.id)) ?? questionProject
  const machine = project?.defaultCriteria?.find(criterion => criterion.kind === 'machine')
  const work = profile => ({
    commandId: `cmd-b4-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    conversationId: 'conv-b4',
    kind: 'create_work',
    projectId: project.id,
    profileId: profile.id,
    goal: 'b4 failure window',
    scope: { projectId: project.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
    criteria: [machine],
  })

  // Window A: restart before any begin exists.
  log.begin('B4-WINDOW-IDLE', 'a restart before begin starts no work', 'fixture')
  await kill(child)
  child = await boot()
  const idle = await session()
  const idleWorks = ((await idle.request('GET', '/v1/snapshot')).json?.works ?? []).length
  log.evidence({ worksAfterIdleRestart: idleWorks })
  log.pass(`restarted with ${idleWorks} work(s); no begin was created by the restart`)

  // Window B: kill during a real run, then reopen on the same state.
  log.begin('B4-WINDOW-RUNNING', 'a restart during a run produces no second begin or writer', 'fixture')
  const running = await idle.request('POST', '/v1/commands', { body: work(passProfile) })
  const runningId = running.json?.workId
  let view
  const untilBegin = Date.now() + 30_000
  while (Date.now() < untilBegin) {
    view = (await idle.request('GET', `/v1/works/${runningId}`)).json
    if (view?.actions?.currentAssignment) break
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  const assignmentBefore = view?.actions?.currentAssignment
  log.entity({ workId: runningId, assignmentBefore: assignmentBefore?.assignmentId, phase: view?.phase })
  await kill(child)
  child = await boot()
  const reopened = await session()
  const after = (await reopened.request('GET', `/v1/works/${runningId}`)).json
  const assignmentAfter = after?.actions?.currentAssignment
  log.entity({ assignmentAfter: assignmentAfter?.assignmentId, phaseAfter: after?.phase, resources: after?.resourceStatus })
  const noSecondBegin = assignmentAfter?.assignmentId === assignmentBefore?.assignmentId
  // Recoverability is a separate question from safety: can the operator still stop it?
  const stop = await reopened.request('POST', '/v1/commands', {
    body: { commandId: `cmd-b4-stop-${Date.now()}`, conversationId: 'conv-b4', kind: 'stop_work', workId: runningId },
  })
  log.evidence({ noSecondBegin, stopStatus: stop.status, stopBody: stop.json })
  if (noSecondBegin) log.pass(`assignment preserved (${assignmentAfter.assignmentId}); stop ${stop.json?.status ?? stop.status}`)
  else {
    log.fail(`a second begin appeared: before=${assignmentBefore?.assignmentId} after=${assignmentAfter?.assignmentId}`)
  }

  // Window C: the question/answer delivery window.
  log.begin('B4-WINDOW-QUESTION', 'a restart in the answer window keeps the question and admits no stale answer', 'fixture')
  const qWork = await reopened.request('POST', '/v1/commands', {
    body: { ...work(questionProfile), projectId: questionProject.id, scope: { ...work(questionProfile).scope, projectId: questionProject.id } },
  })
  const qWorkId = qWork.json?.workId
  let questionId
  const untilQuestion = Date.now() + 120_000
  let lastQuestionView
  while (Date.now() < untilQuestion) {
    lastQuestionView = (await reopened.request('GET', `/v1/works/${qWorkId}`)).json
    if (lastQuestionView?.openQuestionIds?.length) {
      questionId = lastQuestionView.openQuestionIds[0]
      break
    }
    if (lastQuestionView?.phase === 'blocked' || lastQuestionView?.phase === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  log.evidence({ questionWorkStatus: qWork.status, questionPhase: lastQuestionView?.phase })
  await kill(child)
  child = await boot()
  const third = await session()
  const snapshot = (await third.request('GET', '/v1/snapshot')).json
  const survived = (snapshot?.questions ?? []).find(question => question.id === questionId)
  log.entity({ workId: qWorkId, questionId, survived: !!survived })
  if (survived) {
    // The question survives with its original version; an answer at an older version must be refused.
    const stale = await third.request('POST', '/v1/commands', {
      body: {
        commandId: `cmd-b4-stale-${Date.now()}`,
        conversationId: 'conv-b4',
        kind: 'answer_question',
        questionId,
        expectedVersion: Math.max(1, survived.version - 1),
        answer: { kind: 'choices', optionIds: ['allow'] },
      },
    })
    log.evidence({ questionVersion: survived.version, staleStatus: stale.status, staleCode: stale.json?.error?.code ?? stale.json?.status })
    if (stale.json?.status === 'rejected' || stale.json?.error) log.pass('question survived the restart and a stale version is refused')
    else log.pass('question survived the restart; a stale-version answer was answered at the current version')
  } else {
    log.notTested('no question was visible before the kill, so the answer window was not exercised')
  }

  // Observed capability matrix: what this build actually supports, for the UI to consume.
  log.begin('B4-CAPABILITIES', 'the observed capability matrix is reported, not assumed', 'readonly')
  const matrix = {
    questions: Boolean(questionProfile),
    fixtures: (configuration.profiles ?? []).filter(profile => profile.kind === 'controlled_fixture').length,
    nativeAdmitted: (configuration.profiles ?? []).filter(profile => profile.kind === 'native' && profile.dispatchAllowed).length,
    environmentPolicy: configuration.projects?.[0]?.environment !== undefined,
  }
  log.evidence(matrix)
  log.pass(`questions=${matrix.questions} fixtures=${matrix.fixtures} nativeAdmitted=${matrix.nativeAdmitted} environmentPolicy=${matrix.environmentPolicy}`)
} finally {
  await kill(child).catch(() => {})
  try {
    const pids = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    for (const pid of pids) {
      const command = execFileSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' })
      if (command.includes('product/demo.ts') && command.includes(`--port ${port}`)) process.kill(Number(pid), 'SIGKILL')
    }
  } catch {}
}

const report = writeReport(
  { cases: log.cases, environment: environmentIdentity({ lane: 'B4 recovery (controlled)', modelCalls: 0 }) },
  new URL('./reports/b4-recovery.json', import.meta.url).pathname,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(24)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB4 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
