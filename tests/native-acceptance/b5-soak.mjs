#!/usr/bin/env node
/**
 * B5: bounded stability test (explicit `--soak`; never runs in the default self-test).
 *
 * Runs up to N controlled fixture cycles or a time budget, whichever comes first, and stops at the
 * first unexplained invariant break. It measures process/memory/state before, during and after and
 * refuses to leave owned writers behind. No model task is consumed.
 */
import { ApiClient, CaseLog, assertLoopback, environmentIdentity, parseArgs, writeReport } from './harness.mjs'
import { execFileSync } from 'node:child_process'

const options = parseArgs(process.argv.slice(2))
assertLoopback(options.url)
const cycles = Number(options.soakCount ?? 5)
const budgetMs = Number(options.soakBudgetMs ?? 45 * 60 * 1000)
const { client, bearerAvailable } = ApiClient.fromState({ url: options.url, stateDir: options.state, timeoutMs: options.timeoutMs })
const bootstrap = ApiClient.bootstrapTokenFrom(options.state)
if (bootstrap) await client.session(bootstrap).catch(() => undefined)

const log = new CaseLog()
if (!bearerAvailable) {
  process.stdout.write('SKIPPED  B5 requires an authenticated instance (--state)\n')
  process.exit(0)
}

/** Snapshot the instance's own resource footprint (owned processes only, by port owner). */
function measure() {
  try {
    const pids = execFileSync('lsof', ['-nP', `-iTCP:${new URL(options.url).port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
    const rss = pids
      .map(pid => execFileSync('ps', ['-o', 'rss=', '-p', pid], { encoding: 'utf8' }).trim())
      .filter(Boolean)
      .reduce((sum, value) => sum + Number(value), 0)
    const stateBytes = Number(options.state ? execFileSync('du', ['-sk', options.state], { encoding: 'utf8' }).split('\t')[0] : 0)
    return { listeners: pids.length, rssKb: rss, stateKb: stateBytes }
  } catch {
    return { listeners: 0, rssKb: null, stateKb: null }
  }
}

const configuration = (await client.request('GET', '/v1/configuration')).json
const fixture = (configuration?.profiles ?? []).find(profile => profile.kind === 'controlled_fixture' && profile.dispatchAllowed)
const project = (configuration?.projects ?? []).find(item => fixture && Array.isArray(item.profileIds) && item.profileIds.includes(fixture.id))
if (!fixture || !project) {
  process.stdout.write('SKIPPED  no controlled fixture profile/project is published\n')
  process.exit(0)
}

const scope = { projectId: project.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const machine = project.defaultCriteria.find(criterion => criterion.kind === 'machine')
const before = measure()
log.begin('B5-SOAK', `${cycles} controlled cycles within ${Math.round(budgetMs / 1000)}s`, 'fixture')
log.evidence({ before })

const started = Date.now()
const latencies = []
const errors = []
let completed = 0
let stoppedReason = 'completed cycles'
for (let index = 0; index < cycles; index += 1) {
  if (Date.now() - started > budgetMs) {
    stoppedReason = 'time budget reached'
    break
  }
  const commandId = `cmd-soak-${Date.now()}-${index}`
  const at = Date.now()
  const response = await client.request('POST', '/v1/commands', {
    body: {
      commandId,
      conversationId: 'conv-soak',
      kind: 'create_work',
      projectId: project.id,
      profileId: fixture.id,
      goal: `soak cycle ${index}`,
      scope,
      criteria: [machine],
    },
  })
  latencies.push(Date.now() - at)
  if (response.status !== 200 || !response.json?.workId) {
    // Stop at the first unexplained invariant break instead of retrying.
    errors.push({ cycle: index, status: response.status, body: response.json })
    stoppedReason = `invariant break at cycle ${index}`
    break
  }
  // Replay the same command: it must be idempotent, not create a second work.
  const replay = await client.request('POST', '/v1/commands', {
    body: { commandId, conversationId: 'conv-soak', kind: 'create_work', projectId: project.id, profileId: fixture.id, goal: `soak cycle ${index}`, scope, criteria: [machine] },
  })
  if (replay.json?.workId !== response.json.workId) {
    errors.push({ cycle: index, invariant: 'replay created a different work', first: response.json.workId, replay: replay.json?.workId })
    stoppedReason = `replay invariant break at cycle ${index}`
    break
  }
  completed += 1
}

const after = measure()
latencies.sort((left, right) => left - right)
const percentile = fraction => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))] ?? null
log.evidence({ after, completed, stoppedReason, latencies: { p50: percentile(0.5), p95: percentile(0.95), max: latencies.at(-1) ?? null } })

const listenersLeaked = after.listeners > before.listeners
if (errors.length === 0 && !listenersLeaked) {
  log.pass(`${completed} cycles, ${stoppedReason}; listeners ${before.listeners} -> ${after.listeners}, rssKb ${before.rssKb} -> ${after.rssKb}`)
} else {
  log.fail(`${errors.length} invariant break(s); listeners ${before.listeners} -> ${after.listeners}: ${JSON.stringify(errors).slice(0, 300)}`)
}

const report = writeReport({ cases: log.cases, environment: environmentIdentity({ lane: 'B5 soak', cycles: completed }) }, options.record)
process.stdout.write(`${report.cases.map(item => `${item.status} ${item.id}`).join('\n')}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
