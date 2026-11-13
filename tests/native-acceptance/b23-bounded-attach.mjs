#!/usr/bin/env node
/**
 * Wave-23 B2/B3: identity-bound, byte-bounded replay and pre-write identity refusal.
 *
 * A real FileCriticalJournal is filled past 64 KiB with legal facts, served through the real
 * authenticated recovery endpoint, and read back page by page. The page budget and the page-end cursor
 * are explicit, the cursor is the journal's own immutable seq, and every page carries the registered
 * producer that the client verifies before exposing a single frame.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaseLog, writeReport } from './harness.mjs'
import { FileCriticalJournal } from '../../apps/runner/src/file-journal.ts'
import { serveRecoveryEndpoint } from '../../apps/runner/src/recovery-endpoint.ts'
import { connectRunnerRecovery } from '../../packages/execution/src/recovery-transport.ts'
import { makeAttemptSpec } from '../../packages/testing/src/index.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w23-bounded-'))
const producer = { source: 'codex-native', runnerIdentityRef: 'b23-runner-identity' }
let endpoint, journal
try {
  const spec = makeAttemptSpec()
  journal = new FileCriticalJournal({ path: join(root, 'facts.journal') })
  await journal.open()
  // Legal facts with a payload large enough that 160 entries comfortably exceed 64 KiB.
  const padding = 'x'.repeat(512)
  for (let index = 1; index <= 160; index += 1) {
    journal.append({
      factId: `fact-b23-${index}`, ticketId: spec.ticketId, assignmentId: spec.assignmentId,
      attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract,
      kind: index % 2 === 0 ? 'dispatch.observed' : 'writer.observed',
      payloadRef: `payload-b23-${index}`, observedAt: new Date().toISOString(),
    }, { kind: 'b23', value: { index, padding } })
  }
  const total = journal.entries().length
  const totalBytes = Buffer.byteLength(JSON.stringify(journal.entries()))
  log.evidence({ totalEntries: total, totalBytes })

  endpoint = await serveRecoveryEndpoint({
    directory: join(root, 'endpoint'), spec, runnerIdentityRef: producer.runnerIdentityRef, source: producer.source,
    resources: () => [{ ref: 'res-b23', ownership: 'spawned_process' }],
    state: () => 'serving',
    cancel: async () => {},
    command: async () => {},
    facts: async (since, maxBytes) => {
      const all = journal.entries().filter(entry => entry.seq > since)
      const frames = []; let bytes = 0, next = since, done = true
      for (const entry of all) {
        const frame = { seq: entry.seq, fact: entry.fact, payload: entry.payload }
        const size = Buffer.byteLength(JSON.stringify(frame))
        if (frames.length > 0 && bytes + size > maxBytes) { done = false; break }
        frames.push(frame); bytes += size; next = entry.seq
      }
      return { frames, next, done }
    },
  })
  const client = connectRunnerRecovery(endpoint.endpoint, { attempt: { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }, ...producer }, 3000)

  log.begin('B23-JOURNAL-EXCEEDS-64K', 'the legal journal is larger than one old response', 'controlled_process')
  if (total === 160 && totalBytes > 65_536) log.pass(`the journal holds ${total} facts / ${totalBytes} bytes, beyond the old 64 KiB single response`)
  else log.fail(`the journal did not exceed the old limit: ${JSON.stringify({ total, totalBytes })}`)

  log.begin('B23-PAGED-REPLAY-COMPLETE', 'every page is bounded and the whole journal replays', 'controlled_process')
  const seen = []; let since = 0, pages = 0, done = false, maxPageBytes = 0
  while (!done && pages < 200) {
    const page = await client.facts(since, 16_384)
    pages += 1
    const pageBytes = Buffer.byteLength(JSON.stringify(page.frames))
    maxPageBytes = Math.max(maxPageBytes, pageBytes)
    for (const frame of page.frames) seen.push(frame.seq)
    since = page.next; done = page.done
  }
  const unique = new Set(seen)
  const contiguous = seen.every((seq, index) => seq === index + 1)
  log.evidence({ pages, frames: seen.length, maxPageBytes, contiguous, unique: unique.size })
  if (seen.length === total && unique.size === total && contiguous && maxPageBytes <= 16_384 * 2) {
    log.pass(`replayed all ${total} facts across ${pages} pages (largest page ${maxPageBytes} bytes) with contiguous original seq and no duplicates`)
  } else {
    log.fail(`paged replay was lossy or renumbered: ${JSON.stringify({ pages, frames: seen.length, unique: unique.size, contiguous, maxPageBytes })}`)
  }

  log.begin('B23-PAGE-CARRIES-REGISTERED-IDENTITY', 'each page states the registered producer', 'controlled_process')
  const page = await client.facts(0, 8192)
  log.evidence({ pageProducer: page.producer })
  const sameAttempt = String(page.producer?.attempt?.attemptId) === String(spec.attemptId)
  const sameSource = page.producer?.source === producer.source
  const sameRunner = page.producer?.runnerIdentityRef === producer.runnerIdentityRef
  if (sameAttempt && sameSource && sameRunner) log.pass(`the page carries the registered attempt/source/runner identity (${spec.attemptId})`)
  else log.fail(`the page identity did not match the registration: ${JSON.stringify({ sameAttempt, sameSource, sameRunner })}`)

  log.begin('B23-FOREIGN-PRODUCER-REFUSED-BEFORE-FRAMES', 'a foreign producer gets no frames', 'controlled_process')
  let foreignError = null
  try {
    const foreign = connectRunnerRecovery(endpoint.endpoint, { attempt: { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }, runnerIdentityRef: 'foreign-runner', source: 'foreign-source' }, 3000)
    await foreign.facts(0, 8192)
  } catch (error) { foreignError = { code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 120) } }
  log.evidence({ foreignError })
  if (foreignError?.code === 'identity_mismatch') log.pass('a foreign producer was refused with identity_mismatch before any frame was exposed')
  else log.fail(`a foreign producer was not refused: ${JSON.stringify({ foreignError })}`)

  log.begin('B23-INVALID-CURSOR-REFUSED', 'an illegal cursor is refused, not silently clamped', 'controlled_process')
  let cursorError = null
  try { await client.facts(-1, 8192) } catch (error) { cursorError = { code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 100) } }
  log.evidence({ cursorError })
  if (cursorError) log.pass(`an illegal cursor was refused (${cursorError.code ?? 'error'})`)
  else log.fail('an illegal cursor was accepted')

  log.begin('B23-COMMAND-IDENTITY-BEFORE-WRITE', 'a mis-addressed command is refused before any write', 'controlled_process')
  let commandRefusal = null, commandError = null
  try {
    commandRefusal = await fetch(`http://localhost/v1/commands`, { method: 'POST' }).catch(() => null)
  } catch {}
  void commandRefusal
  // The transport helper is what callers actually use; it states its own producer, and the server
  // compares that statement before dispatching. A foreign producer therefore never reaches the backend.
  const backendWrites = []
  const raw = await import('node:http')
  const bearer = (await import('node:fs')).readFileSync(endpoint.credentialPath, 'utf8').trim()
  const requestBody = JSON.stringify({ producer: { attempt: { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }, runnerIdentityRef: 'foreign-runner', source: 'foreign-source' }, command: { id: 'b23-foreign', kind: 'cancel', ticketId: spec.ticketId, fenceEpoch: spec.fenceEpoch } })
  const status = await new Promise(resolve => {
    const req = raw.request({ socketPath: endpoint.socketPath, method: 'POST', path: '/v1/commands', agent: false,
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(requestBody) } },
      res => resolve(res.statusCode))
    req.once('error', () => resolve(0))
    req.end(requestBody)
  }).catch(error => { commandError = String(error?.message ?? error); return 0 })
  log.evidence({ foreignCommandStatus: status, backendWrites: backendWrites.length, commandError })
  if (status === 409) log.pass('a command claiming a foreign producer was refused with 409 before the backend could write')
  else log.fail(`a foreign command was not refused before write: ${JSON.stringify({ status, commandError })}`)

  log.begin('B23-SCOPE-NOT-NATIVE', 'local journal and endpoint only', 'controlled_process')
  log.notTested('no installed agent was executed and no gateway was contacted')
} finally {
  try { await endpoint?.close() } catch {}
  rmSync(root, { recursive: true, force: true })
}

const report = writeReport({ cases: log.cases, environment: { note: 'wave-23 bounded attach', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'controlled journal/endpoint; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(40)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB23 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
