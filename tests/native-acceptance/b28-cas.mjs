#!/usr/bin/env node
/**
 * Wave-28 B3: explicit authenticated CAS and read-only poll.
 *
 * A binds with the generation it read; B replaces A only by presenting the CURRENT generation; an old A
 * cannot poll or reply afterwards; a foreign registration is refused before any bind; a wrong CAS changes
 * nothing. Generation and pending counters are read from the live Runner, not from a local test copy.
 */
import { lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { RunnerLink } from '../../apps/runner/src/runner-link-client.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'
import { connectRunnerRecovery } from '../../packages/execution/src/recovery-transport.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w28-cas-'))
const recoveryRoot = join(root, 'recovery')
mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 })
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))
const producer = { source: 'fake-driver', runnerIdentityRef: 'b28-cas' }
let runner
try {
  process.env.PA_RUNNER_RECOVERY_ROOT = recoveryRoot
  const spec = makeAttemptSpec()
  const link = new RunnerLink({ executable: process.execPath, entry: ENTRY, args: ['waiting-user'], stateRoot: join(root, 'attempt'), producer })
  link.bindPayload(spec.policySnapshotRef, { kind: 'fixture-settings/1', workspacePath: process.cwd(), scope: { projectId: 'p', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, approvalPolicy: 'on-request', timeoutMs: 600000 })
  link.bindPayload('input-cas', { inputId: 'input-cas', contract: spec.contract, text: 'cas', contextRefs: [], sourceMessageRefs: [], provenance: 'authorized_work_input' })
  const facts = []
  runner = await link.spawnAttempt(spec, async fact => { facts.push(fact); return { factId: fact.factId, persisted: true, seq: facts.length } })
  const directory = endpointDirectory(recoveryRoot, spec.attemptId)
  let registered = null
  for (let index = 0; index < 400 && !registered; index += 1) {
    try { const stat = lstatSync(`${directory}/runner.sock`); registered = { socketPath: `${directory}/runner.sock`, credentialPath: `${directory}/runner.credential`, socketIdentity: { dev: stat.dev, ino: stat.ino } } }
    catch { await new Promise(resolve => setTimeout(resolve, 50)) }
  }
  const attempt = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
  const A = connectRunnerRecovery(registered, { attempt, ...producer }, 3000)
  const B = connectRunnerRecovery(registered, { attempt, ...producer }, 3000)
  // A DIFFERENT registered source: it must be refused before any bind, not treated as another client.
  const F = connectRunnerRecovery(registered, { attempt, source: 'foreign-source', runnerIdentityRef: 'b28-foreign' }, 3000)

  log.begin('B28-CAS-A-BINDS-FROM-READ-GENERATION', 'client A binds with the generation it read', 'controlled_process')
  const aRead = await A.channelState()
  const aPage = await A.channelNext('lease-a', aRead.generation)
  const aGeneration = aPage.generation
  log.evidence({ readGeneration: aRead.generation, aGeneration })
  if (Number.isSafeInteger(aRead.generation) && Number.isSafeInteger(aGeneration) && aGeneration > aRead.generation) log.pass(`A read generation ${aRead.generation} and bound generation ${aGeneration} with an explicit CAS`)
  else log.fail(`A could not bind explicitly: ${JSON.stringify({ aRead, aPage })}`)

  log.begin('B28-CAS-B-REPLACES-A-WITH-CURRENT-GENERATION', 'B replaces A only with the current generation', 'controlled_process')
  const bRead = await B.channelState()
  const bPage = await B.channelNext('lease-b', bRead.generation)
  const bGeneration = bPage.generation
  log.evidence({ bRead: bRead.generation, bGeneration })
  if (Number.isSafeInteger(bGeneration) && bGeneration > bRead.generation) log.pass(`B read generation ${bRead.generation} and bound generation ${bGeneration}, replacing A's lease`)
  else log.fail(`B could not take over: ${JSON.stringify({ bRead, bPage })}`)

  log.begin('B28-CAS-OLD-A-POLL-REFUSED', 'old A cannot poll after B bound', 'controlled_process')
  let aPollError = null
  try { await A.channelNext('lease-a', aGeneration) } catch (error) { aPollError = { code: error?.code ?? null, serverError: error?.serverError ?? null } }
  const afterAPoll = await B.channelState()
  log.evidence({ aPollError, generationAfter: afterAPoll.generation, bGeneration })
  if (aPollError && afterAPoll.generation === bGeneration) log.pass(`old A's poll was refused (${aPollError.serverError ?? aPollError.code}) and the generation stayed ${afterAPoll.generation}`)
  else log.fail(`old A's poll was not a harmless refusal: ${JSON.stringify({ aPollError, generation: afterAPoll.generation })}`)

  log.begin('B28-CAS-FOREIGN-SOURCE-REFUSED-BEFORE-BIND', 'a foreign registration is refused without binding', 'controlled_process')
  let foreignError = null
  try { await F.channelNext('lease-foreign', afterAPoll.generation) } catch (error) { foreignError = { code: error?.code ?? null, serverError: error?.serverError ?? null } }
  const afterForeign = await B.channelState()
  log.evidence({ foreignError, generationAfter: afterForeign.generation })
  if (foreignError && afterForeign.generation === bGeneration) log.pass(`the foreign registration was refused (${foreignError.serverError ?? foreignError.code}) and the generation stayed ${afterForeign.generation}`)
  else log.fail(`a foreign registration changed the channel: ${JSON.stringify({ foreignError, generation: afterForeign.generation })}`)

  log.begin('B28-CAS-WRONG-GENERATION-BOUNDED', 'a wrong CAS is refused and changes nothing', 'controlled_process')
  let wrongError = null
  try { await A.channelNext('lease-wrong', afterForeign.generation + 7) } catch (error) { wrongError = { code: error?.code ?? null, serverError: error?.serverError ?? null } }
  const afterWrong = await B.channelState()
  log.evidence({ wrongError, generationAfter: afterWrong.generation })
  if (wrongError && afterWrong.generation === bGeneration) log.pass(`a CAS for generation +7 was refused (${wrongError.serverError ?? wrongError.code}) and the live generation stayed ${afterWrong.generation}`)
  else log.fail(`the wrong CAS was not refused harmlessly: ${JSON.stringify({ wrongError, generation: afterWrong.generation })}`)

  log.begin('B28-CAS-LATE-REPLY-REFUSED', 'a late reply from the replaced lease is refused', 'controlled_process')
  let lateError = null
  try { await A.channelReply('lease-a', { v: 1, type: 'write-admission', id: 'no-such-request', allowed: true }) } catch (error) { lateError = { code: error?.code ?? null, serverError: error?.serverError ?? null } }
  const afterLate = await B.channelState()
  log.evidence({ lateError, generationAfter: afterLate.generation })
  if (lateError && afterLate.generation === bGeneration) log.pass('the replaced lease could not answer, and nothing about the live connection changed')
  else log.fail(`the late reply was not refused: ${JSON.stringify({ lateError, generation: afterLate.generation })}`)

  log.begin('B28-CAS-B-STILL-OWNS-THE-CHANNEL', 'B still owns the channel after every refusal', 'controlled_process')
  const bAgain = await B.channelNext('lease-b', bGeneration).then(page => ({ page })).catch(error => ({ error: String(error?.message ?? error).slice(0, 90) }))
  log.evidence({ bAgain: bAgain.page ? { generation: bAgain.page.generation, hasRequest: bAgain.page.request !== null } : bAgain })
  if (!bAgain.error && bAgain.page.generation === bGeneration) log.pass('B continued polling its own lease (same generation, no rebind) after the old and foreign attempts were refused')
  else log.fail(`B lost its lease: ${JSON.stringify(bAgain)}`)

  log.begin('B28-SCOPE-NOT-NATIVE', 'fixture lane; installed Codex not executed', 'controlled_process')
  log.notTested('no installed agent executed and no gateway contacted')
} finally {
  try { await runner?.close() } catch {}
  delete process.env.PA_RUNNER_RECOVERY_ROOT
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-28 CAS and poll ownership', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'real runner-service endpoint; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(48)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB28-cas totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
