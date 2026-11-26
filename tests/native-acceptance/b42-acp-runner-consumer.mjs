#!/usr/bin/env node
/**
 * M04 B: actual Runner consumer for the ACP Driver (controlled fake ACP peer, zero model prompts).
 *
 * A fake ACP executable speaks initialize/session/new/prompt and asks for permission over ACP. The Runner
 * is spawned through the trusted factory (`acp-v1`), an attached caller reads the original question fact
 * payload, answers the exact native request id, and the same attempt completes. No real model, network,
 * credential or business prompt is used.
 */
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { lstatSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { RunnerLink } from '../../apps/runner/src/runner-link-client.ts'
import { attachRunnerAttempt } from '../../packages/execution/src/attached-attempt.ts'
import { connectRunnerRecovery } from '../../packages/execution/src/recovery-transport.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'
import { canonicalDigest } from '../../packages/contracts/src/canonical.ts'

const log = new CaseLog()
const root = await mkdtemp(join(tmpdir(), 'pa-m04-acp-'))
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const fakeAcp = join(root, 'fake-acp.mjs')
await writeFile(fakeAcp, `#!/usr/bin/env node
import readline from 'node:readline'
const out = value => process.stdout.write(JSON.stringify(value) + '\\n')
const rl = readline.createInterface({ input: process.stdin })
let promptId, permissionOpen = false, stopReason = 'end_turn'
rl.on('line', line => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.method === 'initialize') return out({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { embeddedContext: true } }, agentInfo: { name: 'FakeACP', version: '0.0.1' } } })
  if (message.method === 'session/new') return out({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'ses-fake-1', configOptions: [] } })
  if (message.method === 'session/prompt') {
    promptId = message.id
    out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'ses-fake-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'working' } } } })
    permissionOpen = true
    return out({ jsonrpc: '2.0', id: 1, method: 'session/request_permission', params: { sessionId: 'ses-fake-1', toolCall: { toolCallId: 'tool-1', title: 'Run controlled check' }, options: [ { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' } ] } })
  }
  if (message.method === 'session/cancel') return out({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'cancelled' } })
  if (message.id === 1 && permissionOpen) {
    permissionOpen = false
    const selected = message.result?.outcome?.optionId
    stopReason = selected === 'allow-once' ? 'end_turn' : 'refusal'
    return out({ jsonrpc: '2.0', id: promptId, result: { stopReason } })
  }
})
`)
await chmod(fakeAcp, 0o755)
const spec = makeAttemptSpec()
const producer = { source: 'acp-v1', runnerIdentityRef: 'm04-acp-runner' }
const profile = { id: 'profile-acp-fake', revision: 1, driverId: 'acp-v1', driverApiMajor: 1, driverRelease: '0.1.0', executable: fakeAcp, argv: [], expectedVersion: '0.0.1', nativeConfigRef: 'config-acp', permissionPolicyRevision: 'policy-acp', requiredFeatures: [] }
const attempt = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
const commands = []
let runner
try {
  process.env.PA_RUNNER_RECOVERY_ROOT = join(root, 'recovery')
  process.env.PA_RUNNER_RECEIVER_LOG = join(root, 'receiver.jsonl')
  const scope = { projectId: 'project-1', allowedPaths: ['.'], excludedPaths: [], externalActions: [] }
  const policyPayloads = new Map([
    [spec.policySnapshotRef, { kind: 'acp-v1-settings/1', workspacePath: root, scope, enforcement: 'enforced', verification: 'passed', policyEvidenceRef: 'policy-evidence-acp-1' }],
    ['policy-evidence-acp-1', { kind: 'acp-v1-policy-evidence/1', workspacePath: root, scopeDigest: canonicalDigest(scope), enforcement: 'enforced', verification: 'passed', evidenceRefs: ['controlled-policy-evidence'] }],
    ['input-acp', { inputId: 'input-acp', contract: spec.contract, text: 'Controlled ACP input text', contextRefs: [], sourceMessageRefs: [], provenance: 'authorized_work_input' }],
  ])
  const link = new RunnerLink({ executable: process.execPath, entry: ENTRY, args: ['acp-v1', '--pure'], stateRoot: join(root, 'attempt'), producer })
  link.bindPayload(spec.policySnapshotRef, policyPayloads.get(spec.policySnapshotRef))
  link.bindPayload('policy-evidence-acp-1', policyPayloads.get('policy-evidence-acp-1'))
  link.bindPayload('input-acp', policyPayloads.get('input-acp'))
  runner = await link.spawnAttempt({ ...spec, profile }, async fact => ({ factId: fact.factId, persisted: true, seq: commands.length }))
  const directory = endpointDirectory(process.env.PA_RUNNER_RECOVERY_ROOT, spec.attemptId)
  let registered = null
  for (let index = 0; index < 400 && !registered; index += 1) {
    try { const stat = lstatSync(`${directory}/runner.sock`); registered = { socketPath: `${directory}/runner.sock`, credentialPath: `${directory}/runner.credential`, socketIdentity: { dev: stat.dev, ino: stat.ino } } }
    catch { await wait(25) }
  }
  const context = { attempt, ...producer }
  const client = connectRunnerRecovery(registered, context, 3000)
  const state = await client.channelState()
  await client.channelNext('lease-acp-runner', state.generation)
  const facts = []
  let questionAnswer
  let beginResult = 'not_sent'
  let preparedRef
  let sequence = 0
  const pump = async (page) => {
    const request = page?.request
    if (!request) return false
    if (request.type === 'fact') {
      const fact = request.fact
      facts.push(fact)
      if (fact.kind === 'question.opened' && !questionAnswer) {
        const raw = await fetchPayload(registered, context, fact.payloadRef)
        const target = raw?.value?.targets?.[0]
        questionAnswer = { binding: target, option: raw?.value?.presentation?.options?.[0]?.id }
      }
      if (fact.kind === 'policy.prepared' && !preparedRef) {
        const raw = await fetchPayload(registered, context, fact.payloadRef)
        preparedRef = `payload:${canonicalDigest(raw.value)}`
        beginResult = await runner.command(makeCommand('begin', { ...attempt, id: 'cmd-acp-begin', inputRef: 'input-acp', preparedPolicyRef: preparedRef }))
          .then(() => 'accepted').catch(error => `refused:${String(error?.message ?? error).slice(0, 160)}`)
      }
      await client.channelReply('lease-acp-runner', { v: 1, type: 'receipt', id: request.id, factId: fact.factId, receipt: { factId: fact.factId, persisted: true, seq: ++sequence } })
      return true
    }
    if (request.type === 'payload-read') {
      const value = policyPayloads.get(request.reference) ?? await fetchPayload(registered, context, request.reference).catch(() => undefined)
      await client.channelReply('lease-acp-runner', { v: 1, type: 'payload', id: request.requestId, requestId: request.requestId, value: value ?? {} })
      return true
    }
    if (request.type === 'native-write-intent') {
      // Controlled consumer guard: admit only the exact answer command this test sends.
      const allowed = request.command?.kind === 'answer' && request.command?.id === 'cmd-acp-answer'
      await client.channelReply('lease-acp-runner', { v: 1, type: 'write-admission', id: request.id, allowed })
      return true
    }
    return false
  }
  let answered = false
  for (let index = 0; index < 1000 && !facts.some(fact => fact.kind === 'turn.ended'); index += 1) {
    const page = await client.channelNext('lease-acp-runner').catch(() => null)
    if (await pump(page)) continue
    if (preparedRef && questionAnswer && !answered) {
      answered = true
      const bindingRef = 'binding-acp-1'
      const answerRef = 'answer-acp-1'
      const binding = questionAnswer.binding
      policyPayloads.set(bindingRef, binding)
      policyPayloads.set(answerRef, {
        answerId: 'answer-acp-1', questionId: facts.find(fact => fact.kind === 'question.opened')?.factId ? (await fetchPayload(registered, context, facts.find(fact => fact.kind === 'question.opened').payloadRef)).value.id : 'acp-question',
        questionVersion: 1, nativeBinding: binding, answer: { kind: 'choices', optionIds: [questionAnswer.option] }, authorityRef: 'authority-acp-1',
      })
      await client.command(makeCommand('answer', { ...attempt, id: 'cmd-acp-answer', nativeBindingRef: bindingRef, answerRef }), 'lease-acp-runner').catch(() => undefined)
    }
    await wait(10)
  }
  const earlyExit = await Promise.race([runner.waitExit().then(value => ({ value })).catch(error => ({ error: String(error) })), wait(500).then(() => null)])
  const receiver = (() => { try { return readFileSync(join(root, 'receiver.jsonl'), 'utf8').trim().split('\n').filter(Boolean) } catch { return [] } })()
  const errorFact = facts.find(fact => fact.kind === 'runtime.error')
  const errorPayload = errorFact ? await fetchPayload(registered, context, errorFact.payloadRef).catch(() => undefined) : undefined
  const kinds = facts.map(fact => fact.kind)
  const answerFact = facts.find(fact => fact.kind === 'answer.observed')
  let answerPayload
  if (answerFact) {
    const raw = await fetchPayload(registered, context, answerFact.payloadRef)
    answerPayload = raw?.value
  }
  log.begin('M04-ACP-RUNNER-QUESTION-ANSWER', 'the ACP Driver runs through the original Runner and answers the exact native permission request', 'controlled_process')
  log.evidence({ kinds, questionAnswer, answerPayload, beginResult, earlyExit, receiver, errorPayload })
  const targetPreserved = answerPayload?.targetBindingId === questionAnswer?.binding?.id && answerPayload?.answerId === 'answer-acp-1'
  if (kinds.includes('question.opened') && kinds.includes('answer.observed') && kinds.includes('turn.ended') && targetPreserved) {
    log.pass('the fake ACP peer served initialize/session/prompt through the Runner; the original question target was answered (response_written) and the same attempt reached turn.ended')
  } else log.fail(`ACP Runner consumer did not complete: ${JSON.stringify({ kinds, answerPayload, questionAnswer, beginResult, earlyExit, receiver, errorPayload })}`)

  log.begin('M04-ACP-NO-REAL-PROMPT', 'controlled fake ACP peer; no model/native/network prompt', 'controlled_process')
  log.notTested('the ACP peer is a local controlled fake; real ACP prompt/approval/stop acceptance is not claimed and the six-send grant remains unused')
  await runner.close()
  runner = undefined
} finally {
  try { if (runner) await runner.close() } catch {}
  delete process.env.PA_RUNNER_RECOVERY_ROOT
  delete process.env.PA_RUNNER_RECEIVER_LOG
  await rm(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'M04 ACP Runner consumer with controlled fake peer', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'Runner/factory/AttachIO integration; no real ACP prompt' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(52)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB42-acp totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)

async function fetchPayload(registered, context, ref) {
  const client = connectRunnerRecovery(registered, context, 3000)
  const chunk = await client.payload(ref)
  return JSON.parse(Buffer.from(chunk.base64, 'base64').toString('utf8'))
}
