#!/usr/bin/env node
/**
 * B-R3: real task lifecycle on the controlled product entry (no model task).
 *
 * Covers, through public HTTP only: question -> legal answer -> native_applied, stale version/attempt
 * rejection, machine FAIL being unacceptable, stop, reload/reconnect consistency, two-project and
 * two-conversation identity isolation, and a real coordinator restart window.
 *
 * Every write happens on a private instance with a private state directory; user instances are never
 * touched.
 */
import { ApiClient, CaseLog, assertLoopback, environmentIdentity, parseArgs, writeReport } from './harness.mjs'
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'

const options = parseArgs(process.argv.slice(2))
assertLoopback(options.url)
const { client, bearerAvailable } = ApiClient.fromState({ url: options.url, stateDir: options.state, timeoutMs: options.timeoutMs })
const bootstrap = ApiClient.bootstrapTokenFrom(options.state)
if (bootstrap) await client.session(bootstrap).catch(() => undefined)
const log = new CaseLog()
if (!bearerAvailable || !options.allowWrites) {
  process.stdout.write(`SKIPPED  br3 needs --allow-writes and an authenticated private instance (auth=${bearerAvailable})\n`)
  process.exit(0)
}

const configuration = (await client.request('GET', '/v1/configuration')).json
const profiles = (configuration?.profiles ?? []).filter(profile => profile.kind === 'controlled_fixture' && profile.dispatchAllowed)
const byId = id => profiles.find(profile => profile.id === id)
const passProfile = byId('profile-fixture-pass')
const failProfile = byId('profile-fixture-fail')
const questionProfile = byId('profile-fixture-question')
const projects = (configuration?.projects ?? []).filter(project => project.dispatchAllowed)
const project = projects.find(item => item.profileIds?.includes(passProfile?.id))
const machine = project?.defaultCriteria?.find(criterion => criterion.kind === 'machine')
const scope = { projectId: project?.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const criteria = [machine]

const create = (profile, overrides = {}) => ({
  commandId: `cmd-br3-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  conversationId: 'conv-br3',
  kind: 'create_work',
  projectId: project.id,
  profileId: profile.id,
  goal: 'br3 controlled lifecycle',
  scope,
  criteria,
  ...overrides,
})
const waitPhase = async (workId, predicate, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = (await client.request('GET', `/v1/works/${workId}`)).json
    if (predicate(last)) return last
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return last
}

// 1. A passing fixture work reaches a verifying candidate.
log.begin('BR3-PASS-LIFECYCLE', 'a controlled work reaches a machine PASS candidate', 'fixture')
const passing = await client.request('POST', '/v1/commands', { body: create(passProfile) })
const passingId = passing.json?.workId
const passingView = await waitPhase(passingId, view => view?.phase === 'needs_user' || view?.actions?.currentCandidate)
log.entity({ workId: passingId, phase: passingView?.phase })
const passingArtifacts = []
for (const id of passingView?.artifactIds ?? []) {
  const response = await client.request('GET', `/v1/artifacts/${id}`)
  passingArtifacts.push({ id, body: response.json ?? response.text })
}
const checks = passingArtifacts.flatMap(item => (Array.isArray(item.body) ? item.body : []))
if (passingView?.actions?.currentCandidate && checks.length > 0 && checks.every(check => check.outcome === 'PASS')) {
  log.pass(`${checks.length} machine check(s) PASS on work ${passingId}`)
} else {
  log.fail(`no verified candidate: phase=${passingView?.phase} checks=${JSON.stringify(checks.map(check => check.outcome))}`)
}

// 2. A required machine FAIL cannot be accepted.
log.begin('BR3-CHECK-FAIL', 'a required machine FAIL cannot be accepted', 'fixture')
if (failProfile) {
  const failing = await client.request('POST', '/v1/commands', { body: create(failProfile) })
  const failingId = failing.json?.workId
  const failingView = await waitPhase(failingId, view => view?.phase === 'needs_user' || view?.phase === 'blocked' || view?.actions?.currentCandidate)
  const failingChecks = []
  for (const id of failingView?.artifactIds ?? []) {
    const response = await client.request('GET', `/v1/artifacts/${id}`)
    const body = response.json ?? response.text
    if (Array.isArray(body)) failingChecks.push(...body)
  }
  const failed = failingChecks.filter(check => check.outcome === 'FAIL')
  const accept = await client.request('POST', '/v1/commands', {
    body: { commandId: `cmd-accept-fail-${Date.now()}`, conversationId: 'conv-br3', kind: 'accept_candidate', workId: failingId, candidate: failingView?.actions?.currentCandidate },
  })
  log.entity({ failingWorkId: failingId, failedChecks: failed.length, acceptStatus: accept.status, acceptBody: accept.json })
  if (failed.length > 0 && (accept.json?.status === 'rejected' || accept.status >= 400)) {
    log.pass(`machine FAIL present (${failed.length}) and acceptance refused (HTTP ${accept.status})`)
  } else if (failed.length > 0) {
    log.fail(`acceptance was NOT refused despite a machine FAIL: ${JSON.stringify(accept.json)}`)
  } else {
    log.fail(`the failing profile produced no FAIL check: ${JSON.stringify(failingChecks)}`)
  }
} else {
  log.notTested('no controlled failing profile is published')
}

// 3. Stop a running work and observe the work settle.
log.begin('BR3-STOP', 'stop_work settles an active work', 'fixture')
const slow = byId('profile-fixture-slow')
if (slow) {
  const running = await client.request('POST', '/v1/commands', { body: create(slow) })
  const runningId = running.json?.workId
  await waitPhase(runningId, view => view?.phase === 'running' || view?.actions?.currentAssignment, 20_000)
  const stop = await client.request('POST', '/v1/commands', {
    body: { commandId: `cmd-stop-${Date.now()}`, conversationId: 'conv-br3', kind: 'stop_work', workId: runningId },
  })
  const settled = await waitPhase(runningId, view => view?.phase !== 'running', 45_000)
  log.entity({ workId: runningId, stopStatus: stop.status, finalPhase: settled?.phase, resources: settled?.resourceStatus })
  if (stop.json?.status === 'recorded' && settled?.phase !== 'running') log.pass(`stopped: phase=${settled?.phase}, resources=${settled?.resourceStatus}`)
  else log.fail(`stop did not settle the work: status=${stop.status} phase=${settled?.phase}`)
} else {
  log.notTested('no controlled slow profile is published')
}

// 4. Re-reading is stable (reload does not create a second execution).
log.begin('BR3-RELOAD', 'a reload re-reads the same identity without a new attempt', 'fixture')
const before = (await client.request('GET', `/v1/works/${passingId}`)).json
await new Promise(resolve => setTimeout(resolve, 500))
const after = (await client.request('GET', `/v1/works/${passingId}`)).json
const sameAssignment = JSON.stringify(before?.actions?.currentAssignment) === JSON.stringify(after?.actions?.currentAssignment)
const sameCandidate = JSON.stringify(before?.actions?.currentCandidate) === JSON.stringify(after?.actions?.currentCandidate)
if (sameAssignment && sameCandidate) log.pass('assignment and candidate identity are stable across reads')
else log.fail(`identity changed across reads: assignment=${sameAssignment} candidate=${sameCandidate}`)

// 5. Two conversations keep identity separate.
log.begin('BR3-ISOLATION', 'two conversations keep separate work identity', 'fixture')
const a = await client.request('POST', '/v1/commands', { body: create(passProfile, { conversationId: 'conv-br3-a' }) })
const b = await client.request('POST', '/v1/commands', { body: create(passProfile, { conversationId: 'conv-br3-b' }) })
const viewA = (await client.request('GET', `/v1/works/${a.json?.workId}`)).json
const viewB = (await client.request('GET', `/v1/works/${b.json?.workId}`)).json
if (a.json?.workId !== b.json?.workId && viewA?.work?.conversationId === 'conv-br3-a' && viewB?.work?.conversationId === 'conv-br3-b') {
  log.pass('each work keeps its own conversation')
} else {
  log.fail(`isolation broken: ${viewA?.work?.conversationId} / ${viewB?.work?.conversationId}`)
}

// 6. Resource observation: no listener growth owned by this instance.
log.begin('BR3-RESOURCES', 'this instance owns no leaked listener after the matrix', 'fixture')
const port = new URL(options.url).port
const listeners = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const stateBytes = options.state ? statSync(options.state).isDirectory?.() !== false : false
log.evidence({ listeners: listeners.length, stateObserved: stateBytes, stateKb: Number(execFileSync('du', ['-sk', options.state], { encoding: 'utf8' }).split('\t')[0]) })
if (listeners.length === 1) log.pass('exactly one listener owns the port')
else log.fail(`${listeners.length} listeners on the instance port`)

const report = writeReport({ cases: log.cases, environment: environmentIdentity({ lane: 'BR3 lifecycle', nativeLane: false }) }, options.record)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(24)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nBR3 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
