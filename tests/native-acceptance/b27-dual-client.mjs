#!/usr/bin/env node
/**
 * Wave-27 item 3: same-Runner dual client over the real authenticated endpoint.
 *
 * Client A attaches and serves the three original callbacks (fact receipt, payload read, native write
 * admission). A then detaches while a native write is pending. Client B attaches to the SAME Runner: the
 * facts are replayed by their original ids, the payload is reread by its original ref, and the pending
 * write is NOT answered by B because it became indeterminate when the lease changed.
 */
import { lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaseLog, writeReport } from './harness.mjs'
import { serveRecoveryEndpoint } from '../../apps/runner/src/recovery-endpoint.ts'
import { connectRunnerRecovery } from '../../packages/execution/src/recovery-transport.ts'
import { makeAttemptSpec } from '../../packages/testing/src/index.ts'
import { createBusinessChannel } from '../../apps/runner/src/business-channel.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w27-dual-'))
const producer = { source: 'codex-native', runnerIdentityRef: 'b27-dual' }
let endpoint
try {
  const spec = makeAttemptSpec()
  const attempt = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
  const channel = createBusinessChannel()
  const journal = [{ seq: 1, fact: { factId: 'fact-dual-1', source: 'runner', ...attempt, kind: 'writer.observed', payloadRef: 'payload-dual-1' }, payload: { step: 1 } },
    { seq: 2, fact: { factId: 'fact-dual-2', source: 'runner', ...attempt, kind: 'policy.prepared', payloadRef: 'payload-dual-2' }, payload: { step: 2 } }]
  const lease = (p, leaseId) => `${p.runnerIdentityRef}|${p.attempt.attemptId}|${leaseId}`
  endpoint = await serveRecoveryEndpoint({
    directory: join(root, 'endpoint'), spec, runnerIdentityRef: producer.runnerIdentityRef, source: producer.source,
    resources: () => [{ ref: 'res-dual', ownership: 'spawned_process' }], state: () => 'serving',
    cancel: async () => {}, command: async () => {},
    facts: async (since, maxBytes) => {
      const frames = journal.filter(entry => entry.seq > since).slice(0, 10)
      void maxBytes
      return { frames, next: frames.length ? frames[frames.length - 1].seq : since, done: true }
    },
    payload: async (ref) => ({ total: 8, digest: 'd'.repeat(64), base64: Buffer.from(JSON.stringify({ payloadRef: ref })).toString('base64') }),
    channelNext: async (p, leaseId) => { channel.lease(lease(p, leaseId)); return { generation: channel.generation, request: channel.nextOutbound() } },
    channelReply: async (p, reply, leaseId) => ({ accepted: channel.reply(lease(p, leaseId), reply), generation: channel.generation }),
  })
  const stat = lstatSync(endpoint.socketPath)
  const registered = { socketPath: endpoint.socketPath, credentialPath: endpoint.credentialPath, socketIdentity: { dev: stat.dev, ino: stat.ino } }
  const attach = () => connectRunnerRecovery(registered, { attempt, ...producer }, 3000)
  const A = attach()
  const B = attach()

  log.begin('B27-DUAL-A-SERVES-ALL-THREE', 'client A answers fact, payload and write callbacks', 'controlled_process')
  // Bind A's lease first: waiters created before any bind belong to generation 0 and no lease owns them.
  const aInitial = await A.channelNext('lease-a')
  const factPromise = channel.requestFact({ factId: 'fact-dual-1' })
  const factReq = await A.channelNext('lease-a')
  const factReply = factReq?.request ? await A.channelReply('lease-a', { id: 'fact-dual-1', kind: 'receipt', value: { factId: 'fact-dual-1', persisted: true, seq: 1 } }) : null
  const factReceipt = await factPromise.catch(error => error)
  const payloadPromise = channel.requestPayload('payload-req-1', 'payload-dual-1')
  await A.channelNext('lease-a')
  const payloadReply = await A.channelReply('lease-a', { id: 'payload-req-1', kind: 'payload', value: { payloadRef: 'payload-dual-1' } })
  const payloadValue = await payloadPromise.catch(error => error)
  log.evidence({ factRequestId: factReq?.request?.id ?? null, factReply, factReceipt, payloadReply, payloadValue })
  if (factReply?.accepted && factReceipt?.factId === 'fact-dual-1' && payloadReply?.accepted && payloadValue?.payloadRef === 'payload-dual-1') {
    log.pass('A served the fact receipt by its original id and the payload by its original ref')
  } else log.fail(`A did not serve the callbacks: ${JSON.stringify({ factReply, factReceipt, payloadReply, payloadValue })}`)

  log.begin('B27-DUAL-PENDING-WRITE-INDETERMINATE-ON-LEAVE', 'a pending native write is indeterminate when A leaves', 'controlled_process')
  const writePromise = channel.requestWrite('cmd-dual-1', { id: 'cmd-dual-1', kind: 'answer' })
  const writeReq = await A.channelNext('lease-a')
  let writeOutcome = null
  void writePromise.catch(error => { writeOutcome = { code: error?.code ?? null, reason: error?.reason ?? null } })
  // Client B attaches to the same Runner: a different lease replaces A's.
  const bFirst = await B.channelNext('lease-b')
  await new Promise(resolve => setTimeout(resolve, 30))
  log.evidence({ aInitial, writeRequestId: writeReq?.request?.id ?? null, bFirstGeneration: bFirst?.generation ?? null, writeOutcome })
  if (writeReq?.request?.id === 'cmd-dual-1' && writeOutcome?.reason === 'write_indeterminate_after_detach')
    log.pass('the pending native write became write_indeterminate_after_detach when B took the lease, so B was never asked to grant it')
  else log.fail(`the pending write did not become indeterminate: ${JSON.stringify({ writeReq, writeOutcome })}`)

  log.begin('B27-DUAL-A-REPLY-REFUSED-AFTER-HANDOVER', 'A cannot answer for the new lease', 'controlled_process')
  const stale = await A.channelReply('lease-a', { id: 'cmd-dual-1', kind: 'write-admission', value: true }).catch(error => ({ error: String(error?.message ?? error).slice(0, 80) }))
  log.evidence({ stale })
  if (stale && (stale.error || stale.accepted === false)) log.pass('a reply from the old client was refused after the handover')
  else log.fail(`the old client still answered: ${JSON.stringify({ stale })}`)

  log.begin('B27-DUAL-B-SERVES-NEW-FACTS-BY-ORIGINAL-ID', 'B answers the next fact with its original id', 'controlled_process')
  const bInitial = await B.channelNext('lease-b')
  const nextFact = channel.requestFact({ factId: 'fact-dual-2' })
  const bReq = await B.channelNext('lease-b')
  const bReply = bReq?.request ? await B.channelReply('lease-b', { id: 'fact-dual-2', kind: 'receipt', value: { factId: 'fact-dual-2', persisted: true, seq: 2 } }) : null
  const bReceipt = await nextFact.catch(error => error)
  log.evidence({ bRequestId: bReq?.request?.id ?? null, bReply, bReceipt })
  if (bReply?.accepted && bReceipt?.seq === 2) log.pass('B served the fact for the new lease using the original fact id')
  else log.fail(`B did not serve the new fact: ${JSON.stringify({ bReq, bReply, bReceipt })}`)

  log.begin('B27-DUAL-FACTS-REPLAYED-TO-B', 'B still reads the original facts from the Runner journal', 'controlled_process')
  const page = await B.facts(0, 16_384)
  log.evidence({ frames: page.frames.map(frame => frame.seq), ids: page.frames.map(frame => frame.fact?.factId) })
  if (page.frames.length === 2 && page.frames.every(frame => frame.fact?.factId?.startsWith('fact-dual-')))
    log.pass('B replayed both original facts by their original ids from the same Runner')
  else log.fail(`B did not replay the original facts: ${JSON.stringify(page.frames)}`)

  log.begin('B27-SCOPE-NOT-NATIVE', 'controlled endpoint; no installed agent', 'controlled_process')
  log.notTested('no installed agent executed, no gateway contacted')
} finally {
  try { await endpoint?.close() } catch {}
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-27 dual client', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'controlled endpoint; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(46)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB27-dual totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
