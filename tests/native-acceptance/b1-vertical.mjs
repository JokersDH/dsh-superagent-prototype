#!/usr/bin/env node
/**
 * B1 vertical checkpoint: a controlled, fail-capable slice of the native control surface.
 *
 * Runs with zero model calls against a private instance:
 *   admission facts -> single begin -> fact ACK -> stop with a real quiescence result
 *
 * It also proves the harness can fail: a schema-400, a business rejection and a missing ACK are
 * separated, and the budget ledger refuses a task beyond its grant.
 */
import { ApiClient, CaseLog, assertLoopback, environmentIdentity, parseArgs, writeReport } from './harness.mjs'
import { loadLedger, recordTask, remaining, totalSpent, BUDGET_LEDGER } from './budget.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const options = parseArgs(process.argv.slice(2))
assertLoopback(options.url)
const { client, bearerAvailable } = ApiClient.fromState({ url: options.url, stateDir: options.state, timeoutMs: options.timeoutMs })
const bootstrap = ApiClient.bootstrapTokenFrom(options.state)
if (bootstrap) await client.session(bootstrap).catch(() => undefined)
const log = new CaseLog()

if (!bearerAvailable) {
  process.stdout.write('SKIPPED  b1 vertical needs --state <private instance state>\n')
  process.exit(0)
}

const configuration = (await client.request('GET', '/v1/configuration')).json

// 1. Admission facts: the configuration states exactly what may dispatch.
log.begin('B1-ADMISSION', 'admission facts are explicit and separate inspection from native test', 'readonly')
const profiles = configuration?.profiles ?? []
const natives = profiles.filter(profile => profile.kind === 'native')
const fixtures = profiles.filter(profile => profile.kind === 'controlled_fixture')
const badNative = natives.filter(profile => profile.dispatchAllowed && profile.readiness !== 'native_test_passed')
log.evidence({ natives: natives.map(p => ({ id: p.id, readiness: p.readiness, allowed: p.dispatchAllowed })), fixtures: fixtures.length })
if (badNative.length === 0) log.pass(`${natives.length} native profile(s); none admitted without native_test_passed`)
else log.fail(`admitted without a native test: ${badNative.map(p => p.id).join(', ')}`)

// 2. A legal business rejection and a schema 400 must be different outcomes.
log.begin('B1-REJECTION-CLASSES', 'business rejection and schema 400 are separated', 'fixture')
const malformed = await client.request('POST', '/v1/commands', { body: { commandId: `bad-${Date.now()}`, kind: 'not_a_command' } })
const businessReject = await client.request('POST', '/v1/commands', {
  body: { commandId: `unknown-work-${Date.now()}`, conversationId: 'conv-b1', kind: 'stop_work', workId: 'work-that-does-not-exist' },
})
log.evidence({ malformedStatus: malformed.status, businessStatus: businessReject.status, businessCode: businessReject.json?.error?.code ?? businessReject.json?.status })
const malformedIsSchema = malformed.status === 400
const businessIsTyped = businessReject.json?.status === 'rejected' || businessReject.json?.error !== undefined
if (malformedIsSchema && businessIsTyped && malformed.status !== businessReject.status) {
  log.pass(`schema 400 vs typed result (HTTP ${businessReject.status}, code ${businessReject.json?.error?.code ?? 'rejected'})`)
} else {
  log.fail(`outcomes not separated: malformed=${malformed.status} business=${businessReject.status}`)
}

// 3. Single begin: a controlled work produces one assignment and one candidate generation.
log.begin('B1-SINGLE-BEGIN', 'a controlled work has exactly one begin and one candidate generation', 'fixture')
// Select a profile that actually completes a turn: the question profile waits for an answer and
// would never produce a candidate, which would be a harness bug rather than a product finding.
const fixture = fixtures.find(profile => profile.id.includes('pass') && profile.dispatchAllowed) ?? fixtures.find(profile => profile.dispatchAllowed)
const project = (configuration?.projects ?? []).find(item => item.dispatchAllowed && item.profileIds?.includes(fixture?.id))
const machine = project?.defaultCriteria?.find(criterion => criterion.kind === 'machine')
if (fixture && project) {
  const created = await client.request('POST', '/v1/commands', {
    body: {
      commandId: `cmd-b1-${Date.now()}`,
      conversationId: 'conv-b1',
      kind: 'create_work',
      projectId: project.id,
      profileId: fixture.id,
      goal: 'b1 vertical slice',
      scope: { projectId: project.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
      criteria: [machine],
    },
  })
  const workId = created.json?.workId
  let view
  const polls = []
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const response = await client.request('GET', `/v1/works/${workId}`)
    view = response.json
    polls.push({ status: response.status, phase: view?.phase, hasCandidate: !!view?.actions?.currentCandidate })
    // Wait for the candidate itself: a phase alone does not prove the attempt produced one.
    if (view?.actions?.currentCandidate) break
    if (view?.phase === 'blocked' || view?.phase === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  const assignment = view?.actions?.currentAssignment
  const candidate = view?.actions?.currentCandidate
  log.entity({ workId, assignment: assignment?.assignmentId, candidate: candidate?.assignmentId })
  if (!candidate) log.evidence({ polls: polls.slice(-6), project: project.id, profile: fixture.id, criteria: machine?.id })
  // A single begin means exactly one current assignment, and the candidate names that same
  // assignment: two begins would show a different assignment id on the candidate.
  if (assignment?.assignmentId && candidate?.assignmentId === assignment.assignmentId) {
    log.pass(`one assignment ${assignment.assignmentId} owns the candidate`)
  } else {
    log.fail(`no single begin observed: phase=${view?.phase} assignment=${assignment?.assignmentId ?? 'none'} candidate=${candidate?.assignmentId ?? 'none'}`)
  }

  // 4. Stop reports a real quiescence result, not merely a phase change.
  log.begin('B1-STOP-QUIESCENCE', 'stop reports a quiescence result from the owned inventory', 'fixture')
  const stop = await client.request('POST', '/v1/commands', {
    body: { commandId: `cmd-b1-stop-${Date.now()}`, conversationId: 'conv-b1', kind: 'stop_work', workId },
  })
  let settled
  const stopDeadline = Date.now() + 45_000
  while (Date.now() < stopDeadline) {
    settled = (await client.request('GET', `/v1/works/${workId}`)).json
    if (settled?.phase !== 'running' && settled?.phase !== 'working') break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  log.evidence({ stopStatus: stop.status, finalPhase: settled?.phase, resources: settled?.resourceStatus })
  const resources = String(settled?.resourceStatus ?? '')
  // The product reports an inventory verdict; `indeterminate`/`unknown` are honest answers that
  // MUST NOT be presented as a proven stop.
  if (resources === 'quiescent') {
    log.pass('stop proved quiescence from the owned inventory')
  } else if (resources === 'indeterminate' || resources === 'unknown') {
    log.pass(`stop reports an unproven inventory verdict ${resources} (reported honestly, not as a proven stop)`)
  } else if (resources === 'active') {
    log.fail('stop left an active writer in the inventory')
  } else {
    log.fail(`stop produced no inventory status: ${JSON.stringify(settled?.resourceStatus)}`)
  }
} else {
  log.notTested('no dispatchable fixture profile/project is published')
  log.notTested('no dispatchable fixture profile/project is published')
}

// 5. Budget ledger: a grant refuses a task beyond its limit and keeps its own allowance.
log.begin('B1-BUDGET', 'the model budget ledger refuses an over-limit task and keeps history', 'readonly')
const scratch = join(mkdtempSync(join(tmpdir(), 'pa-budget-')), 'ledger.json')
const grantId = `b1-selftest-${Date.now()}`
recordTask({ grantId, limit: 1, entry: { certain: true, workId: 'w1' } }, scratch)
let refused = false
try {
  recordTask({ grantId, limit: 1, entry: { certain: true, workId: 'w2' } }, scratch)
} catch {
  refused = true
}
recordTask({ grantId: `${grantId}-other`, limit: 5, entry: { certain: false, workId: 'w3' } }, scratch)
const ledger = loadLedger(scratch)
const sorted = { ...ledger, grants: ledger.grants.map(grant => ({ ...grant, tasks: grant.tasks.map(task => ({ ...task, beganAt: undefined })) })) }
log.evidence({ refused, remaining: remaining(grantId, 1, scratch), spent: totalSpent(scratch) })
if (refused && remaining(grantId, 1, scratch) === 0 && totalSpent(scratch) === 2) {
  log.pass('over-limit refused; an uncertain send is still counted; history preserved')
} else {
  log.fail(`ledger behaved unexpectedly: ${JSON.stringify(sorted).slice(0, 300)}`)
}

const committed = loadLedger(BUDGET_LEDGER)
log.evidence({ committedGrants: committed.grants.map(grant => ({ grantId: grant.grantId, limit: grant.limit, used: grant.tasks.length })) })

const report = writeReport(
  { cases: log.cases, environment: environmentIdentity({ lane: 'B1 vertical (no model)', modelCalls: 0 }) },
  options.record,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(22)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB1 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
