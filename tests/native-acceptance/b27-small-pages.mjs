#!/usr/bin/env node
/**
 * Wave-27: 160 small facts must replay completely under a small page budget.
 *
 * The regression was not in the frames but in the page envelope: the budget counted frame bodies only,
 * so the assembled response overran the transport cap and surfaced as unknown_outcome even though every
 * fact was legal. The page is now budgeted as a whole encoded response and trimmed with done=false.
 */
import { lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaseLog, writeReport } from './harness.mjs'
import { serveRecoveryEndpoint } from '../../apps/runner/src/recovery-endpoint.ts'
import { connectRunnerRecovery } from '../../packages/execution/src/recovery-transport.ts'
import { makeAttemptSpec } from '../../packages/testing/src/index.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w27-small-'))
const producer = { source: 'codex-native', runnerIdentityRef: 'b27-runner' }
let endpoint
try {
  const spec = makeAttemptSpec()
  const entries = Array.from({ length: 160 }, (_, index) => ({
    seq: index + 1,
    fact: { factId: `fact-b27-${index + 1}`, ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract, kind: 'writer.observed', payloadRef: `payload-b27-${index + 1}`, observedAt: '2026-11-14T00:00:00.000Z' },
    payload: { index, note: 'small-but-real-shaped' },
  }))
  endpoint = await serveRecoveryEndpoint({
    directory: join(root, 'endpoint'), spec, runnerIdentityRef: producer.runnerIdentityRef, source: producer.source,
    resources: () => [{ ref: 'res-b27', ownership: 'spawned_process' }], state: () => 'serving',
    cancel: async () => {}, command: async () => {},
    facts: async (since, maxBytes) => {
      const frames = []; let bytes = 0, next = since, done = true
      for (const entry of entries.filter(candidate => candidate.seq > since)) {
        const frame = { seq: entry.seq, fact: entry.fact, payload: entry.payload }
        const size = Buffer.byteLength(JSON.stringify(frame))
        if (frames.length > 0 && bytes + size > maxBytes) { done = false; break }
        frames.push(frame); bytes += size; next = entry.seq
      }
      return { frames, next, done }
    },
  })
  const stat = lstatSync(endpoint.socketPath)
  const registered = { socketPath: endpoint.socketPath, credentialPath: endpoint.credentialPath, socketIdentity: { dev: stat.dev, ino: stat.ino } }
  const client = connectRunnerRecovery(registered, { attempt: { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }, ...producer }, 3000)

  log.begin('B27-160-SMALL-FACTS-FULL-REPLAY', 'every one of 160 small facts is replayed', 'controlled_process')
  const seen = []; let since = 0, pages = 0, done = false, largestPage = 0
  while (!done && pages < 400) {
    const page = await client.facts(since, 16_384)
    pages += 1
    largestPage = Math.max(largestPage, page.frames.length)
    for (const frame of page.frames) seen.push(frame.seq)
    since = page.next; done = page.done
    if (page.frames.length === 0 && !page.done) break
  }
  const unique = new Set(seen)
  const contiguous = seen.every((seq, index) => seq === index + 1)
  log.evidence({ pages, frames: seen.length, unique: unique.size, contiguous, largestPage, done })
  if (seen.length === 160 && unique.size === 160 && contiguous && done) log.pass(`replayed all 160 facts over ${pages} pages (largest ${largestPage} frames) with contiguous seq and a real end`)
  else log.fail(`160-fact replay incomplete: ${JSON.stringify({ pages, frames: seen.length, unique: unique.size, contiguous, done })}`)

  log.begin('B27-TINY-BUDGET-STILL-COMPLETES', 'a 2KiB page budget cannot stall the replay', 'controlled_process')
  const tiny = []; let cursor = 0, tinyPages = 0, tinyDone = false
  while (!tinyDone && tinyPages < 2000) {
    const page = await client.facts(cursor, 2048)
    tinyPages += 1
    for (const frame of page.frames) tiny.push(frame.seq)
    cursor = page.next; tinyDone = page.done
    if (page.frames.length === 0 && !page.done) { log.fail('the replay stalled on an empty but unfinished page'); break }
  }
  log.evidence({ tinyPages, tinyFacts: tiny.length, tinyDone })
  if (tiny.length === 160 && tinyDone) log.pass(`a 2KiB budget still returned all 160 facts over ${tinyPages} pages`)
  else log.fail(`small-budget replay did not complete: ${JSON.stringify({ tinyPages, tinyFacts: tiny.length, tinyDone })}`)

  log.begin('B27-SCOPE-NOT-NATIVE', 'local fixtures only', 'controlled_process')
  log.notTested('no installed agent executed, no gateway contacted')
} finally {
  try { await endpoint?.close() } catch {}
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-27 small-page replay', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'controlled endpoint; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(40)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB27 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
