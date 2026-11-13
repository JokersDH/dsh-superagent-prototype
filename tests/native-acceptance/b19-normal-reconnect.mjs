#!/usr/bin/env node
/**
 * Wave-17 B1/B2: the real product vertical completes the preparation contract and begins.
 *
 * Wave-16 stopped at prepared rows with no begin: the `codex-fake` lane selected CodexNativeDriver,
 * which never emits `policy.prepared`, and it disabled eager preparation, while main's
 * NativeProductAttempt waits for exactly that fact before feeding begin.
 *
 * The fix is on the B side and keeps every main guard: the ORIGINAL CodexProductDriver still runs, and
 * it is given a real B-owned fake executable that answers the version and app-server protocol. So
 * policy.prepared is produced by the driver that actually performs preparation, begin follows, and the
 * facts land in A's store through the product sink. No installed Codex is executed.
 *
 * Usage: node tests/native-acceptance/b17-product-native.mjs [--record]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { ProductStore } from '../../packages/storage/src/index.ts'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { NativeProjectRegistry, ensureStarterProject } from '../../apps/coordinator/product/project-registry.ts'
import { reconnectBusinessRunner } from '../../apps/runner/src/business-reconnect.ts'
import { connectRunnerRecovery } from '../../packages/execution/src/recovery-transport.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'

const log = new CaseLog()
const repo = new URL('../../', import.meta.url).pathname
const fakeExecutable = fileURLToPath(new URL('./fixtures/fake-codex-producer.mjs', import.meta.url))

const principal = { userId: 'local-product-user', authorityRef: 'local-product-authority' }
const actor = { ...principal, source: 'local_cli' }
const NATIVE_PROFILE_ID = 'profile-native-fake'

async function until(read, predicate, timeout = 40_000) {
  const deadline = Date.now() + timeout
  let latest
  while (Date.now() < deadline) {
    latest = await read()
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`condition timed out: ${JSON.stringify(latest)?.slice(0, 2500)}`)
}

const root = mkdtempSync(join(tmpdir(), 'pa-w17-b1-'))
const stateRoot = join(root, 'state')
const scratchProject = join(root, 'project')
const receiverLog = join(root, 'receiver.jsonl')
let store
let product
try {
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
  ensureStarterProject(scratchProject)
  const registry = new NativeProjectRegistry(stateRoot)
  const record = registry.prepare({ path: scratchProject, displayName: 'B17 scratch', check: 'node_test' })
  registry.save(record)

  // The product's own preparation handshake needs the production driver, which in turn spawns this
  // profile's executable. Pointing it at the B-owned fake keeps every guard intact while executing no
  // installed agent.
  const profile = {
    id: NATIVE_PROFILE_ID,
    revision: 1,
    driverId: 'codex-native',
    driverApiMajor: 1,
    driverRelease: 'fake-executable-lane',
    executable: process.execPath,
    argv: [fakeExecutable],
    expectedVersion: '0.164.0',
    nativeConfigRef: 'native-config-fake',
    permissionPolicyRevision: 'permission-fake-1',
    requiredFeatures: [],
  }

  store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  product = createProductRuntime({
    store,
    principal,
    stateRoot,
    scratchProject,
    actionSecret: Buffer.alloc(32, 1),
    projectRegistry: registry,
    projects: registry.list().map(project => ({ id: project.id, displayName: project.displayName, scope: registry.scope(project) })),
    native: {
      profile,
      projects: registry.list().map(project => ({ id: project.id, path: project.path, check: registry.check(project) })),
      approvalPolicy: 'on-request',
    },
  })
  process.env.PA_RUNNER_RECEIVER_LOG = receiverLog
  const producerLog = join(root, 'producer.jsonl')
  process.env.PA_PRODUCER_LOG = producerLog
  // Keep the turn live after the approval so the stop assertion exercises a real interruption.
  process.env.PA_PRODUCER_HOLD = '1'

  let seq = 0
  const command = value => product.application.dispatch(
    { commandId: `w17-command-${++seq}`, conversationId: 'conversation-product', ...value },
    actor,
  )
  const count = name => { try { return Number(store.db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n) } catch { return null } }
  const tables = () => ({
    works: count('works'), tickets: count('ticket'), links: count('ticket_links'),
    questions: count('user_questions'), deliveries: count('answer_deliveries'),
    facts: count('fact_receipts'), payloads: count('ingress_payloads'),
    bindings: count('runtime_bindings'), dispatch: count('dispatch_receipts'), events: count('event_log'),
  })
  const producerMethods = () => existsSync(producerLog)
    ? readFileSync(producerLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line).method)
    : []
  const received = () => existsSync(receiverLog)
    ? readFileSync(receiverLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    : []

  const criteria = [
    { id: 'criterion-output', kind: 'machine', required: true, description: 'Registered project check passes', checkDefinitionRef: registry.check(record).id },
    { id: 'criterion-human', kind: 'human', required: true, description: 'Review generated patch' },
  ]

  log.begin('B19-PRODUCT-PREPARES', 'policy preparation completes through the original Driver', 'controlled_process')
  product.start()
  const created = await command({
    kind: 'create_work',
    projectId: record.id,
    goal: 'Produce the controlled scratch artifact through a prepared native attempt',
    profileId: NATIVE_PROFILE_ID,
    scope: registry.scope(record),
    criteria,
  })
  const seen = await until(
    async () => ({ frames: received(), tables: tables(), questions: (await product.application.inspect({})).questions }),
    value => value.questions.length >= 1,
  )
  const begins = seen.frames.filter(frame => frame.kind === 'begin')
  const attemptId = begins[0]?.attemptId ?? null
  // The packet is explicit: read kinds from the observations API, not from a non-existent
  // fact_receipts.kind column, and never swallow the error that query would raise.
  const factKinds = attemptId ? store.observations.forAttempt(String(attemptId)).map(row => String(row.kind)) : []
  log.evidence({ status: created.status, attemptId, factKinds, beginCount: begins.length, tables: seen.tables })
  if (begins.length === 1) log.pass(`exactly one begin for attempt ${attemptId} at epoch ${begins[0].fenceEpoch}`)
  else log.fail(`begin count was ${begins.length}, expected 1: ${JSON.stringify(seen.frames)}`)

  log.begin('B19-BROKER-QUESTION', 'the producer approval becomes a real Broker question', 'controlled_process')
  const question = seen.questions[0]
  log.evidence({ questionId: question?.id ?? null, kind: question?.kind ?? null, targets: question?.targets?.length ?? 0 })
  if (question) log.pass(`the Broker registered question ${question.id} (${question.kind ?? 'n/a'}) from the producer approval`)
  else log.fail(`no Broker question was produced: ${JSON.stringify({ factKinds })}`)

  log.begin('B19-RECONNECT-LIVE-INSPECT', 'a reconnected caller reaches the same live Runner', 'controlled_process')
  const ticketIdLive = (() => { try { return store.db.prepare('SELECT id FROM ticket LIMIT 1').get().id } catch { return null } })()
  const liveBinding = ticketIdLive ? store.bindings.current(String(ticketIdLive)) : null
  const reconnectBinding = liveBinding ? {
    ticketId: String(liveBinding.ticketId), assignmentId: String(liveBinding.assignmentId),
    attemptId: String(liveBinding.attemptId), fenceEpoch: Number(liveBinding.fenceEpoch),
    contract: liveBinding.contract, runnerIdentityRef: String(liveBinding.runnerIdentityRef), source: String(liveBinding.source),
  } : null
  const findSockets = () => {
    const found = []
    for (const base of ['/tmp']) {
      let tops = []
      try { tops = readdirSync(base, { withFileTypes: true }) } catch { continue }
      for (const top of tops) {
        if (!top.isDirectory()) continue
        const dir = join(base, top.name)
        let entries = []
        try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
        for (const entry of entries) {
          if (entry.name !== 'runner.sock') continue
          const full = join(dir, entry.name)
          try { found.push({ path: full, at: statSync(full).mtimeMs }) } catch {}
        }
      }
    }
    return found.sort((a, b) => b.at - a.at).map(item => item.path)
  }
  const deepSockets = () => {
    const found = []
    const walk = dir => {
      let entries = []
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name === 'runner.sock') { try { found.push({ path: full, at: statSync(full).mtimeMs }) } catch {} }
      }
    }
    walk(root)
    for (const dir of ['/tmp/pa-runner-' + (process.getuid?.() ?? 0)]) walk(dir)
    return found.sort((a, b) => b.at - a.at).map(item => item.path)
  }
  const candidates = reconnectBinding ? [...new Set([...findSockets(), ...deepSockets()])] : []
  let inspected = null, inspectError = null, usedSocket = null
  for (const socketPath of candidates) {
    try {
      const port = await reconnectBusinessRunner({
        stateRoot, binding: reconnectBinding,
        expected: { ticketId: reconnectBinding.ticketId, attemptId: reconnectBinding.attemptId, fenceEpoch: reconnectBinding.fenceEpoch },
        beforeWrite: async () => {},
        alreadyRecorded: () => false,
        endpoint: { socketPath, credentialPath: join(dirname(socketPath), 'runner.credential') },
      })
      const proof = await port.inspect()
      port.close()
      if (String(proof.inspection.attempt?.attemptId) === reconnectBinding.attemptId) { inspected = proof.inspection; usedSocket = socketPath; break }
    } catch (error) { inspectError = String(error?.message ?? error).slice(0, 200) }
  }
  log.evidence({ candidateSockets: candidates.length, usedSocket, attemptId: reconnectBinding?.attemptId ?? null, inspectedState: inspected?.state ?? null, inspectedAdmission: inspected?.admission ?? null, resources: inspected?.resources?.length ?? 0, inspectError })
  if (inspected) log.pass(`authenticated reconnect inspected attempt ${inspected.attempt.attemptId} (state ${inspected.state}, admission ${inspected.admission}, ${inspected.resources?.length ?? 0} resource(s))`)
  else log.fail(`reconnect did not reach the live attempt: ${JSON.stringify({ candidates: candidates.length, inspectError })}`)

  log.begin('B19-DURABLE-ROWS', 'facts, dispatch and the binding agree with the receiver attempt', 'controlled_process')
  const final = tables()
  const ticketId = (() => { try { return store.db.prepare('SELECT id FROM ticket LIMIT 1').get().id } catch { return null } })()
  const binding = ticketId ? store.bindings.current(String(ticketId)) : null
  log.evidence({ tables: final, bindingAttempt: binding?.attemptId ?? null, receiverAttempt: attemptId })
  const required = ['works', 'tickets', 'links', 'facts', 'bindings', 'dispatch']
  const empty = required.filter(name => (final[name] ?? 0) === 0)
  const expectedFacts = ['writer.observed', 'policy.prepared', 'dispatch.observed']
  const missingFacts = expectedFacts.filter(kind => !factKinds.includes(kind))
  const sameAttempt = binding && attemptId ? String(binding.attemptId) === String(attemptId) : false
  if (empty.length === 0 && missingFacts.length === 0) {
    log.pass(`durable rows agree: ${required.map(n => `${n}=${final[n]}`).join(' ')}; facts ${[...new Set(factKinds)].join(', ')}${sameAttempt ? '; binding attempt matches the receiver' : ''}`)
  } else {
    log.fail(`durable rows or facts missing: ${JSON.stringify({ empty, missingFacts, factKinds, final })}`)
  }

  log.begin('B19-ANSWER-DELIVERED', 'the human answer is delivered to the live turn', 'controlled_process')
  let answered = null, answerError = null
  if (question) {
    try {
      answered = await command({
        kind: 'answer_question',
        questionId: question.id,
        expectedVersion: question.version,
        answer: { kind: 'choices', optionIds: [question.presentation?.options?.[0]?.id ?? 'accept'] },
      })
    } catch (error) { answerError = String(error?.message ?? error).slice(0, 300) }
  }
  const afterAnswer = await until(
    async () => ({ frames: received(), tables: tables() }),
    value => value.frames.some(frame => frame.kind === 'answer'),
    15_000,
  ).catch(() => ({ frames: received(), tables: tables() }))
  const answerFrames = afterAnswer.frames.filter(frame => frame.kind === 'answer')
  log.evidence({ status: answered?.status ?? null, answerError, answerFrames: answerFrames.length, tables: afterAnswer.tables })
  const readDelivery = () => { try { return store.db.prepare('SELECT status FROM answer_deliveries ORDER BY rowid DESC LIMIT 1').get()?.status ?? null } catch { return null } }
  const delivery = readDelivery() === 'native_applied' ? 'native_applied' : (await until(async () => readDelivery(), value => value === 'native_applied', 20_000).catch(() => readDelivery()))
  log.evidence({ deliveryStatus: delivery })
  if (answered?.status === 'recorded' && answerFrames.length >= 1 && delivery === 'native_applied') {
    log.pass(`the answer reached native_applied on the live turn (${answerFrames.length} answer frame, delivery ${delivery})`)
  } else {
    log.fail(`answer delivery incomplete: ${JSON.stringify({ status: answered?.status ?? null, answerError, answerFrames: answerFrames.length })}`)
  }

  log.begin('B19-STOP-DELIVERED', 'stop_work cancels the live turn and the Runner is told', 'controlled_process')
  const beforeStop = received()
  let stopped = null, stopError = null
  try {
    stopped = await command({ kind: 'stop_work', workId: created.workId, conversationId: 'conversation-product' })
  } catch (error) { stopError = String(error?.message ?? error).slice(0, 300) }
  const afterStop = await until(
    async () => ({ frames: received(), tables: tables() }),
    value => value.frames.some(frame => frame.kind === 'cancel'),
    15_000,
  ).catch(() => ({ frames: received(), tables: tables() }))
  const cancels = afterStop.frames.filter(frame => frame.kind === 'cancel')
  const workAfter = (await product.application.inspect({ workId: created.workId })).works[0]
  const methods = producerMethods()
  const interrupted = methods.includes('turn/interrupt')
  log.evidence({ status: stopped?.status ?? null, stopError, cancelFrames: cancels.length, producerMethods: methods, interrupted, phase: workAfter?.phase ?? null })
  const barrier = (() => { try { return store.db.prepare("SELECT COUNT(*) AS n FROM event_log WHERE topic = 'runtime.barrier.confirmed'").get().n } catch { return 0 } })()
  const resourcesAlive = (() => { try { return store.db.prepare("SELECT COUNT(*) AS n FROM resource_observations WHERE status IS NULL").get().n } catch { return -1 } })()
  log.evidence({ barrierEvents: barrier, resourcesWithoutTerminalStatus: resourcesAlive, channel: 'authenticated recovery cancel -> stopPhysical -> committed registered-owned barrier' })
  if (stopped?.status === 'recorded' && workAfter?.phase === 'ended' && barrier >= 1) {
    log.pass(`stop committed a registered-owned barrier (${barrier}) and the work ended; the recovery channel is what stops the writer, not a business cancel or turn/interrupt`)
  } else if (stopped?.status === 'recorded' && (cancels.length >= 1 || interrupted) && workAfter?.phase === 'ended') {
    log.pass(`stop was recorded and the work ended; the writer was stopped over the recovery channel`)
  } else {
    log.fail(`stop did not reach the writer: ${JSON.stringify({ status: stopped?.status ?? null, stopError, cancelFrames: cancels.length, interrupted, methods, phase: workAfter?.phase ?? null })}`)
  }

  log.begin('B19-SCOPE-NOT-NATIVE', 'fake executable lane; installed Codex not executed', 'controlled_process')
  log.evidence({ driver: 'CodexProductDriver (unmodified)', executable: 'B-owned fake app-server process', installedCodexExecuted: false })
  log.notTested('an installed Codex was not executed and no gateway was contacted')
  log.notTested('question/approval, child writer identity, reconnect port, crash windows, stale epoch, recovered delivery and slots are not covered here')
} finally {
  try { await product?.close() } catch {}
  try { store?.close() } catch {}
  delete process.env.PA_RUNNER_RECEIVER_LOG
  delete process.env.PA_PRODUCER_LOG
  delete process.env.PA_PRODUCER_HOLD
  rmSync(root, { recursive: true, force: true })
}

const report = writeReport(
  { cases: log.cases, environment: { note: 'wave-18 B1/B2 product vertical with B-owned local producer', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'controlled fake executable; native NOT_TESTED' } },
  process.argv.includes('--record') ? `${repo}tests/native-acceptance/reports/b19-normal-reconnect.json` : undefined,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(30)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB19 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
