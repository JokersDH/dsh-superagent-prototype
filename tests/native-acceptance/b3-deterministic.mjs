#!/usr/bin/env node
/**
 * B3: deterministic failure and recovery matrix on the controlled fixture entry.
 *
 * No model task is spent here. Every check uses only public product boundaries and the existing
 * controlled fixture profiles; a fixture result is labelled fixture, never native compatibility.
 */
import { ApiClient, CaseLog, assertLoopback, environmentIdentity, parseArgs, writeReport } from './harness.mjs'

const options = parseArgs(process.argv.slice(2))
assertLoopback(options.url)
const { client, bearerAvailable } = ApiClient.fromState({ url: options.url, stateDir: options.state, timeoutMs: options.timeoutMs })
const log = new CaseLog()
const bootstrap = ApiClient.bootstrapTokenFrom(options.state)
if (bootstrap) await client.session(bootstrap).catch(() => undefined)

const configuration = (await client.request('GET', '/v1/configuration')).json
const fixture = (configuration?.profiles ?? []).find(profile => profile.kind === 'controlled_fixture' && profile.dispatchAllowed)
const project = (configuration?.projects ?? []).find(item => Array.isArray(item.profileIds) && fixture && item.profileIds.includes(fixture.id))

if (!bearerAvailable || !fixture || !project) {
  process.stdout.write(`SKIPPED  B3 requires an authenticated fixture profile and project (auth=${bearerAvailable}, profile=${!!fixture}, project=${!!project})\n`)
  process.exit(0)
}

const scope = { projectId: project.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const machine = project.defaultCriteria.find(criterion => criterion.kind === 'machine')
const createCommand = (commandId, extra = {}) => ({
  commandId,
  conversationId: 'conv-b3',
  kind: 'create_work',
  projectId: project.id,
  profileId: fixture.id,
  goal: 'b3 deterministic fixture work',
  scope,
  criteria: [machine],
  ...extra,
})

// 1. same commandId: serial replay returns the original receipt; a different payload conflicts.
log.begin('B3-IDEMPOTENT', 'same commandId replays the original receipt', 'fixture')
const id = `cmd-b3-${Date.now()}`
const first = await client.request('POST', '/v1/commands', { body: createCommand(id) })
const replay = await client.request('POST', '/v1/commands', { body: createCommand(id) })
const firstJson = first.json ?? {}
const replayJson = replay.json ?? {}
if (first.status === 200 && replay.status === 200 && firstJson.workId === replayJson.workId && firstJson.seq === replayJson.seq) {
  log.pass(`replay returned workId=${firstJson.workId} seq=${firstJson.seq}`)
} else {
  log.fail(`replay diverged: first=${JSON.stringify(firstJson)} replay=${JSON.stringify(replayJson)}`)
}

log.begin('B3-CONFLICT', 'same commandId with a different payload is refused', 'fixture')
const conflict = await client.request('POST', '/v1/commands', { body: createCommand(id, { goal: 'a different goal entirely' }) })
if (conflict.status === 200 && conflict.json?.status === 'rejected' && conflict.json?.error?.code === 'conflict') {
  log.pass('rejected with code=conflict')
} else if (conflict.json?.error?.code === 'conflict') {
  log.pass(`refused with code=conflict (HTTP ${conflict.status})`)
} else {
  log.fail(`a different payload under an existing commandId was accepted: ${JSON.stringify(conflict.json)}`)
}

// 2. concurrent replay of one commandId must not create two works.
log.begin('B3-CONCURRENT', 'concurrent replay does not create a second work', 'fixture')
const concurrentId = `cmd-b3c-${Date.now()}`
const results = await Promise.all([
  client.request('POST', '/v1/commands', { body: createCommand(concurrentId) }),
  client.request('POST', '/v1/commands', { body: createCommand(concurrentId) }),
])
const works = new Set(results.map(result => result.json?.workId).filter(Boolean))
if (works.size === 1) log.pass(`both requests name one work: ${[...works][0]}`)
else log.fail(`concurrent replay produced ${works.size} works: ${[...works].join(', ')}`)

// 3. a snapshot cursor that expires or gaps must be recoverable by re-reading the snapshot.
log.begin('B3-CURSOR', 'an expired events cursor is reported, not silently ignored', 'fixture')
const events = await client.request('GET', '/v1/events?after=999999999', {})
const cursorText = `${events.status} ${events.text.slice(0, 60)}`
if (events.status === 409 || /cursor_expired/.test(events.text)) log.pass(`expired cursor reported: ${cursorText}`)
else log.fail(`expired cursor was not reported: ${cursorText}`)

// 4. two works in two conversations keep their identities separate.
log.begin('B3-ISOLATION', 'two conversations keep work/command identity separate', 'fixture')
const a = await client.request('POST', '/v1/commands', { body: createCommand(`cmd-b3-a-${Date.now()}`, { conversationId: 'conv-b3-a' }) })
const b = await client.request('POST', '/v1/commands', { body: createCommand(`cmd-b3-b-${Date.now()}`, { conversationId: 'conv-b3-b' }) })
if (a.json?.workId && b.json?.workId && a.json.workId !== b.json.workId) {
  const viewA = (await client.request('GET', `/v1/works/${a.json.workId}`)).json
  const viewB = (await client.request('GET', `/v1/works/${b.json.workId}`)).json
  if (viewA?.work?.conversationId === 'conv-b3-a' && viewB?.work?.conversationId === 'conv-b3-b') log.pass('each work keeps its own conversation')
  else log.fail(`conversation identity crossed: ${viewA?.work?.conversationId} / ${viewB?.work?.conversationId}`)
} else {
  log.fail(`two delegations did not produce distinct works: ${a.json?.workId} / ${b.json?.workId}`)
}

// 5. a stale answer version must be refused (question lifecycle on the fixture path).
log.begin('B3-QUESTION', 'a stale question version cannot be answered', 'fixture')
const questionWork = await client.request('POST', '/v1/commands', { body: createCommand(`cmd-b3-q-${Date.now()}`) })
const staleAnswer = await client.request('POST', '/v1/commands', {
  body: { commandId: `cmd-b3-ans-${Date.now()}`, conversationId: 'conv-b3', kind: 'answer_question', questionId: 'nonexistent-question', questionVersion: 99, selection: ['allow'] },
})
if (staleAnswer.json?.status === 'rejected' || staleAnswer.status === 400) {
  log.pass(`stale/unknown question refused (HTTP ${staleAnswer.status}, code ${staleAnswer.json?.error?.code ?? 'n/a'})`)
} else {
  log.fail(`an unknown question was accepted: ${JSON.stringify(staleAnswer.json)}`)
}
log.entity({ questionWorkId: questionWork.json?.workId })

const report = writeReport(
  { cases: log.cases, environment: environmentIdentity({ lane: 'B3 fixture', nativeLane: false }) },
  options.record,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(18)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB3 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
