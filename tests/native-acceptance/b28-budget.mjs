#!/usr/bin/env node
/**
 * Wave-28 B1: the ACTUAL service must honour the effective requested page budget.
 *
 * No pager copy and no synthetic journal: this spawns the real runner-service with its own FileCritical
 * Journal, asks the real authenticated endpoint for 2048 and 16384 byte pages, and measures the bytes the
 * caller actually receives.
 */
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import { CaseLog, writeReport } from './harness.mjs'
import { RunnerLink } from '../../apps/runner/src/runner-link-client.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w28-budget-'))
const recoveryRoot = join(root, 'recovery')
mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 })
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))
let runner
try {
  process.env.PA_RUNNER_RECOVERY_ROOT = recoveryRoot
  const spec = makeAttemptSpec()
  const link = new RunnerLink({ executable: process.execPath, entry: ENTRY, args: ['codex-fake-approval'], stateRoot: join(root, 'attempt'), producer: { source: 'codex-native', runnerIdentityRef: 'b28-budget' } })
  link.bindPayload(spec.policySnapshotRef, { kind: 'fixture-settings/1', workspacePath: process.cwd(), scope: { projectId: 'p', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, approvalPolicy: 'on-request', timeoutMs: 600000 })
  link.bindPayload('input-budget', { inputId: 'input-budget', contract: spec.contract, text: 'budget', contextRefs: [], sourceMessageRefs: [], provenance: 'authorized_work_input' })
  const sink = []
  runner = await link.spawnAttempt(spec, async fact => { sink.push(fact); return { factId: fact.factId, persisted: true, seq: sink.length } })
  const directory = endpointDirectory(recoveryRoot, spec.attemptId)
  let registered = null
  for (let index = 0; index < 400 && !registered; index += 1) {
    try { const stat = lstatSync(`${directory}/runner.sock`); registered = { socketPath: `${directory}/runner.sock`, credentialPath: `${directory}/runner.credential`, socketIdentity: { dev: stat.dev, ino: stat.ino } } }
    catch { await new Promise(resolve => setTimeout(resolve, 50)) }
  }
  const key = readFileSync(registered.credentialPath, 'utf8').trim()
  const raw = path => new Promise(resolve => {
    const req = http.request({ socketPath: registered.socketPath, method: 'GET', path, agent: false, headers: { authorization: `Bearer ${key}` } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, bytes: Buffer.concat(chunks).length, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', error => resolve({ status: 0, bytes: 0, body: String(error?.message ?? error) }))
    req.end()
  })
  await runner.command(makeCommand('begin', { id: 'cmd-budget-begin', inputRef: 'input-budget', preparedPolicyRef: spec.policySnapshotRef }))
  // Enough real journal facts that a 2048 page must split the SAME data chain many times, not fit one record.
  const growDeadline = Date.now() + 90_000
  let fed = 0
  while (Date.now() < growDeadline && sink.length < 160 && fed < 400) {
    fed += 1
    await runner.command(makeCommand('deliver', { id: `cmd-budget-deliver-${fed}`, inputRef: 'input-budget' })).catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  await runner.command(makeCommand('answer', { id: 'cmd-budget-answer', nativeBindingRef: 'binding-budget', answerRef: 'answer-budget' })).catch(() => undefined)
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline && sink.length < 6) await new Promise(resolve => setTimeout(resolve, 50))
  const total = sink.length

  log.begin('B28-ACTUAL-SERVICE-2048-BOUND', 'the real service returns no more than the requested 2048 bytes', 'controlled_process')
  const page2048 = await raw('/v1/facts?since=0&maxBytes=2048')
  const parsed = (() => { try { return JSON.parse(page2048.body) } catch { return null } })()
  log.evidence({ status: page2048.status, bytes: page2048.bytes, requested: 2048, frames: parsed?.frames?.length ?? null, next: parsed?.next ?? null, done: parsed?.done ?? null, journalFacts: total })
  if (page2048.status === 200 && page2048.bytes <= 2048 && parsed) log.pass(`the actual service returned ${page2048.bytes} bytes for a 2048-byte request (${parsed.frames.length} frames, next ${parsed.next}, done ${parsed.done})`)
  else log.fail(`the actual service ignored the requested budget: ${JSON.stringify({ status: page2048.status, bytes: page2048.bytes })}`)

  log.begin('B28-ACTUAL-SERVICE-16384-BOUND', 'the real service honours a 16384-byte request', 'controlled_process')
  const page16k = await raw('/v1/facts?since=0&maxBytes=16384')
  const parsed16k = (() => { try { return JSON.parse(page16k.body) } catch { return null } })()
  log.evidence({ status: page16k.status, bytes: page16k.bytes, frames: parsed16k?.frames?.length ?? null, next: parsed16k?.next ?? null })
  if (page16k.status === 200 && page16k.bytes <= 16384 && parsed16k) log.pass(`the actual service returned ${page16k.bytes} bytes for a 16384-byte request (${parsed16k.frames.length} frames)`)
  else log.fail(`16384 budget not honoured: ${JSON.stringify({ status: page16k.status, bytes: page16k.bytes })}`)

  log.begin('B28-ACTUAL-SERVICE-CONTINUITY', 'small pages walk the real journal without loss or renumbering', 'controlled_process')
  const seqs = []
  let cursor = 0, guard = 0
  for (;;) {
    guard += 1
    if (guard > 500) break
    const page = await raw(`/v1/facts?since=${cursor}&maxBytes=2048`)
    const body = (() => { try { return JSON.parse(page.body) } catch { return null } })()
    if (!body) { log.fail(`page at ${cursor} was not parseable`); break }
    for (const frame of body.frames) seqs.push(frame.seq)
    cursor = body.next
    if (body.done) break
    if (body.frames.length === 0) { log.fail('the replay stalled on an empty unfinished page'); break }
  }
  const contiguous = seqs.every((seq, index) => seq === index + 1)
  const unique = new Set(seqs).size === seqs.length
  log.evidence({ pages: guard, frames: seqs.length, journalFacts: total, contiguous, unique })
  if (seqs.length === total && contiguous && unique) log.pass(`walked ${total} real journal facts over ${guard} pages with contiguous seq and no duplicates`)
  else log.fail(`continuity failed: ${JSON.stringify({ frames: seqs.length, total, contiguous, unique })}`)

  log.begin('B28-ACTUAL-SERVICE-REFUSALS', 'invalid cursor and budget are refused, not silently clamped', 'controlled_process')
  const badSince = await raw('/v1/facts?since=-1&maxBytes=2048')
  const badBudget = await raw('/v1/facts?since=0&maxBytes=1')
  const hugeBudget = await raw('/v1/facts?since=0&maxBytes=999999999')
  const error = body => { try { return JSON.parse(body).error ?? null } catch { return null } }
  log.evidence({ badSince: [badSince.status, error(badSince.body)], badBudget: [badBudget.status, error(badBudget.body)], hugeBudget: [hugeBudget.status, error(hugeBudget.body)] })
  // An oversized request is refused explicitly rather than silently clamped; only the service's own inline
  // limit bounds a page, so a caller cannot ask for an unbounded response.
  if (badSince.status === 400 && error(badSince.body) === 'invalid_since' &&
      badBudget.status === 400 && error(badBudget.body) === 'invalid_page_budget' &&
      hugeBudget.status === 400 && error(hugeBudget.body) === 'invalid_page_budget') {
    log.pass('an invalid cursor and an out-of-range budget (1 and 999999999) were refused with invalid_since / invalid_page_budget instead of being clamped')
  } else log.fail(`refusals are wrong: ${JSON.stringify({ badSince: [badSince.status, error(badSince.body)], badBudget: [badBudget.status, error(badBudget.body)], hugeBudget: [hugeBudget.status, error(hugeBudget.body)] })}`)

  log.begin('B28-SCOPE-NOT-NATIVE', 'fixture lane; installed Codex not executed', 'controlled_process')
  log.notTested('no installed agent executed and no gateway contacted')
} finally {
  try { await runner?.close() } catch {}
  delete process.env.PA_RUNNER_RECOVERY_ROOT
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-28 actual service budget', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'real runner-service journal; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(44)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB28-budget totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
