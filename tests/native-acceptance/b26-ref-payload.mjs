#!/usr/bin/env node
/**
 * Wave-26: facts -> reference -> payload continuity.
 *
 * A real authenticated endpoint serves facts from a journal-shaped backend. One frame is larger than
 * the inline page budget, so it must come back as a reference; the caller then reads the whole payload in
 * bounded chunks (first, middle, last), verifying seq continuity, the digest and decoded byte counts.
 */
import { lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaseLog, writeReport } from './harness.mjs'
import { serveRecoveryEndpoint } from '../../apps/runner/src/recovery-endpoint.ts'
import { connectRunnerRecovery } from '../../packages/execution/src/recovery-transport.ts'
import { makeAttemptSpec } from '../../packages/testing/src/index.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w26-ref-'))
const producer = { source: 'codex-native', runnerIdentityRef: 'b26-runner' }
const CHUNK = 32_768
let endpoint
try {
  const spec = makeAttemptSpec()
  const big = { kind: 'writer.observed', value: { blob: 'w'.repeat(135_540) } }
  const bigBytes = Buffer.from(JSON.stringify(big), 'utf8')
  const digest = createHash('sha256').update(bigBytes).digest('hex')
  const fact = { factId: 'fact-b26-big', ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract, kind: 'writer.observed', payloadRef: 'payload-b26-big', observedAt: new Date().toISOString() }
  const small = (index) => ({ seq: index, fact: { ...fact, factId: `fact-b26-${index}`, payloadRef: `payload-b26-${index}` }, payload: { index } })
  const entries = [small(1), { seq: 2, fact, payload: big }, small(3)]

  endpoint = await serveRecoveryEndpoint({
    directory: join(root, 'endpoint'), spec, runnerIdentityRef: producer.runnerIdentityRef, source: producer.source,
    resources: () => [{ ref: 'res-b26', ownership: 'spawned_process' }],
    state: () => 'serving', cancel: async () => {}, command: async () => {},
    facts: async (since, maxBytes) => {
      const frames = []; let bytes = 0, next = since, done = true
      for (const entry of entries.filter(candidate => candidate.seq > since)) {
        const frame = { seq: entry.seq, fact: entry.fact, payload: entry.payload }
        const size = Buffer.byteLength(JSON.stringify(frame))
        if (size > maxBytes) {
          const payloadBytes = Buffer.from(JSON.stringify(entry.payload), 'utf8')
          frames.push({ seq: entry.seq, fact: entry.fact, payload: null, payloadRef: entry.fact.payloadRef, payloadBytes: payloadBytes.length, payloadDigest: createHash('sha256').update(payloadBytes).digest('hex') })
          bytes += Buffer.byteLength(JSON.stringify(frames[frames.length - 1])); next = entry.seq; continue
        }
        frames.push(frame); bytes += size; next = entry.seq
      }
      return { frames, next, done }
    },
    payload: async (ref, offset, length) => {
      if (ref !== 'payload-b26-big') throw new Error('Unknown payload reference')
      const slice = bigBytes.subarray(offset, offset + length)
      return { total: bigBytes.length, digest, base64: slice.toString('base64') }
    },
  })
  const stat = lstatSync(endpoint.socketPath)
  const registered = { socketPath: endpoint.socketPath, credentialPath: endpoint.credentialPath, socketIdentity: { dev: stat.dev, ino: stat.ino } }
  const client = connectRunnerRecovery(registered, { attempt: { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }, ...producer }, 3000)

  log.begin('B26-FIRST-PAGE-REFERENCE-DISCOVERY', 'a large frame is discoverable as a reference', 'controlled_process')
  const page = await client.facts(0, 16_384)
  const refFrame = page.frames.find(frame => frame.payloadRef === 'payload-b26-big')
  log.evidence({ frames: page.frames.length, seqs: page.frames.map(f => f.seq), refFrame: refFrame && { payloadRef: refFrame.payloadRef, payloadBytes: refFrame.payloadBytes, digestMatches: refFrame.payloadDigest === digest } })
  if (refFrame && refFrame.payload === null && refFrame.payloadDigest === digest) log.pass(`the large frame came back as a reference with payloadBytes ${refFrame.payloadBytes} and a matching digest`)
  else log.fail(`the large frame was not discoverable as a reference: ${JSON.stringify({ refFrame })}`)
  if (page.frames.map(f => f.seq).join(',') === '1,2,3') log.pass('the reference page still advanced through seq 1,2,3 with no gap')
  else log.fail(`page seqs were not continuous: ${JSON.stringify(page.frames.map(f => f.seq))}`)

  log.begin('B26-MULTI-CHUNK-PAYLOAD-MIDDLE-AND-LAST', 'first, middle and last chunks are all accepted', 'controlled_process')
  const chunks = []; let offset = 0, guard = 0
  while (offset < bigBytes.length && guard < 20) {
    const chunk = await client.payload('payload-b26-big', offset, CHUNK)
    guard += 1
    chunks.push({ offset, length: chunk.length })
    const bytes = Buffer.from(chunk.base64, 'base64')
    if (bytes.length !== chunk.length) { log.fail(`declared length ${chunk.length} disagreed with decoded bytes ${bytes.length}`); break }
    offset += bytes.length
  }
  log.evidence({ chunkCount: chunks.length, chunks, total: bigBytes.length })
  if (chunks.length >= 3 && offset === bigBytes.length) log.pass(`read ${chunks.length} chunks covering all ${bigBytes.length} bytes including intermediate chunks`)
  else log.fail(`payload reassembly incomplete: ${JSON.stringify({ chunkCount: chunks.length, offset, total: bigBytes.length })}`)

  log.begin('B26-FULL-DIGEST-MATCH', 'the reassembled payload digest matches the fact reference', 'controlled_process')
  const rebuilt = Buffer.concat(chunks.map(() => Buffer.alloc(0)))
  void rebuilt
  let assembled = Buffer.alloc(0); let cursor = 0
  while (cursor < bigBytes.length) {
    const chunk = await client.payload('payload-b26-big', cursor, CHUNK)
    const bytes = Buffer.from(chunk.base64, 'base64')
    assembled = Buffer.concat([assembled, bytes]); cursor += bytes.length
  }
  const assembledDigest = createHash('sha256').update(assembled).digest('hex')
  log.evidence({ assembledBytes: assembled.length, assembledDigest, expectedDigest: digest })
  if (assembled.length === bigBytes.length && assembledDigest === digest) log.pass(`the reassembled ${assembled.length} byte payload reproduces the referenced digest`)
  else log.fail(`reassembly did not reproduce the digest: ${JSON.stringify({ assembledBytes: assembled.length, assembledDigest })}`)

  log.begin('B26-FOREIGN-PRODUCER-PAYLOAD-REFUSED', 'a foreign producer cannot read this payment payload', 'controlled_process')
  let foreign = null
  try {
    const other = connectRunnerRecovery(registered, { attempt: { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }, runnerIdentityRef: 'foreign', source: 'foreign' }, 3000)
    await other.payload('payload-b26-big', 0, 1024)
  } catch (error) { foreign = { code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 100) } }
  log.evidence({ foreign })
  if (foreign) log.pass(`a foreign producer was refused (${foreign.code ?? 'error'})`)
  else log.fail('a foreign producer read the payload')

  log.begin('B26-SCOPE-NOT-NATIVE', 'local fixtures only', 'controlled_process')
  log.notTested('no installed agent executed, no gateway contacted')
} finally {
  try { await endpoint?.close() } catch {}
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-26 ref/payload continuity', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'controlled endpoint; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(42)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB26 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
